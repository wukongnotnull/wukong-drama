import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const entry = new URL('../../plugin/engine/providers/index.mjs', import.meta.url);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const mp4 = Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 0, 0, ...Buffer.from('isomiso2')]);
const key = 'test-private-key-do-not-leak';
async function setup(t, handler) {
  assert.ok(fs.existsSync(fileURLToPath(entry)), 'model providers must be implemented');
  const api = await import(entry.href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-provider-'));
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const call = { url: req.url, method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    calls.push(call);
    await handler(call, res, calls.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { base_url: base, model: 'test-model', api_key_env: 'WKD_TEST_KEY' };
  const options = { env: { WKD_TEST_KEY: key } };
  return { api, dir, calls, base, config, options };
}
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

test('GPT Image creates and atomically saves a base64 image', async t => {
  const s = await setup(t, (_req, res) => json(res, { data: [{ b64_json: png.toString('base64') }], usage: { total_tokens: 4 } }));
  const output = path.join(s.dir, 'nested', 'still.png');
  const result = await s.api.generateImage({ config: s.config, prompt: '星空下的小船', references: [], size: '1536x864', output }, s.options);
  assert.deepEqual(fs.readFileSync(output), png);
  assert.equal(s.calls[0].url, '/images/generations');
  assert.equal(s.calls[0].headers.authorization, `Bearer ${key}`);
  assert.deepEqual(s.calls[0].body, { model: 'test-model', prompt: '星空下的小船', n: 1, size: '1536x864', quality: 'auto', output_format: 'png' });
  assert.equal(result.model, 'test-model');
  assert.deepEqual(result.usage, { total_tokens: 4 });
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('readiness validates models and environment keys without returning secrets', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  assert.equal(typeof s.api.assertProviderReady, 'function');
  assert.throws(() => s.api.assertProviderReady('video', { ...s.config, model: '' }, s.options), { code: 'missing_model' });
  assert.throws(() => s.api.assertProviderReady('image', s.config, { env: {} }), { code: 'missing_api_key' });
  const ready = s.api.assertProviderReady('image', s.config, s.options);
  assert.equal(ready.model, 'test-model');
  assert.equal(JSON.stringify(ready).includes(key), false);
  assert.equal(s.api.resolveProvider('video', {}, { env: { SEEDANCE_MODEL: 'doubao-seedance-2-5-260628' } }).model, 'doubao-seedance-2-5-260628');
  assert.equal(s.calls.length, 0);
});

test('configuration rejects inline credentials, unsafe URLs, and invalid options', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  for (const config of [
    { api_key: key }, { token: key }, { authorization: key },
    { base_url: 'http://example.com/v1' }, { base_url: 'https://user:secret@example.com/v1' },
    { base_url: 'https://example.com/v1?key=secret' }, { base_url: 'https://example.com/#secret' },
    { api_key_env: 'not a variable' }, { model: 'model\nsecret' }, { request_timeout_ms: 0 },
  ]) assert.throws(() => s.api.resolveProvider('image', { ...s.config, ...config }), s.api.ProviderError);
  assert.throws(() => s.api.resolveProvider('image', { provider: 'missing' }), { code: 'unknown_provider' });
  assert.equal(s.calls.length, 0);
});

test('GPT Image edits local references through the official JSON image_url contract', async t => {
  const s = await setup(t, (_req, res) => json(res, {
    data: [{ b64_json: png.toString('base64') }],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7, input_tokens_details: { image_tokens: 2, text_tokens: 1, secret: key }, debug: key },
  }));
  const reference = path.join(s.dir, 'ref.png');
  fs.writeFileSync(reference, png);
  const result = await s.api.generateImage({ config: s.config, prompt: '保留角色换背景', references: [reference], output: path.join(s.dir, 'edit.png') }, s.options);
  assert.equal(s.calls[0].url, '/images/edits');
  assert.equal(s.calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(s.calls[0].body.images, [{ image_url: `data:image/png;base64,${png.toString('base64')}` }]);
  assert.deepEqual(result.usage.input_tokens_details, { image_tokens: 2, text_tokens: 1 });
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('image validation catches output, dimensions, quality, missing key and references before submitting', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  const args = { config: s.config, prompt: '猫和老鼠', output: path.join(s.dir, 'out.png') };
  for (const [override, code] of [
    [{ output: 'relative.png' }, 'invalid_output'], [{ prompt: ' ' }, 'invalid_prompt'],
    [{ size: '123x456' }, 'invalid_size'], [{ size: '4096x4096' }, 'invalid_size'],
    [{ config: { ...s.config, quality: 'surprise' } }, 'invalid_quality'],
    [{ references: ['https://example.com/ref.png'] }, 'invalid_reference'],
    [{ references: [path.join(s.dir, 'missing.png')] }, 'invalid_reference'],
    [{ references: Array(17).fill('ref.png') }, 'invalid_reference'],
  ]) await assert.rejects(s.api.generateImage({ ...args, ...override }, s.options), { code });
  await assert.rejects(s.api.generateImage(args, { env: {} }), { code: 'missing_api_key' });
  assert.equal(s.calls.length, 0);
});

test('invalid image responses preserve the previous output and leave no temporary files', async t => {
  const s = await setup(t, (_req, res, count) => json(res, count === 1 ? { data: [{ b64_json: 'not base64!' }] } : { data: [{ b64_json: Buffer.from('not a png').toString('base64') }] }));
  const output = path.join(s.dir, 'still.png');
  fs.writeFileSync(output, png);
  for (let i = 0; i < 2; i++) await assert.rejects(s.api.generateImage({ config: s.config, prompt: 'test', output }, s.options), s.api.ProviderError);
  assert.deepEqual(fs.readFileSync(output), png);
  assert.deepEqual(fs.readdirSync(s.dir), ['still.png']);
});

const videoConfig = config => ({ ...config, model: 'doubao-seedance-2-5-260628', resolution: '720p', generate_audio: true });
test('video preflight supports 30-second Seedance 2.5 and validates before a still exists', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  assert.equal(typeof s.api.validateVideoRequest, 'function');
  const args = { config: videoConfig(s.config), prompt: '厨房喜剧，原生动作音效，无人声', duration: 30, ratio: '16:9', image: path.join(s.dir, 'not-created-yet.png') };
  const validated = s.api.validateVideoRequest(args, s.options);
  assert.equal(validated.ratio, 'adaptive');
  assert.equal(validated.config.generate_audio, true);
  for (const [override, code] of [
    [{ duration: 31 }, 'invalid_duration'], [{ duration: 3 }, 'invalid_duration'], [{ duration: -1 }, 'invalid_duration'],
    [{ duration: 5.5 }, 'invalid_duration'], [{ prompt: '' }, 'invalid_prompt'], [{ ratio: '2:7' }, 'invalid_ratio'],
    [{ config: { ...args.config, resolution: '4k' } }, 'invalid_resolution'],
    [{ config: { ...args.config, generate_audio: 'true' } }, 'invalid_config'],
    [{ config: { ...args.config, seed: 7 } }, 'unsupported_parameter'],
  ]) assert.throws(() => s.api.validateVideoRequest({ ...args, ...override }, s.options), { code });
  assert.equal(s.calls.length, 0);
});

test('Seedance submits exactly one first-frame task with 720p native audio and 30 seconds', async t => {
  const s = await setup(t, (_req, res) => json(res, { id: 'cgt-one', debug: key }));
  const image = path.join(s.dir, 'first.png');
  fs.writeFileSync(image, png);
  const result = await s.api.submitVideo({ config: videoConfig(s.config), image, prompt: '30秒厨房喜剧', duration: 30, ratio: '16:9' }, s.options);
  assert.deepEqual(result, { id: 'cgt-one' });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/contents/generations/tasks');
  assert.equal(s.calls[0].headers.authorization, `Bearer ${key}`);
  assert.deepEqual(s.calls[0].body, {
    model: 'doubao-seedance-2-5-260628',
    content: [{ type: 'text', text: '30秒厨房喜剧' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` }, role: 'first_frame' }],
    duration: 30, ratio: 'adaptive', resolution: '720p', generate_audio: true, watermark: true, return_last_frame: false,
  });
});

test('task polling returns safe usage and technical metadata without arbitrary response fields', async t => {
  const s = await setup(t, (_req, res) => json(res, {
    id: 'cgt-one', status: 'succeeded', model: 'doubao-seedance-2-5-260628',
    content: { video_url: 'https://example.com/video.mp4?signature=opaque', secret: key },
    usage: { completion_tokens: 648000, total_tokens: 648000, tool_usage: { web_search: 1, secret: key }, secret: key },
    duration: 30, framespersecond: 24, resolution: '720p', ratio: '16:9', generate_audio: true,
    seed: 42, created_at: 1, updated_at: 2, output_format: 'mp4', service_tier: 'default', draft: false,
    error: { message: key }, safety_identifier: key, debug: key,
  }));
  const result = await s.api.getVideo({ config: videoConfig(s.config), id: 'cgt-one' }, s.options);
  assert.equal(s.calls[0].method, 'GET');
  assert.equal(s.calls[0].url, '/contents/generations/tasks/cgt-one');
  assert.deepEqual(result.usage, { completion_tokens: 648000, total_tokens: 648000, tool_usage: { web_search: 1 } });
  assert.equal(result.metadata.duration, 30);
  assert.equal(result.metadata.generate_audio, true);
  assert.equal(result.metadata.model, 'doubao-seedance-2-5-260628');
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(result.videoUrl, 'https://example.com/video.mp4?signature=opaque');
});

test('task polling preserves terminal failure states without leaking upstream error bodies', async t => {
  const statuses = ['queued', 'running', 'failed', 'cancelled', 'expired'];
  const s = await setup(t, (_req, res, count) => json(res, { status: statuses[count - 1], error: { code: key, message: key } }));
  for (const status of statuses) {
    const result = await s.api.getVideo({ config: s.config, id: 'cgt-one' }, s.options);
    assert.equal(result.status, status);
    assert.equal(JSON.stringify(result).includes(key), false);
    if (['failed', 'cancelled', 'expired'].includes(status)) assert.ok(result.error);
  }
});

test('task polling rejects unknown states, missing output, unsafe output URLs and unsafe IDs', async t => {
  const responses = [{ status: 'mystery' }, { status: 'succeeded' }, { status: 'succeeded', content: { video_url: 'file:///tmp/x.mp4' } }];
  const s = await setup(t, (_req, res, count) => json(res, responses[count - 1]));
  for (const code of ['invalid_task_status', 'missing_video_url', 'invalid_url']) await assert.rejects(s.api.getVideo({ config: s.config, id: 'cgt-one' }, s.options), { code });
  await assert.rejects(s.api.getVideo({ config: s.config, id: '../secret' }, s.options), { code: 'invalid_task_id' });
  assert.equal(s.calls.length, 3);
});

test('HTTP errors and malformed JSON are sanitized and never retried', async t => {
  const s = await setup(t, (_req, res, count) => {
    if (count === 1) json(res, { error: { message: key } }, 429);
    else { res.writeHead(200); res.end(key); }
  });
  for (const code of ['http_error', 'invalid_response']) {
    await assert.rejects(s.api.requestJson(s.api.resolveProvider('image', s.config), '/test', { ...s.options, method: 'POST', body: { prompt: 'test' } }), error => error.code === code && !String(error).includes(key));
  }
  assert.equal(s.calls.length, 2);
});

test('request and body timeout abort once with an ambiguous-submission warning', async t => {
  const s = await setup(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
  const config = s.api.resolveProvider('image', { ...s.config, request_timeout_ms: 40 });
  await assert.rejects(s.api.requestJson(config, '/slow', { ...s.options, method: 'POST', body: {} }), { code: 'request_aborted' });
  assert.equal(s.calls.length, 1);
});

test('authenticated API requests do not follow redirects', async t => {
  const s = await setup(t, (_req, res) => { res.writeHead(302, { Location: '/redirected' }); res.end(); });
  await assert.rejects(s.api.getVideo({ config: s.config, id: 'cgt-one' }, s.options), { code: 'http_error' });
  assert.equal(s.calls.length, 1);
});

test('video downloads follow safe redirects without credentials and save atomically', async t => {
  const s = await setup(t, (_req, res, count) => {
    if (count === 1) { res.writeHead(302, { Location: '/video' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(mp4); }
  });
  const output = path.join(s.dir, 'generated', 'clip.mp4');
  const result = await s.api.downloadVideo({ url: `${s.base}/start`, output }, s.options);
  assert.equal(result.bytes, mp4.length);
  assert.deepEqual(fs.readFileSync(output), mp4);
  assert.ok(s.calls.every(call => call.headers.authorization === undefined));
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ['clip.mp4']);
});

test('unsafe and oversized downloads preserve old files and leave no partial assets', async t => {
  const s = await setup(t, (_req, res, count) => {
    if (count === 1) { res.writeHead(302, { Location: 'file:///etc/passwd' }); res.end(); }
    else if (count === 2) { res.writeHead(200); res.end('error page'); }
    else { res.writeHead(200, { 'Content-Length': 1000 }); res.end(mp4); }
  });
  const output = path.join(s.dir, 'clip.mp4');
  fs.writeFileSync(output, mp4);
  for (const code of ['invalid_url', 'invalid_video', 'response_too_large']) await assert.rejects(s.api.downloadVideo({ url: `${s.base}/video`, output }, { maxBytes: 100 }), { code });
  assert.deepEqual(fs.readFileSync(output), mp4);
  assert.deepEqual(fs.readdirSync(s.dir), ['clip.mp4']);
  await assert.rejects(s.api.downloadVideo({ url: `${s.base}/video`, output: 'relative.mp4' }), { code: 'invalid_output' });
  assert.equal(s.calls.length, 3);
});

test('streaming downloads enforce size limit without Content-Length and bound redirect loops', async t => {
  const s = await setup(t, (req, res) => {
    if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); }
    else { res.writeHead(200); res.write(mp4); res.end(Buffer.alloc(150)); }
  });
  const output = path.join(s.dir, 'clip.mp4');
  await assert.rejects(s.api.downloadVideo({ url: `${s.base}/large`, output }, { maxBytes: 100 }), { code: 'response_too_large' });
  await assert.rejects(s.api.downloadVideo({ url: `${s.base}/loop`, output }), { code: 'invalid_download' });
  assert.equal(s.calls.length, 7);
  assert.equal(fs.existsSync(output), false);
});

test('image plan validation checks parameters synchronously without keys, output files or fetch', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('validation must not fetch'); });
  assert.equal(typeof s.api.validateImageConfig, 'function');
  const args = { config: s.config, prompt: '厨房角色定妆', references: [path.join(s.dir, 'not-created.png')] };
  const result = s.api.validateImageConfig(args, { env: {} });
  assert.equal(typeof result?.then, 'undefined', 'plan validation must be synchronous');
  assert.equal(result.size, '1536x864');
  assert.equal(result.config.model, 'test-model');
  for (const [override, code] of [
    [{ config: { ...s.config, model: '' } }, 'missing_model'],
    [{ config: { ...s.config, quality: 'ultra' } }, 'invalid_quality'],
    [{ size: '123x456' }, 'invalid_size'], [{ prompt: ' ' }, 'invalid_prompt'],
    [{ references: ['relative.png'] }, 'invalid_reference'],
    [{ output: 'relative.png' }, 'invalid_output'],
  ]) assert.throws(() => s.api.validateImageConfig({ ...args, ...override }, { env: {} }), { code });
  assert.equal(requests, 0);
  assert.equal(s.calls.length, 0);
});

test('image preflight reads reference types and size limits without submitting or writing output', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('validation must not fetch'); });
  assert.equal(typeof s.api.validateImageRequest, 'function');
  const reference = path.join(s.dir, 'ref.png'), invalid = path.join(s.dir, 'invalid.png'), large = path.join(s.dir, 'large.png');
  fs.writeFileSync(reference, png); fs.writeFileSync(invalid, '<html>not an image</html>');
  fs.writeFileSync(large, png); fs.truncateSync(large, 15 * 1024 * 1024);
  const output = path.join(s.dir, 'not-written.png');
  const args = { config: s.config, prompt: '厨房角色定妆', output, references: [reference] };
  const result = await s.api.validateImageRequest(args, { env: {} });
  assert.equal(result.size, '1536x864');
  assert.deepEqual(result.references, [reference]);
  for (const [override, code] of [
    [{ config: { ...s.config, quality: 'ultra' } }, 'invalid_quality'],
    [{ size: '123x456' }, 'invalid_size'],
    [{ references: [invalid] }, 'invalid_image'], [{ references: [large] }, 'invalid_reference'],
    [{ references: [path.join(s.dir, 'missing.png')] }, 'invalid_reference'],
  ]) await assert.rejects(s.api.validateImageRequest({ ...args, ...override }, { env: {} }), { code });
  assert.equal(requests, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(fs.existsSync(output), false);
});

test('video input preflight rejects malformed local first frames before any network request', async t => {
  const s = await setup(t, (_req, res) => json(res, {}));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('validation must not fetch'); });
  assert.equal(typeof s.api.validateVideoInput, 'function');
  const image = path.join(s.dir, 'first.png');
  fs.writeFileSync(image, png);
  const args = { config: videoConfig(s.config), prompt: '厨房动作喜剧', image, duration: 30, ratio: '16:9' };
  assert.equal((await s.api.validateVideoInput(args, { env: {} })).ratio, 'adaptive');
  fs.writeFileSync(image, 'not an image');
  await assert.rejects(s.api.validateVideoInput(args, { env: {} }), { code: 'invalid_image' });
  fs.writeFileSync(image, png); fs.truncateSync(image, 30 * 1024 * 1024);
  await assert.rejects(s.api.validateVideoInput(args, { env: {} }), { code: 'invalid_reference' });
  assert.equal(requests, 0);
  assert.equal(s.calls.length, 0);
});

test('provider is canonical while internally resolved configs remain reusable',async()=>{
 const api=await import(entry.href);assert.throws(()=>api.resolveProvider('image',{name:'openai',model:'image-test'}),/provider/);
 const value=api.resolveProvider('image',{provider:'openai',model:'image-test'});assert.deepEqual(api.resolveProvider('image',value),value);
});
