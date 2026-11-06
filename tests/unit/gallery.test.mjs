// README 风格目录只展示实际模型风格，不把旧画廊当作模型作品。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin/catalog.json'), 'utf8'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const block = readme.match(/<!-- gallery -->([\s\S]*?)<!-- \/gallery -->/)[1];

test('README 目录展示三个实际模型风格，不引用历史画廊', () => {
  assert.deepEqual(catalog.styles.map(s => s.id).sort(), ['anime', 'cinematic', 'ink-wash']);
  for (const style of catalog.styles) assert.ok(block.includes(`**${style.name}**`), style.id);
  assert.doesNotMatch(block, /<img|docs\/gallery|Keynote|规划/);
  assert.match(readme, /目前可以选择 3 种画风/);
  assert.match(block, /\| 类型 \| 画风 \|/);
});

test('模型风格提供美术、提示词规范与 JSON 工程示例', () => {
  for (const style of catalog.styles) {
    assert.equal(style.pipeline, 'generation');
    assert.equal(style.status, 'available');
    for (const name of ['SKILL.md', 'STYLE.md', 'TECH.md']) assert.ok(fs.existsSync(path.join(ROOT, 'plugin', style.skill, name)));
    assert.ok(style.examples.length > 0, style.id);
    for (const example of style.examples) {
      const dir = path.join(ROOT, 'plugin', example);
      const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
      assert.ok(film.generation);
      for (const shot of film.shots) {
        assert.equal(path.extname(shot.file), '.json');
        const input = JSON.parse(fs.readFileSync(path.join(dir, shot.file), 'utf8'));
        assert.ok(input.image_prompt && input.video_prompt);
      }
    }
  }
});
