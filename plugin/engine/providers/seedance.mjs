import { ProviderError, requestJson, validateUrl } from './http.mjs';
import { imageDataUrl, readImage } from './media.mjs';
import { safeUsage } from './usage.mjs';

function taskId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) throw new ProviderError('视频任务 ID 无效。', { code: 'invalid_task_id' });
  return id;
}

const ratios = ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

function family(config) {
  // Endpoint IDs conceal their model; require an explicit known profile for 2.x capabilities.
  const model = config.model_family ?? config.model;
  if (config.model_family !== undefined && !['seedance-1.0', 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.5'].includes(config.model_family)) {
    throw new ProviderError('model_family 必须为已核实的 Seedance 模型系列。', { code: 'invalid_config' });
  }
  return { is25: /seedance-2[.-]5/i.test(model), is2: /seedance-2[.-]0/i.test(model), small: /(?:fast|mini)/i.test(model) };
}

function validate(args) {
  const { config, prompt, duration, ratio = 'adaptive' } = args;
  if (!config.model.trim()) throw new ProviderError('请设置 SEEDANCE_MODEL 或 generation.video.model 为已开通的模型 ID。', { code: 'missing_model' });
  if (typeof prompt !== 'string' || !prompt.trim()) throw new ProviderError('视频动作提示词不能为空。', { code: 'invalid_prompt' });
  const { is25, is2, small } = family(config);
  const min = is25 || is2 ? 4 : 2;
  const max = is25 ? 30 : is2 ? 15 : 12;
  if (!Number.isInteger(duration) || duration < min || duration > max) throw new ProviderError(`当前视频模型要求整数时长 ${min}–${max} 秒；不使用自动时长以便批次预算可审查。`, { code: 'invalid_duration' });
  if (!ratios.includes(ratio)) throw new ProviderError('视频宽高比无效。', { code: 'invalid_ratio' });
  const resolutions = is2 ? (small ? ['480p', '720p'] : ['480p', '720p', '1080p', '4k']) : ['480p', '720p', '1080p'];
  if (!resolutions.includes(config.resolution ?? '720p')) throw new ProviderError('当前视频模型不支持请求的分辨率。', { code: 'invalid_resolution' });
  for (const name of ['generate_audio', 'watermark', 'return_last_frame']) {
    if (config[name] !== undefined && typeof config[name] !== 'boolean') throw new ProviderError(`${name} 必须是布尔值。`, { code: 'invalid_config' });
  }
  if (!is25 && !is2 && config.generate_audio === true) throw new ProviderError('原生音频需要 Seedance 2.0/2.5 或明确的 model_family；无声生成请显式设置 generate_audio: false。', { code: 'unsupported_parameter' });
  if (config.seed !== undefined) {
    if (is25 || is2) throw new ProviderError('当前官方接口仅为 Seedance 1.0 系列声明 seed 参数支持。', { code: 'unsupported_parameter' });
    if (!Number.isInteger(config.seed) || config.seed < -1 || config.seed > 2147483647) throw new ProviderError('seed 必须为 -1–2147483647 的整数。', { code: 'invalid_config' });
  }
  return { ...args, ratio: is25 ? 'adaptive' : ratio };
}

function safeMetadata(response) {
  const metadata = {};
  for (const name of ['duration', 'frames', 'framespersecond', 'created_at', 'updated_at', 'seed']) {
    if (Number.isSafeInteger(response[name]) && response[name] >= 0) metadata[name] = response[name];
  }
  for (const name of ['generate_audio', 'draft']) if (typeof response[name] === 'boolean') metadata[name] = response[name];
  for (const [name, allowed] of [
    ['resolution', ['480p', '720p', '1080p', '4k']], ['ratio', ratios],
    ['output_format', ['mp4', 'mov']], ['service_tier', ['default', 'flex']],
  ]) if (allowed.includes(response[name])) metadata[name] = response[name];
  if (typeof response.model === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(response.model)) metadata.model = response.model;
  return Object.keys(metadata).length ? metadata : undefined;
}

export const seedance = {
  defaults: { generate_audio: true, base_url: 'https://ark.cn-beijing.volces.com/api/v3', api_key_env: 'ARK_API_KEY', request_timeout_ms: 30_000 },
  model: env => env.SEEDANCE_MODEL || '',
  validate,
  async validateInput(args) {
    const normalized = validate(args);
    await readImage(normalized.image, 29 * 1024 * 1024);
    return normalized;
  },
  async submit(args, options = {}) {
    const { config, prompt, image, duration, ratio } = validate(args);
    const { is25, is2 } = family(config);
    const dataUrl = await imageDataUrl(image, 29 * 1024 * 1024);
    const body = {
      model: config.model,
      content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl }, role: 'first_frame' }],
      duration,
      ratio,
      resolution: config.resolution ?? '720p',
      ...(is25 || is2 ? { generate_audio: config.generate_audio ?? true } : {}),
      watermark: config.watermark ?? true,
      return_last_frame: config.return_last_frame ?? false,
    };
    if (config.seed !== undefined) body.seed = config.seed;
    const response = await requestJson(config, '/contents/generations/tasks', { ...options, method: 'POST', body });
    return { id: taskId(response?.id) };
  },
  async get({ config, id }, options = {}) {
    const response = await requestJson(config, `/contents/generations/tasks/${taskId(id)}`, { ...options, maxBytes: 1024 * 1024 });
    const status = response?.status;
    if (!['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(status)) throw new ProviderError('视频服务返回了未知任务状态。', { code: 'invalid_task_status' });
    const usage = safeUsage(response.usage, ['completion_tokens', 'total_tokens']);
    const metadata = safeMetadata(response);
    const result = { status, ...(usage ? { usage } : {}), ...(metadata ? { metadata } : {}) };
    if (status === 'succeeded') {
      const videoUrl = response?.content?.video_url;
      if (typeof videoUrl !== 'string' || !videoUrl) throw new ProviderError('成功的视频任务缺少下载地址。', { code: 'missing_video_url' });
      validateUrl(videoUrl);
      return { ...result, videoUrl };
    }
    return { ...result, ...(['failed', 'cancelled', 'expired'].includes(status) ? { error: '视频生成任务已失败、取消或过期；请在服务商控制台查看详情。' } : {}) };
  },
};
