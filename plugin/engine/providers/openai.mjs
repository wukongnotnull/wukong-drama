import { ProviderError, requestJson } from './http.mjs';
import path from 'node:path';
import { atomicWrite, imageDataUrl, imageMime, readImage, validateOutput } from './media.mjs';
import { safeUsage } from './usage.mjs';

function validateSize(size, model) {
  if (size === 'auto') return;
  if (/^gpt-image-1(?:\.|-|$)/.test(model) && !['1024x1024', '1536x1024', '1024x1536'].includes(size)) {
    throw new ProviderError('此图片模型仅支持标准图片尺寸。', { code: 'invalid_size' });
  }
  const match = typeof size === 'string' && size.match(/^(\d+)x(\d+)$/);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || width % 16 || height % 16 || width > 3840 || height > 3840 || width * height < 655360 || width * height > 8294400 || Math.max(width, height) / Math.min(width, height) > 3) {
    throw new ProviderError('图片尺寸须为 16 的倍数，宽高比不超过 3:1，单边不超过 3840，像素总数在 655360–8294400 之间。', { code: 'invalid_size' });
  }
}

function validateConfig(args) {
  const { config, prompt, references = [], size = '1536x864', output } = args;
  if (!config.model.trim()) throw new ProviderError('请设置 OPENAI_IMAGE_MODEL 或 generation.image.model 为已开通的模型 ID。', { code: 'missing_model' });
  if (output !== undefined) validateOutput(output);
  if (!Array.isArray(references) || references.length > 16) throw new ProviderError('GPT Image 参考图数量必须为 0–16 张。', { code: 'invalid_reference' });
  if (references.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new ProviderError('参考图必须使用本地绝对路径。', { code: 'invalid_reference' });
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32_000) throw new ProviderError('图片提示词必须为 1–32000 字符。', { code: 'invalid_prompt' });
  validateSize(size, config.model);
  const qualities = /^gpt-image-(?:1(?:\.|-|$)|2(?:-|$))/.test(config.model) ? ['auto', 'low', 'medium', 'high'] : ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (!qualities.includes(config.quality ?? 'auto')) throw new ProviderError('图片质量参数无效或当前模型不支持。', { code: 'invalid_quality' });
  return { ...args, references, size };
}

export const openai = {
  defaults: { base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY', request_timeout_ms: 180_000 },
  // Verified baseline, not a moving "latest" alias; film config and env can override it.
  model: env => env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',
  validateConfig,
  async validate(args) {
    const normalized = validateConfig(args);
    // Sequential reads avoid retaining every image in memory during preflight.
    for (const file of normalized.references) await readImage(file);
    return normalized;
  },
  async generate(args, options = {}) {
    const { config, prompt, references, size, output } = validateConfig(args);
    validateOutput(output);
    const body = { model: config.model, prompt, n: 1, size, quality: config.quality ?? 'auto', output_format: 'png' };
    if (references.length) body.images = await Promise.all(references.map(async file => ({ image_url: await imageDataUrl(file) })));
    const response = await requestJson(config, references.length ? '/images/edits' : '/images/generations', { ...options, method: 'POST', body });
    const value = response?.data?.[0]?.b64_json;
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new ProviderError('GPT Image 响应缺少有效的 base64 图片。', { code: 'invalid_image_response' });
    }
    const bytes = Buffer.from(value, 'base64');
    if (imageMime(bytes) !== 'image/png') throw new ProviderError('GPT Image 未返回请求的 PNG 格式。', { code: 'invalid_image_response' });
    await atomicWrite(output, bytes);
    const usage = safeUsage(response.usage, ['input_tokens', 'output_tokens', 'total_tokens']);
    return { provider: config.name, model: config.model, format: 'png', bytes: bytes.length, ...(usage ? { usage } : {}) };
  },
};
