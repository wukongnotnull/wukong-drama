import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initSeries, readSeries, saveCharacterVersion, approveCharacterVersion, saveEpisodeDraft, confirmEpisode } from '../../plugin/engine/core/series.mjs';

function project(t, entry = 'idea') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-series-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initSeries(dir, { title: '示例系列', entry, input: '一次寻找钥匙的经历' });
  return dir;
}
function character(dir, version = 'v1') {
  return saveCharacterVersion(dir, { id: 'actorA', name: '角色甲', version, appearance: '短发蓝衣角色', voice: '无对白', references: ['assets/actor.png'] });
}
function draft(dir, extra = {}) {
  return saveEpisodeDraft(dir, { episodeId: 'ep01', title: '找到钥匙', relationships: ['两位角色合作寻找钥匙'], events: ['找到遗失的钥匙'], props: ['钥匙留在桌上'], suspense: ['下一次会去哪里'], endState: { actorA: '找到钥匙后回家' }, ...extra });
}

test('three creative entry points initialize isolated series defaults', t => {
  for (const entry of ['idea', 'script', 'storyboard']) {
    const data = readSeries(project(t, entry));
    assert.equal(data.series.entry, entry);
    assert.deepEqual(data.series.defaults, { aspect: '9:16', episodeDuration: [30, 90] });
    assert.deepEqual(data.series.canon, []);
    assert.deepEqual(data.characters.characters, {});
  }
});

test('character versions are immutable and only explicitly approved versions enter canon', t => {
  const dir = project(t);
  character(dir);
  assert.throws(() => character(dir), /已存在/);
  const first = draft(dir, { characterVersions: { actorA: 'v1' } });
  assert.throws(() => confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: first.signature, source: '用户批准第1集' }), /角色.*未确认/);
  assert.throws(() => approveCharacterVersion(dir, { id: 'actorA', version: 'v1', source: '' }), /授权来源/);
  approveCharacterVersion(dir, { id: 'actorA', version: 'v1', source: '用户确认角色甲定妆 v1' });
  character(dir, 'v2');
  const approved = confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: first.signature, source: '用户批准第1集' });
  assert.equal(approved.characterVersions.actorA, 'v1');
  assert.equal(readSeries(dir).characters.characters.actorA.versions.v2.status, 'draft');
});

test('unapproved and superseded drafts never mutate canon; stale approval is rejected', t => {
  const dir = project(t);
  const first = draft(dir);
  assert.deepEqual(readSeries(dir).series.canon, []);
  const second = draft(dir, { events: ['最终事件'], endState: { actorA: '休息' } });
  assert.notEqual(first.signature, second.signature);
  assert.throws(() => confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: first.signature, source: '旧稿认可' }), /已变化/);
  assert.throws(() => confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: second.signature }), /授权来源/);
  const entry = confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: second.signature, source: '用户明确通过当前稿' });
  assert.deepEqual(entry.events, ['最终事件']);
  assert.deepEqual(entry.endState, { actorA: '休息' });
  draft(dir, { events: ['未批准的返修'] });
  assert.deepEqual(readSeries(dir).series.canon[0].events, ['最终事件']);
  assert.equal(readSeries(dir).series.canon.length, 1);
});

test('confirmed episode revisions preserve older selected continuity', t => {
  const dir = project(t);
  const first = draft(dir);
  confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: first.signature, source: '第1稿通过' });
  const second = draft(dir, { events: ['返修后的结尾'] });
  confirmEpisode(dir, { episodeId: 'ep01', expectedSignature: second.signature, source: '第2稿通过' });
  const data = readSeries(dir).series;
  assert.equal(data.canon.length, 1);
  assert.deepEqual(data.canon[0].events, ['返修后的结尾']);
  assert.equal(data.history.length, 2);
  assert.deepEqual(data.history[0].events, ['找到遗失的钥匙']);
});

test('invalid identifiers, unknown input modes, corrupt files and unsafe references fail without canon writes', t => {
  const dir = project(t);
  assert.throws(() => saveEpisodeDraft(dir, { episodeId: '../outside' }), /编号/);
  assert.throws(() => saveEpisodeDraft(dir, { episodeId: 'ep01', entry: 'unknown' }), /创作入口/);
  assert.throws(() => saveCharacterVersion(dir, { id: 'cat', name: '猫', version: 'v1', appearance: '橘猫', references: ['../private.png'] }), /参考图/);
  assert.throws(() => saveCharacterVersion(dir, { id: '__proto__', name: '猫', version: 'v1', appearance: '橘猫' }), /编号/);
  assert.throws(() => saveEpisodeDraft(dir, { episodeId: 'ep01', characterVersions: { absent: 'v1' } }), /角色版本不存在/);
  assert.deepEqual(readSeries(dir).series.canon, []);
  fs.writeFileSync(path.join(dir, 'series.json'), '{broken');
  assert.throws(() => readSeries(dir), /无法读取/);
});

test('read-only inspection does not create files and init refuses to overwrite existing series', t => {
  const dir = project(t);
  const before = fs.readFileSync(path.join(dir, 'series.json'), 'utf8');
  assert.throws(() => initSeries(dir, { title: '另一部' }), /已存在/);
  readSeries(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'series.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, '.wkd-series', 'lock')), false);
});
