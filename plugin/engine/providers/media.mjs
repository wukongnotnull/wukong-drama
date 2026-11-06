import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderError, validateUrl, withResponse, readBytes } from './http.mjs';

export function imageMime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new ProviderError('图片必须为有效的 PNG、JPEG 或 WebP 文件。', { code: 'invalid_image' });
}

export async function readImage(file, maxBytes = 15 * 1024 * 1024 - 64) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new ProviderError('参考图必须使用本地绝对路径。', { code: 'invalid_reference' });
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > maxBytes) throw new ProviderError('参考图片超过允许大小或不是普通文件。', { code: 'invalid_reference' });
    const bytes = await fs.readFile(file);
    if (bytes.length > maxBytes) throw new ProviderError('参考图片超过允许大小。', { code: 'invalid_reference' });
    imageMime(bytes);
    return bytes;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('参考图片不存在或无法读取。', { code: 'invalid_reference' });
  }
}

export async function imageDataUrl(file, maxBytes) {
  const bytes = await readImage(file, maxBytes);
  return `data:${imageMime(bytes)};base64,${bytes.toString('base64')}`;
}

export function validateOutput(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new ProviderError('素材输出必须使用本地绝对路径。', { code: 'invalid_output' });
}

export async function atomicWrite(output, bytes) {
  validateOutput(output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${randomUUID()}.partial`;
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx' });
    await fs.rename(temp, output);
  } finally { await fs.rm(temp, { force: true }); }
}

export async function downloadVideo({ url, output }, options = {}) {
  validateOutput(output);
  let next = validateUrl(url).href;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const result = await withResponse(next, { method: 'GET' }, { ...options, timeoutMs: options.timeoutMs ?? 120_000, allowRedirect: true }, async response => {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new ProviderError('视频下载重定向缺少目标。', { code: 'invalid_download' });
        return { redirect: validateUrl(new URL(location, next).href).href };
      }
      const bytes = await readBytes(response, options.maxBytes ?? 512 * 1024 * 1024);
      if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new ProviderError('下载结果不是有效 MP4 素材。', { code: 'invalid_video' });
      await atomicWrite(output, bytes);
      return { bytes: bytes.length, format: 'mp4' };
    });
    if (!result.redirect) return result;
    next = result.redirect;
  }
  throw new ProviderError('视频下载重定向次数超限。', { code: 'invalid_download' });
}
