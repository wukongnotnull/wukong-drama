import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry, getStyles } from '../../plugin/engine/core/registry.mjs';
import { loadFilm } from '../../plugin/engine/core/film-context.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const generation = { image: { provider: 'openai' }, video: { provider: 'seedance' } };
test('the public catalog contains exactly the three available model styles', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'plugin/catalog.json')));
  assert.deepEqual(catalog.styles.map(s => s.id).sort(), ['anime', 'cinematic', 'ink-wash']);
  assert.ok(catalog.styles.every(s => s.status === 'available' && s.pipeline === 'generation'));
  const builtins = [...getStyles().styles.values()].filter(s => s.origin === 'builtin');
  assert.deepEqual(builtins.map(s => s.id).sort(), ['anime', 'cinematic', 'ink-wash']);
  assert.ok(builtins.every(s => s.pipeline === 'generation'));
});
test('only the generation visual pipeline is registered', () => {
  assert.deepEqual([...getRegistry({ fresh: true }).pipelines.keys()], ['generation']);
});
for (const kind of ['missing-generation', 'code-shot']) test(`model-only loader rejects ${kind} before rendering`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-model-only-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = kind === 'code-shot' ? 's01.js' : 's01.json';
  fs.writeFileSync(path.join(dir, file), kind === 'code-shot' ? 'wk.shot({render(){}});' : '{}');
  const film = { title: 'model only', style: 'ink-wash', size: [160, 90], fps: 10, seed: 1,
    shots: [{ id: 's01', file, duration: 1 }], ...(kind === 'code-shot' ? { generation } : {}) };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  assert.throws(() => loadFilm(dir), /generation|模型|JSON|json/);
  assert.equal(fs.existsSync(path.join(dir, '.cache')), false);
});
test('removed visual engines and Keynote do not exist in the distributed source tree', () => {
  for (const rel of ['engine/pipelines/browser', 'engine/pipelines/remotion', 'engine/pipelines/manim', 'engine/runtime', 'engine/kits', 'skills/keynote']) {
    assert.equal(fs.existsSync(path.join(root, 'plugin', rel)), false, rel);
  }
});
