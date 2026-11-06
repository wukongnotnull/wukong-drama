/** HTTP transport: no POST retries, bounded reads, and errors without response bodies. */
export class ProviderError extends Error {
  constructor(message, { code = 'provider_error', status } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export function validateUrl(value, { base = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new ProviderError('生成服务 URL 无效。', { code: 'invalid_url' }); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || url.username || url.password || url.hash || (base && url.search)) {
    throw new ProviderError('生成服务必须使用无凭据的 HTTPS URL；仅显式 localhost 测试地址允许 HTTP。', { code: 'invalid_url' });
  }
  return url;
}

export function readApiKey(config, options = {}) {
  const value = (options.env ?? process.env)[config.api_key_env];
  if (typeof value !== 'string' || !value.trim()) throw new ProviderError(`请设置环境变量 ${config.api_key_env} 后调用生成服务。`, { code: 'missing_api_key' });
  return value.trim();
}

export async function withResponse(url, init, options, consume) {
  validateUrl(url);
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && options.allowRedirect) return await consume(response);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(`生成服务请求失败（HTTP ${response.status}），请检查权限、额度及服务商控制台。`, { code: 'http_error', status: response.status });
    }
    return await consume(response);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError('生成服务请求已超时或取消；不要自动重新提交付费任务。', { code: 'request_aborted' });
    throw new ProviderError('生成服务网络请求或响应读取失败；不要自动重新提交付费任务。', { code: 'network_error' });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function readBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new ProviderError('生成服务响应超过大小限制。', { code: 'response_too_large' });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) throw new ProviderError('生成服务响应超过大小限制。', { code: 'response_too_large' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function requestJson(config, endpoint, { method = 'GET', body, ...options } = {}) {
  const key = readApiKey(config, options);
  return withResponse(`${config.base_url}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { ...options, timeoutMs: config.request_timeout_ms }, async response => {
    const bytes = await readBytes(response, options.maxBytes ?? 100 * 1024 * 1024);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw new ProviderError('生成服务返回了无效 JSON。', { code: 'invalid_response' }); }
  });
}
