import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WKA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/engine/bin/wkd.mjs');
const init = (style) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-init-'));
  const r = spawnSync(process.execPath, [WKA, 'init', 'demo', '--style', style, '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return path.join(dir, 'films', 'demo');
};

for (const style of ['anime', 'cinematic', 'ink-wash']) {
  test(`${style} 新片使用 JSON 模型镜头`, () => {
    const film = init(style);
    assert.deepEqual(fs.readdirSync(path.join(film, 'shots')), ['s01.json']);
    const json = JSON.parse(fs.readFileSync(path.join(film, 'film.json'), 'utf8'));
    assert.equal(json.shots[0].file, 'shots/s01.json');
    assert.equal(json.generation.video.provider, 'seedance');
    assert.equal(json.scripts, undefined);
  });
}
