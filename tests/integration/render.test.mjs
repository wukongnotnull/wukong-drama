import { writeModelShot } from '../fixtures/model.mjs';
// 需要真实的 Chromium + ffmpeg（wkd setup）；缺依赖时整组跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../../plugin/engine/pipelines/generation/index.mjs';
import { inspectVideo } from '../../plugin/engine/core/timing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wkd.mjs');
const ready = (await check()).ok;
const opts = { skip: ready ? false : '模型后期依赖未安装（运行 wkd setup）' };

const SHOT = () => ({ color: '#F2EDE3' });

/** 在临时目录里搭一支最小的片子。shots: {id: 本地素材选项} */
function makeFilm(shots, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-it-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  for (const [id, src] of Object.entries(shots)) writeModelShot(path.join(dir, 'shots', `${id}.json`), src);
  const film = {
    title: 'it', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, generation: {image:{provider:"openai"},video:{generate_audio:false,provider:"seedance"}},
    shots: Object.keys(shots).map((id) => ({ id, file: `shots/${id}.json`, duration: 1 })),
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wkd = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKD_NO_FONT_DOWNLOAD: '1', WKD_WORKERS: '2' } });
const wkaEnv = (env, ...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKD_NO_FONT_DOWNLOAD: '1', WKD_WORKERS: '2', ...env } });
const segments = (dir) => {
  const seg = path.join(dir, '.cache', 'segments');
  return fs.existsSync(seg) ? fs.readdirSync(seg) : [];
};
test('a truncated shot manifest recovers on rerun without changing protected files', opts, (t) => {
  const dir = makeFilm({ s01: SHOT() });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = wkd('render', dir);
  assert.equal(first.status, 0, first.stderr);
  const manifestFile = path.join(dir, '.cache', 'manifest.json');
  const existing = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).shots.s01;
  const protectedPaths = ['film.json', 'shots/s01.json'];
  for (const [rel, body] of Object.entries({
    'audio/original.wav': 'original audio', '.cache/mix.wav': 'existing mix',
    '.cache/approved/s01.mp4': 'approved snapshot', '.cache/9x16/manifest.json': '{"shots":{}}',
    '.wkd/state.json': '{"flow":5,"step":0,"history":[]}',
    'assets/reference.txt': 'reference', 'review/approved.mp4': 'reviewed video', 'out.mp4': 'delivered video',
  })) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    protectedPaths.push(rel);
  }
  const before = protectedPaths.map(rel => fs.readFileSync(path.join(dir, rel)));
  fs.writeFileSync(manifestFile, '{"shots":');
  fs.writeFileSync(existing.file, 'broken media must be regenerated');
  const recovered = wkd('render', dir);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout + recovered.stderr, /缓存索引失效.*重新生成/);
  assert.ok((recovered.stdout + recovered.stderr).includes(manifestFile));
  assert.doesNotMatch(recovered.stdout, /s01 缓存命中/);
  const entry = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).shots.s01;
  const check = inspectVideo(entry.file, { fps: 10, frames: 10 });
  assert.equal(check.ok, true, check.errors.join('\n'));
  for (const [i, rel] of protectedPaths.entries()) assert.deepEqual(fs.readFileSync(path.join(dir, rel)), before[i], rel);
  const again = wkd('render', dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /s01 缓存命中/);
});

test('a corrupt imported shot leaves no partial segment and no running ffmpeg', opts, () => {
  const dir = makeFilm({
    s01: SHOT(),
    s02: SHOT(),
    s03: SHOT(),
  });
  fs.writeFileSync(path.join(dir, 'assets/fixture/s02.mp4'), 'broken imported source');
  const r = wkd('render', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /素材|读取/);
  const segs = segments(dir);
  assert.equal(segs.filter((f) => f.endsWith('.part')).length, 0, `leftover: ${segs}`);
  assert.equal(segs.filter((f) => f.startsWith('s02-')).length, 0, 'failed shot must not leave a segment');
  const ps = spawnSync('pgrep', ['-f', `ffmpeg.*${dir}`], { encoding: 'utf8' });
  assert.equal(ps.stdout.trim(), '', 'no ffmpeg should still be running for this film');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('changing one imported source only retranscodes its shot', opts, t => {
  const dir = makeFilm({ s01: SHOT(), s02: SHOT() });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(wkd('render', dir).status, 0);
  writeModelShot(path.join(dir, 'shots/s01.json'), { color: 'green' });
  const result = wkd('render', dir); assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /s01 缓存命中/); assert.match(result.stdout, /s02 缓存命中/);
});

test('wkd soundtrack works before the shots are drawn (only s01.js exists)', () => {
  const dir = makeFilm({ s01: SHOT() });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  film.shots.push({ id: 's02', file: 'shots/s02.json', duration: 1 }, { id: 's03', file: 'shots/s03.json', duration: 1 });
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=3', path.join(dir, 'audio', 'tone.wav')]);
  film.audio = { tracks: [{ file: 'audio/tone.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const r = wkd('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.cache', 'mix.wav')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wkd animatic puts the animatic and its contact sheet in review/', opts, () => {
  const dir = makeFilm({ s01: SHOT(), s02: SHOT() });
  const r = wkd('animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  const video = path.join(dir, 'review', '动态分镜.mp4');
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(fs.existsSync(video) && fs.existsSync(sheet));
  assert.ok(r.stdout.includes(`动态分镜：${video}`));
  assert.ok(r.stdout.includes(`接触表：${sheet}`));
  assert.ok(!fs.existsSync(path.join(dir, 'animatic.mp4')));
  assert.ok(fs.existsSync(path.join(dir, 'stills', 'sheet.jpg')), 'stills/sheet.jpg is still written for the director');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voices with chars: true retain measured per-character cues with model shots', opts, () => {
  const dir = makeFilm({ s01: SHOT(), s02: SHOT() });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  // 0.4s 有声 + 0.5s 静音 + 0.4s 有声，对应「春眠，不觉」两个分句
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1.3', '-af', "volume='if(between(t,0.4,0.9),0,1)':eval=frame", path.join(dir, 'audio', 'vo.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠，不觉', at: 0.1, cue: '一', chars: true, file: 'audio/vo.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const r = wkd('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  const cues = JSON.parse(fs.readFileSync(f, 'utf8')).cues;
  assert.deepEqual(Object.keys(cues).filter((k) => k.startsWith('一#')), ['一#1', '一#2', '一#3', '一#4']);
  assert.ok(cues['一#3'][0] >= 0.9, `second clause starts after the pause: ${cues['一#3']}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without drawtext the contact sheet and animatic still carry shot labels (drawn by Chromium)', opts, () => {
  const dir = makeFilm({ s01: SHOT(), s02: SHOT() });
  const r = wkaEnv({ WKD_NO_DRAWTEXT: '1' }, 'animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /不加文字标注/);
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(pixel(sheet, 12, 38)[0] < 200, 'label box in the top-left of the first tile');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest of the tile is still paper');
  const frame = path.join(dir, 'frame.png');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '0.5', '-i', path.join(dir, 'review', '动态分镜.mp4'), '-frames:v', '1', frame]);
  assert.ok(pixel(frame, 23, 58)[0] < 200, 'label box in the animatic frame');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a second soundtrack run with per-character cues leaves film.json untouched', () => {
  const dir = makeFilm({ s01: SHOT() });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.6', path.join(dir, 'audio', 'a.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: 'a', chars: true, file: 'audio/a.wav' }, { text: '不觉', at: 0.7, cue: 'b', file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  assert.equal(wkd('soundtrack', dir).status, 0);
  const first = fs.readFileSync(f, 'utf8');
  const r = wkd('soundtrack', dir);
  assert.match(r.stdout, /声音同步点未变化/);
  assert.equal(fs.readFileSync(f, 'utf8'), first);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('renaming a chars voice clears its old per-character cues and keeps hand-written ones', () => {
  const dir = makeFilm({ s01: SHOT() });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.6', path.join(dir, 'audio', 'a.wav')]);
  film.cues = { 落印: [0.8, 0.9] };
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: '甲', chars: true, file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  assert.equal(wkd('soundtrack', dir).status, 0);
  const renamed = JSON.parse(fs.readFileSync(f, 'utf8'));
  renamed.audio.voices[0].cue = '乙';
  fs.writeFileSync(f, JSON.stringify(renamed));
  const r = wkd('soundtrack', dir);
  assert.equal(r.status, 0, r.stderr);
  const keys = Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).cues);
  assert.deepEqual(keys.filter((k) => k.startsWith('甲#')), []);
  assert.deepEqual(keys.filter((k) => k.startsWith('乙#')), ['乙#1', '乙#2']);
  assert.ok(keys.includes('落印'));
  assert.match(r.stdout, /清掉了已不用的逐字同步点：甲#1…#2/);
  // 人声全删了，逐字点也跟着清掉
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), audio: {} }));
  assert.equal(wkd('soundtrack', dir).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).cues).filter((k) => k.includes('#')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two voices with the same cue name stop wkd soundtrack and leave film.json alone', () => {
  const dir = makeFilm({ s01: SHOT() });
  const f = path.join(dir, 'film.json');
  const film = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(path.join(dir, 'audio'));
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=0.3', path.join(dir, 'audio', 'a.wav')]);
  film.audio = { voice_source: 'user', voices: [{ text: '春眠', at: 0, cue: '甲', file: 'audio/a.wav' }, { text: '不觉', at: 0.5, cue: '甲', file: 'audio/a.wav' }] };
  fs.writeFileSync(f, JSON.stringify(film));
  const before = fs.readFileSync(f, 'utf8');
  const r = wkd('soundtrack', dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /同步点名重复：「甲」用在第 1、2 条/);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a one-shot film still gets a labelled contact sheet from wkd animatic', opts, () => {
  const dir = makeFilm({ s01: SHOT() });
  const r = wkaEnv({ WKD_NO_DRAWTEXT: '1' }, 'animatic', dir);
  assert.equal(r.status, 0, r.stderr);
  const sheet = path.join(dir, 'review', '接触表.jpg');
  assert.ok(fs.existsSync(sheet), r.stdout);
  assert.ok(pixel(sheet, 14, 20)[0] < 200, 'label box in the top-left');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest is still paper');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without drawtext the QC contact sheet still carries labels (drawn by Chromium)', opts, () => {
  // 一镜只有纸色：采样帧都算「空帧」，会抽出超标帧
  const dir = makeFilm({ s01: SHOT() });
  assert.equal(wkd('render', dir).status, 0);
  const r = wkaEnv({ WKD_NO_DRAWTEXT: '1' }, 'qc', dir);
  assert.equal(r.status, 2, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /不加文字标注/);
  const sheet = path.join(dir, 'stills', 'qc', 'qc-sheet.jpg');
  assert.ok(pixel(sheet, 14, 20)[0] < 200, 'label box in the top-left');
  assert.ok(pixel(sheet, 600, 300)[0] > 220, 'the rest is still paper');
  fs.rmSync(dir, { recursive: true, force: true });
});

function pixel(png, x, y) {
 const r = spawnSync('ffmpeg', ['-v','error','-i',png,'-vf',`format=rgb24,crop=1:1:${x}:${y}`,'-f','rawvideo','-pix_fmt','rgb24','-']); return [...r.stdout];
}
