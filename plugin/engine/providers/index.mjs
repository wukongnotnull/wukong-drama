import { ProviderError, validateUrl, readApiKey } from './http.mjs';
import { openai } from './openai.mjs';
import { seedance } from './seedance.mjs';
export { downloadVideo } from './media.mjs';
export { ProviderError, requestJson } from './http.mjs';

export const registry = { image: new Map(), video: new Map() };
export function registerProvider(kind, name, adapter) {
  if (!registry[kind] || typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) throw new ProviderError('生成提供商名称或类型无效。', { code: 'invalid_provider' });
  const methods = kind === 'image' ? ['generate'] : ['submit', 'get'];
  if (methods.some(method => typeof adapter?.[method] !== 'function')) throw new ProviderError('生成提供商缺少必要方法。', { code: 'invalid_provider' });
  if (registry[kind].has(name)) throw new ProviderError('生成提供商已注册。', { code: 'duplicate_provider' });
  registry[kind].set(name, adapter);
}
registerProvider('image', 'openai', openai);
registerProvider('video', 'seedance', seedance);

export function resolveProvider(kind, config = {}, options = {}) {
  if (!registry[kind] || !config || typeof config !== 'object' || Array.isArray(config)) throw new ProviderError('生成提供商配置无效。', { code: 'invalid_config' });
  if (Object.keys(config).some(key => /^(api_?key|token|authorization)$/i.test(key))) throw new ProviderError('密钥只能通过 api_key_env 指定环境变量，不能写入项目配置。', { code: 'inline_credentials' });
  if (config.name !== undefined && (config.provider === undefined || config.name !== config.provider)) throw new ProviderError('请使用 provider 配置供应商，不再接受 name 别名。', { code:'invalid_config' });
  const name = config.provider ?? (kind === 'image' ? 'openai' : 'seedance');
  const adapter = registry[kind].get(name);
  if (!adapter) throw new ProviderError('未知的生成提供商，请检查 provider 配置。', { code: 'unknown_provider' });
  const resolved = { ...adapter.defaults, ...config, name, provider: name, model: config.model ?? adapter.model?.(options.env ?? process.env) ?? '' };
  if (typeof resolved.model !== 'string' || resolved.model.length > 256 || /[\r\n]/.test(resolved.model)) throw new ProviderError('模型 ID 无效。', { code: 'invalid_model' });
  if (typeof resolved.api_key_env !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resolved.api_key_env)) throw new ProviderError('api_key_env 必须是环境变量名称。', { code: 'invalid_config' });
  if (!Number.isFinite(resolved.request_timeout_ms) || resolved.request_timeout_ms < 1 || resolved.request_timeout_ms > 1_800_000) throw new ProviderError('request_timeout_ms 必须为 1–1800000 毫秒。', { code: 'invalid_config' });
  resolved.base_url = validateUrl(resolved.base_url, { base: true }).href.replace(/\/$/, '');
  return resolved;
}

/** Local readiness only. The returned configuration never contains the API key. */
export function assertProviderReady(kind, config, options = {}) {
  const resolved = resolveProvider(kind, config, options);
  if (!resolved.model.trim()) throw new ProviderError(`请设置 ${kind === 'image' ? 'OPENAI_IMAGE_MODEL 或 generation.image.model' : 'SEEDANCE_MODEL 或 generation.video.model'} 为已开通的模型 ID。`, { code: 'missing_model' });
  readApiKey(resolved, options);
  return resolved;
}

/** Validate before paid image work; the first-frame file need not exist yet. */
export function validateVideoRequest(args, options = {}) {
  const config = resolveProvider('video', args.config, options);
  const adapter = registry.video.get(config.name);
  return adapter.validate ? adapter.validate({ ...args, config }) : { ...args, config };
}

/** Synchronous plan checks; no file reads, credentials, network calls or output writes. */
export function validateImageConfig(args, options = {}) {
  const config = resolveProvider('image', args.config, options);
  if (!config.model.trim()) throw new ProviderError('请设置图片模型 ID。', { code: 'missing_model' });
  const adapter = registry.image.get(config.name);
  return adapter.validateConfig ? adapter.validateConfig({ ...args, config }) : { ...args, config };
}
/** Complete local preflight, including reference bytes, before reserving a paid request. */
export async function validateImageRequest(args, options = {}) {
  const normalized = validateImageConfig(args, options);
  const adapter = registry.image.get(normalized.config.name);
  return adapter.validate ? adapter.validate(normalized) : normalized;
}
export async function validateVideoInput(args, options = {}) {
  const normalized = validateVideoRequest(args, options);
  const adapter = registry.video.get(normalized.config.name);
  return adapter.validateInput ? adapter.validateInput(normalized) : normalized;
}

export async function generateImage(args, options) {
  const config = assertProviderReady('image', args.config, options);
  return registry.image.get(config.name).generate({ ...args, config }, options);
}
export async function submitVideo(args, options) {
  const config = assertProviderReady('video', args.config, options);
  return registry.video.get(config.name).submit({ ...args, config }, options);
}
export async function getVideo(args, options) {
  const config = assertProviderReady('video', args.config, options);
  return registry.video.get(config.name).get({ ...args, config }, options);
}
