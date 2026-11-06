import { writeModelShot } from '../fixtures/model.mjs';
// 横竖双版：同一部片按画幅出主版和副版。需要真实的 Chromium + ffmpeg（wkd setup）；缺依赖时跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check } from '../../plugin/engine/pipelines/generation/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wkd.mjs');
const ready = (await check()).ok;
const opts = { skip: ready ? false : '模型后期依赖未安装（运行 wkd setup）' };

const FILL = color => color;
const SHOT = color => ({ color });
const BRANCHED = SHOT('#FFFFFF');

/** 主版 320×180、副版 9:16 的最小片子；s01 有竖版覆盖文件（红）。 */
function makeFilm(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-variants-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  writeModelShot(path.join(dir, 'shots', 's01.json'), SHOT(FILL('#F2EDE3')));
  writeModelShot(path.join(dir, 'shots', 's01.9x16.json'), SHOT(FILL('#FF0000')));
  writeModelShot(path.join(dir, 'shots', 's02.json'), BRANCHED);
  writeModelShot(path.join(dir, 'shots', 's02.9x16.json'), {color:'#0000FF'});
  const film = {
    title: 'it', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, generation: {image:{provider:"openai"},video:{provider:"seedance"}},
    shots: [{ id: 's01', file: 'shots/s01.json', duration: 1 }, { id: 's02', file: 'shots/s02.json', duration: 1 }],
    variants: { '9:16': {} },
    export: { name: 'it' },
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

const wkd = (...args) => spawnSync(process.execPath, [WKA, ...args], { encoding: 'utf8', env: { ...process.env, WKD_NO_FONT_DOWNLOAD: '1', WKD_WORKERS: '2' } });
const ok = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

function videoSize(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return r.stdout.trim().split(',').filter(Boolean).map(Number);
}

/** 图片或视频首帧中心像素的 [r, g, b] */
function centerRgb(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'crop=2:2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  return [...r.stdout.subarray(0, 3)];
}
const near = (rgb, want) => rgb.length === 3 && rgb.every((v, i) => Math.abs(v - want[i]) < 24);

test('the main version keeps its paths; the variant renders into .cache/9x16 at its own size', opts, () => {
  const dir = makeFilm();
  ok(wkd('render', dir));
  assert.deepEqual(videoSize(path.join(dir, '.cache', 'video.mp4')), [320, 180]);
  const manifest = fs.readFileSync(path.join(dir, '.cache', 'manifest.json'), 'utf8');

  ok(wkd('render', dir, '--aspect', '9:16'));
  assert.deepEqual(videoSize(path.join(dir, '.cache', '9x16', 'video.mp4')), [180, 320]);
  assert.equal(fs.readdirSync(path.join(dir, '.cache', '9x16', 'segments')).length, 2);
  assert.equal(fs.readFileSync(path.join(dir, '.cache', 'manifest.json'), 'utf8'), manifest, '主版缓存不被副版改动');
});

test('the variant uses aspect-specific JSON shot overrides; the main version does not', opts, () => {
  const dir = makeFilm();
  ok(wkd('still', dir, '--at', 's01:0.5,s02:0.5'));
  ok(wkd('still', dir, '--aspect', '9:16', '--at', 's01:0.5,s02:0.5'));
  assert.ok(near(centerRgb(path.join(dir, 'stills', 's01-0.50s.png')), [242, 237, 227]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', 's02-0.50s.png')), [255, 255, 255]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', '9x16', 's01-0.50s.png')), [255, 0, 0]));
  assert.ok(near(centerRgb(path.join(dir, 'stills', '9x16', 's02-0.50s.png')), [0, 0, 255]));
});

test('variant review files carry the aspect suffix', opts, () => {
  const dir = makeFilm();
  ok(wkd('render', dir, '--proxy', '--aspect', '9:16'));
  assert.ok(fs.existsSync(path.join(dir, 'review', '小样-9x16.mp4')));
  ok(wkd('animatic', dir, '--aspect', '9:16'));
  assert.ok(fs.existsSync(path.join(dir, 'review', '动态分镜-9x16.mp4')));
  assert.ok(fs.existsSync(path.join(dir, 'review', '接触表-9x16.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'review', '小样.mp4')), '主版审阅文件不被写');
});

test('an aspect the film does not declare fails with the usable ones', () => {
  const dir = makeFilm();
  const r = wkd('render', dir, '--aspect', '4:3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /16:9（主版）、9:16/);
  const bare = wkd('render', dir, '--aspect');
  assert.notEqual(bare.status, 0, '--aspect 不带值不能默默处理主版');
  assert.match(bare.stderr + bare.stdout, /--aspect/);
  const bad = wkd('render', makeFilm({ variants: undefined }), '--aspect', '9:16');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /variants/);
});

test('wkd subtitles --aspect writes the variant\'s own srt and English, split for its aspect', () => {
  const text = '每一帧都由代码画出来，镜头版式和声音全都写在工程里。';
  const dir = makeFilm({
    subtitles: { mode: 'burn', bilingual: true },
    audio: { voices: [{ text, at: 0 }] },
    cues: { vo1: [0, 2] },
  });
  ok(wkd('subtitles', dir));
  const mainSrt = fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8');
  const enFile = path.join(dir, 'subtitles.en.json');
  const pairs = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const english = ['Every frame is drawn by code', 'shots, layouts and sound all live in the project'];
  assert.equal(pairs.length, english.length);
  fs.writeFileSync(enFile, JSON.stringify(pairs.map((p, i) => ({ ...p, en: english[i] }))));

  ok(wkd('subtitles', dir, '--aspect', '9:16'));
  const srt = fs.readFileSync(path.join(dir, 'subtitles.9x16.srt'), 'utf8');
  const count = (t) => t.trim().split(/\n\s*\n/).length;
  assert.ok(count(srt) > count(mainSrt), '竖屏每条字数更少，条数更多');
  const vPairs = JSON.parse(fs.readFileSync(path.join(dir, 'subtitles.en.9x16.json'), 'utf8'));
  assert.equal(vPairs.length, count(srt));
  assert.equal(vPairs.map((p) => p.en).join(' '), english.join(' '), '英文沿用主版，只重新拆条');
  assert.equal(fs.readFileSync(path.join(dir, 'subtitles.srt'), 'utf8'), mainSrt, '主版字幕不动');

  // 主版英文改过：默认保留副版手改，显式 force 后重新拆条
  const fixed = english.map((e, i) => (i === 0 ? 'Each frame is drawn in code' : e));
  fs.writeFileSync(enFile, JSON.stringify(pairs.map((p, i) => ({ ...p, en: fixed[i] }))));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(enFile, later, later);
  const beforeRefresh=fs.readFileSync(path.join(dir,'subtitles.en.9x16.json'),'utf8');
  ok(wkd('subtitles', dir, '--aspect', '9:16'));
  assert.equal(fs.readFileSync(path.join(dir,'subtitles.en.9x16.json'),'utf8'),beforeRefresh,'普通检查不得覆盖手改英文');
  ok(wkd('subtitles', dir, '--aspect', '9:16', '--force'));
  const refreshed = JSON.parse(fs.readFileSync(path.join(dir, 'subtitles.en.9x16.json'), 'utf8'));
  assert.equal(refreshed.map((p) => p.en).join(' '), fixed.join(' '));

  // 已存在时只检查不覆盖（可能手改过断句）
  const edited = srt.replace('每一帧', '每一帧 ');
  fs.writeFileSync(path.join(dir, 'subtitles.9x16.srt'), edited);
  ok(wkd('subtitles', dir, '--aspect', '9:16'));
  assert.equal(fs.readFileSync(path.join(dir, 'subtitles.9x16.srt'), 'utf8'), edited);
});

test('wkd qc --aspect checks the variant video and writes its report under .cache/9x16', opts, () => {
  const dir = makeFilm();
  ok(wkd('render', dir, '--proxy', '--aspect', '9:16'));
  wkd('qc', dir, '--proxy', '--aspect', '9:16');
  assert.ok(fs.existsSync(path.join(dir, '.cache', '9x16', 'qc.json')));
  assert.ok(!fs.existsSync(path.join(dir, '.cache', 'qc.json')), '主版质检报告不被写');
});

const report = (dir) => fs.readFileSync(path.join(dir, 'review', '主版不变报告-9x16.md'), 'utf8');
const rowOf = (text, id) => text.split('\n').find((l) => l.startsWith(`| ${id} `)) || '';
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.wkd', 'state.json'), 'utf8'));

test('signing off step 13 snapshots the main version; variant renders report whether it changed', opts, () => {
  const dir = makeFilm();
  ok(wkd('render', dir));
  ok(wkd('signoff', dir, '成片终审通过', '--step', '14'));
  assert.deepEqual(Object.keys(state(dir).approved.main), ['s01', 's02']);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.cache', 'approved')).sort(), ['s01.mp4', 's02.mp4']);

  // 没改代码：哈希相同
  ok(wkd('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(report(dir), /主版画面没有变化/);
  assert.match(rowOf(report(dir), 's01'), /哈希相同/);

  // 只改竖屏分支：主版哈希变了，但重渲后画面一致
  writeModelShot(path.join(dir, 'shots', 's02.json'), {...BRANCHED, revision:'revised-reference'});
  ok(wkd('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(rowOf(report(dir), 's02'), /重渲比对通过/);
  assert.match(report(dir), /主版画面没有变化/);

  // 改了横屏画面：报告置顶写明，命令仍然成功
  writeModelShot(path.join(dir, 'shots', 's01.json'), SHOT(FILL('#000000')));
  ok(wkd('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(report(dir).split('\n').slice(0, 3).join('\n'), /主版有变化/);
  assert.match(rowOf(report(dir), 's01'), /画面有变化/);

  // 快照丢了：改为目视复核
  fs.rmSync(path.join(dir, '.cache', 'approved'), { recursive: true });
  ok(wkd('render', dir, '--aspect', '9:16', '--proxy'));
  assert.match(rowOf(report(dir), 's01'), /快照缺失/);
});

test('a variant signed off before the main version changed is stale: final refuses it, status says so', opts, () => {
  const dir = makeFilm();
  ok(wkd('render', dir));
  ok(wkd('signoff', dir, '终审通过', '--step', '14'));
  ok(wkd('render', dir, '--aspect', '9:16', '--proxy'));
  ok(wkd('signoff', dir, '副版通过', '--step', '15'));
  assert.ok(state(dir).approved.variants['9:16'].shots.s01);

  writeModelShot(path.join(dir, 'shots', 's01.json'), SHOT(FILL('#000000')));
  ok(wkd('render', dir));
  ok(wkd('signoff', dir, '返修后终审通过', '--step', '14'));
  const r = wkd('final', dir, '--aspect', '9:16', '--proxy');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /第 14 道/);

  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-variants-project-'));
  fs.mkdirSync(path.join(projectDir, 'films'));
  fs.cpSync(dir, path.join(projectDir, 'films', 'it'), { recursive: true });
  const status = wkd('status', projectDir);
  ok(status);
  assert.match(status.stdout, /9:16 副版已过期/);
});

test('wkd final --aspect names the variant output with its suffix; --aspect all makes every version', opts, () => {
  const dir = makeFilm();
  ok(wkd('final', dir, '--aspect', '9:16', '--proxy'));
  assert.deepEqual(videoSize(path.join(dir, 'it-9x16-proxy.mp4')), [180, 320]);
  assert.ok(!fs.existsSync(path.join(dir, 'it-proxy.mp4')));
  ok(wkd('final', dir, '--aspect', 'all', '--proxy'));
  assert.deepEqual(videoSize(path.join(dir, 'it-proxy.mp4')), [320, 180]);
  assert.deepEqual(videoSize(path.join(dir, 'it-9x16-proxy.mp4')), [180, 320]);
});
