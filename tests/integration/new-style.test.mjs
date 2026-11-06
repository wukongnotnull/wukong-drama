// wkd new style：从引擎模板生成风格目录（用户自建或指定目录贡献）。只跑 CLI，不渲染。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WKA = path.join(ROOT, 'plugin/engine/bin/wkd.mjs');
const FILES = ['SKILL.md', 'STYLE.md', 'TECH.md', 'style.json', 'style.schema.json'];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-new-style-'));
const run = (script, home, ...args) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WUKONG_DRAMA_HOME: home },
  });
const styleJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'style.json'), 'utf8'));

test('默认生成到用户风格目录，占位符全部替换，category 为 custom、order 为 101', () => {
  const home = tmp();
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(home, 'styles', 'paper-cut');
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /__[A-Z_]+__/, `${f} 残留占位符`);
  }
  const json = styleJson(dir);
  assert.equal(json.id, 'paper-cut');
  assert.equal(json.name, '剪纸');
  assert.equal(json.category, 'custom');
  assert.equal(json.order, 101);
  assert.equal(json.pipeline, 'generation');
  assert.equal(json.scripts, undefined);
  assert.equal(fs.existsSync(path.join(dir,'scripts/style.js')),false);
});

test('--dest、--category、--order 生效', () => {
  const home = tmp();
  const dest = path.join(tmp(), 'nested', 'skills');
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸', '--category', 'dongfang', '--order', '7', '--dest', dest);
  assert.equal(r.status, 0, r.stderr);
  const json = styleJson(path.join(dest, 'paper-cut'));
  assert.equal(json.category, 'dongfang');
  assert.equal(json.order, 7);
  assert.equal(fs.existsSync(path.join(home, 'styles', 'paper-cut')), false);
});

test('新建的用户风格出现在 wkd list styles 里', () => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  const r = run(WKA, home, 'list', 'styles');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /paper-cut/);
});

test('目标已存在时拒绝，原有文件不变', () => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  const file = path.join(home, 'styles', 'paper-cut', 'STYLE.md');
  fs.writeFileSync(file, '已经写过的内容');
  const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸');
  assert.notEqual(r.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '已经写过的内容');
});

test('缺 --name、id 不合法、未知类别：失败且不建目录', () => {
  const home = tmp();
  for (const args of [
    ['new', 'style', 'paper-cut'],
    ['new', 'style', 'Paper_Cut', '--name', '剪纸'],
    ['new', 'kit', 'paper-cut', '--name', '剪纸'],
  ]) {
    const r = run(WKA, home, ...args);
    assert.notEqual(r.status, 0, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(home, 'styles')), false);
});

test('--order 不是 1–999 的整数时失败，不建目录', () => {
  const home = tmp();
  for (const order of ['abc', '0', '1000', '3.5']) {
    const r = run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸', '--order', order);
    assert.notEqual(r.status, 0, `--order ${order}`);
  }
  assert.equal(fs.existsSync(path.join(home, 'styles')), false);
});

test('建在插件外：$schema 自包含；隔离插件内保持相对路径且不改源码', t => {
  const home = tmp();
  assert.equal(run(WKA, home, 'new', 'style', 'paper-cut', '--name', '剪纸').status, 0);
  assert.equal(
    styleJson(path.join(home, 'styles', 'paper-cut')).$schema,
    './style.schema.json'
  );
  const isolated = fs.realpathSync(tmp());t.after(()=>fs.rmSync(isolated,{recursive:true,force:true}));
  fs.cpSync(path.join(ROOT,'plugin/engine'),path.join(isolated,'engine'),{recursive:true,filter:source=>!['node_modules','.cache'].includes(path.basename(source))});
  const isolatedCli=path.join(isolated,'engine/bin/wkd.mjs');
  const skills = path.join(isolated, 'skills');
  const sourceSkills=path.join(ROOT,'plugin/skills'),before=fs.readdirSync(sourceSkills).sort();
  const id = 'zz-schema-test';
  try {
    assert.equal(run(isolatedCli, home, 'new', 'style', id, '--name', '测试', '--dest', skills).status, 0);
    const dir = path.join(skills, id);
    const schema = styleJson(dir).$schema;
    assert.equal(schema, '../../engine/schemas/style.schema.json');
    assert.ok(fs.existsSync(path.resolve(dir, schema)));
    assert.deepEqual(fs.readdirSync(sourceSkills).sort(),before);
    assert.equal(fs.existsSync(path.join(sourceSkills,id)),false);
  } finally {
    fs.rmSync(path.join(skills, id), { recursive: true, force: true });
  }
});
