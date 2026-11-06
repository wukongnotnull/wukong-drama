import { writeSfxStyle } from '../fixtures/model.mjs';
// 自定义模型风格录音音效库：清单、处理、叠加、密度检查。不联网：用合成的 wav 代替 Mixkit 原始文件。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../../plugin/engine/core/validate.mjs';
import { hasFfmpeg } from '../../plugin/engine/core/ffmpeg.mjs';
import * as synth from '../../plugin/engine/audio/synth.mjs';
import { loadSfxLibrary, sfxUrl, prepareSfx, createSfx, densityWarnings } from '../../plugin/engine/audio/sfx.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-sfx-style-'));
const style = writeSfxStyle(home), DIR = style.dir;
after(() => fs.rmSync(home,{recursive:true,force:true}));
const ffmpeg = { skip: hasFfmpeg() ? false : '需要 ffmpeg' };

/** 写一段常数电平的测试 wav：前 lead 秒静音，之后 body 秒为 value。 */
function toneWav(file, { lead = 0, body = 1, value = 0.5 } = {}) {
  const buf = synth.buffer(lead + body);
  for (let i = Math.floor(lead * buf.sr); i < buf.L.length; i++) buf.L[i] = buf.R[i] = value * (i % 2 ? 1 : -1);
  return synth.writeWav(buf, file);
}

const probe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }).stdout);
const peakDb = (file) => +spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/max_volume: (-?[\d.]+) dB/)[1];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-sfx-'));

test('style.json 声明音效清单，仍通过 schema 校验', () => {
  assert.equal(style.sfx, 'sfx.json');
  const { dir, ...json } = style;
  assert.deepEqual(validate('style', json, 'style.json'), []);
});

test('custom sound manifest preserves identifiers, levels and local cache URL mapping', () => {
  const lib=loadSfxLibrary(style);
  assert.deepEqual(Object.keys(lib.sounds).sort(),['click','ding']);
  assert.equal(lib.sounds.ding.level,0.37);
  assert.equal(sfxUrl(lib,'ding'),'https://example.invalid/sfx/1/1.wav');
});

test('没有 sfx 声明的风格没有音效库', () => {
  assert.equal(loadSfxLibrary({ id: 'ink-wash', dir: DIR }), null);
});

test('处理：去前导静音、限长、峰值 -1 dBFS、48 kHz 单声道', ffmpeg, async () => {
  const dir = tmp();
  const src = toneWav(path.join(dir, 'raw.wav'), { lead: 0.3, body: 2, value: 0.2 });
  const dest = path.join(dir, 'ding.wav');
  await prepareSfx(src, dest, 0.8);
  const info = probe(dest);
  assert.equal(info.streams[0].sample_rate, '48000');
  assert.equal(info.streams[0].channels, 1);
  const d = +info.format.duration;
  assert.ok(d <= 0.8 + 0.01 && d > 0.7, `duration ${d}`); // 前导 0.3 s 静音被去掉，否则只剩 0.5 s 有声
  assert.ok(Math.abs(peakDb(dest) + 1) <= 0.2, `peak ${peakDb(dest)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 一个预置好"已处理"文件的音效库（缓存目录指向临时目录）。 */
async function fakeLibrary(names = ['ding', 'click']) {
  const cacheDir = tmp();
  const lib = loadSfxLibrary(style, { cacheDir });
  for (const n of names) {
    const raw = toneWav(path.join(cacheDir, `${n}.src.wav`), { body: 0.2, value: 0.5 });
    await prepareSfx(raw, path.join(cacheDir, `${n}.wav`), 0.2);
  }
  return lib;
}

test('place：在 at 秒处按 level × volume 叠加，超出结尾截掉', ffmpeg, async () => {
  const lib = await fakeLibrary();
  const sfx = createSfx(lib);
  const buf = synth.buffer(1.1);
  sfx.place(buf, 'ding', { at: 1 });
  sfx.place(buf, 'click', { at: 0.5, volume: 0.5 });
  const peak = 10 ** (-1 / 20);
  const i = 48000 + 100;
  assert.equal(buf.L[48000 - 10], 0);
  assert.ok(Math.abs(Math.abs(buf.L[i]) - peak * 0.37) < 0.01, `ding ${buf.L[i]}`);
  assert.equal(buf.L[i], buf.R[i]);
  const j = 24000 + 100;
  assert.ok(Math.abs(Math.abs(buf.L[j]) - peak * 0.6 * 0.5) < 0.01, `click ${buf.L[j]}`);
  assert.equal(buf.L.length, Math.ceil(1.1 * 48000)); // 越界部分截掉，没有改长度
  assert.ok(sfx.names.includes('click'));
  fs.rmSync(lib.dir, { recursive: true, force: true });
});

test('place：at < 0 不放；未知名字、未下载分别报错', ffmpeg, async () => {
  const lib = await fakeLibrary(['ding']);
  const sfx = createSfx(lib);
  const buf = synth.buffer(1);
  sfx.place(buf, 'ding', { at: -1 });
  assert.ok(buf.L.every((v) => v === 0));
  assert.throws(() => sfx.place(buf, 'bell', { at: 0 }), /没有音效「bell」.*ding/s);
  assert.throws(() => sfx.place(buf, 'ding', { at: undefined }), /at 要是秒数/);
  assert.throws(() => sfx.place(buf, 'ding', { at: NaN }), /at 要是秒数/);
  assert.throws(() => sfx.place(buf, 'click', { at: 0 }), /还没下载.*wkd sfx/s);
  fs.rmSync(lib.dir, { recursive: true, force: true });
});

test('密度检查：一镜两个 ding、同一帧两个音效会警告', () => {
  const shots = [{ id: 's01', start: 0, duration: 4 }, { id: 's02', start: 4, duration: 4 }];
  assert.deepEqual(densityWarnings([{ name: 'ding', at: 1 }, { name: 'ding', at: 5 }, { name: 'click', at: 2 }], shots), []);
  const w = densityWarnings([{ name: 'ding', at: 1 }, { name: 'ding', at: 3 }, { name: 'click', at: 6 }, { name: 'pop', at: 6.02 }], shots);
  assert.equal(w.length, 2);
  assert.match(w[0], /s01.*2 个 ding/);
  assert.match(w[1], /click.*pop.*6\.0/);
});

test('place 记下放置，供密度检查用', ffmpeg, async () => {
  const lib = await fakeLibrary(['ding']);
  const sfx = createSfx(lib);
  sfx.place(synth.buffer(2), 'ding', { at: 0.5 });
  assert.deepEqual(sfx.placements, [{ name: 'ding', at: 0.5 }]);
  fs.rmSync(lib.dir, { recursive: true, force: true });
});
