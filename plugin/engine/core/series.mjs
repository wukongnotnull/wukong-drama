// 项目级角色档案和确认版连续性；制作草稿与正式设定分开保存。
import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, digest } from './evidence.mjs';

const ENTRY_MODES = new Set(['idea', 'script', 'storyboard']);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const now = () => new Date().toISOString();
function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}
function identifier(value, label = '编号') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value) || reserved.has(value)) throw new Error(`${label}无效`);
  return value;
}
function mode(value) {
  if (!ENTRY_MODES.has(value)) throw new Error('创作入口应为 idea、script 或 storyboard');
  return value;
}
function paths(projectDir) {
  const root = path.resolve(projectDir);
  return { root, series: path.join(root, 'series.json'), characters: path.join(root, 'characters.json'), data: path.join(root, '.wkd-series'), drafts: path.join(root, '.wkd-series', 'drafts') };
}
function read(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`无法读取 ${file}：${error.message}`); }
  if (!object(value) || value.version !== 1) throw new Error(`不支持的系列文件：${file}`);
  return value;
}
function loaded(p) {
  const series = read(p.series), characters = read(p.characters);
  if (!Array.isArray(series.canon) || !Array.isArray(series.history) || !object(characters.characters)) throw new Error('系列文件结构无效');
  return { series, characters };
}
function mutate(projectDir, fn) {
  const p = paths(projectDir);
  fs.mkdirSync(p.data, { recursive: true });
  const lock = path.join(p.data, 'lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`系列项目正在写入，或有待核实的中断锁：${lock}`); throw error; }
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now() })); return fn(p); }
  finally { fs.closeSync(fd); fs.rmSync(lock); }
}
export { mutate as withSeriesLock };
function versionAt(characters, id, version) {
  identifier(id, '角色编号'); identifier(version, '角色版本编号');
  const record = Object.hasOwn(characters.characters, id) ? characters.characters[id] : null;
  const value = record && object(record.versions) && Object.hasOwn(record.versions, version) ? record.versions[version] : null;
  if (!value) throw new Error(`角色版本不存在：${id}@${version}`);
  return value;
}
function referencesAt(root, references) {
  if (!Array.isArray(references)) throw new Error('参考图必须是路径数组');
  return references.map(ref => {
    if (typeof ref !== 'string' || !ref.trim() || path.isAbsolute(ref) || ref.includes('\\') || ref.split('/').some(part => part === '..' || !part)) throw new Error('角色参考图必须是项目内的相对路径');
    const target = path.resolve(root, ref), realRoot = fs.realpathSync(root);
    // 草稿允许先登记尚未完成的参考图；存在的路径不能通过符号链接越出工程。
    let existing = target;
    while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
    const real = fs.realpathSync(existing);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('角色参考图不能越出项目');
    return ref;
  });
}
function textList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label}必须是非空文字数组`);
  return value.map(item => item.trim());
}
function endState(value) {
  if (value === undefined) return {};
  if (!object(value) || Object.entries(value).some(([key, state]) => reserved.has(key) || !key.trim() || typeof state !== 'string' || !state.trim())) throw new Error('每集结束状态必须是名称到状态文字的对象');
  return { ...value };
}

export function initSeries(projectDir, { title, entry = 'idea', input = '' } = {}) {
  required(title, '剧集名称'); mode(entry);
  if (typeof input !== 'string') throw new Error('创作输入必须是文字');
  return mutate(projectDir, p => {
    if (fs.existsSync(p.series) || fs.existsSync(p.characters)) throw new Error('系列项目文件已存在，不覆盖');
    const series = { version: 1, title: title.trim(), entry, input, defaults: { aspect: '9:16', episodeDuration: [30, 90] }, canon: [], history: [], createdAt: now() };
    const characters = { version: 1, characters: {} };
    atomicJson(p.characters, characters); atomicJson(p.series, series);
    return { series, characters };
  });
}

export function readSeries(projectDir) {
  const p = paths(projectDir), data = loaded(p);
  const drafts = fs.existsSync(p.drafts) ? fs.readdirSync(p.drafts).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(name)).sort().map(name => read(path.join(p.drafts, name))) : [];
  return { ...data, drafts };
}

export function saveCharacterVersion(projectDir, { id, name, version, appearance, voice = '', references = [], notes = '' } = {}) {
  identifier(id, '角色编号'); identifier(version, '角色版本编号'); required(name, '角色名称'); required(appearance, '角色外观');
  if (typeof voice !== 'string' || typeof notes !== 'string') throw new Error('角色声线和备注必须是文字');
  return mutate(projectDir, p => {
    const { characters } = loaded(p);
    const current = Object.hasOwn(characters.characters, id) ? characters.characters[id] : { id, name: name.trim(), versions: {} };
    if (!object(current.versions)) throw new Error('角色档案版本结构无效');
    if (Object.hasOwn(current.versions, version)) throw new Error(`角色版本已存在：${id}@${version}；换装或年龄变化请建立新版本`);
    const value = { version, name: name.trim(), appearance: appearance.trim(), voice, references: referencesAt(p.root, references), notes, status: 'draft', createdAt: now() };
    characters.characters[id] = { ...current, versions: { ...current.versions, [version]: value } };
    atomicJson(p.characters, characters);
    return value;
  });
}

export function approveCharacterVersion(projectDir, { id, version, source } = {}) {
  required(source, '授权来源');
  return mutate(projectDir, p => {
    const { characters } = loaded(p), value = versionAt(characters, id, version);
    if (value.status === 'approved') return value;
    const approved = { ...value, status: 'approved', approval: { source: source.trim(), at: now() } };
    characters.characters[id].versions[version] = approved;
    atomicJson(p.characters, characters);
    return approved;
  });
}

export function saveEpisodeDraft(projectDir, { episodeId, title = '', entry, input = '', characterVersions = {}, relationships, events, props, suspense, endState: ending } = {}) {
  identifier(episodeId, '单集编号');
  if (typeof title !== 'string' || typeof input !== 'string') throw new Error('单集标题与输入必须是文字');
  if (!object(characterVersions)) throw new Error('角色版本引用必须是对象');
  return mutate(projectDir, p => {
    const { series, characters } = loaded(p);
    for (const [id, version] of Object.entries(characterVersions)) versionAt(characters, id, version);
    const content = { version: 1, episodeId, title, entry: mode(entry ?? series.entry), input, characterVersions: { ...characterVersions }, relationships: textList(relationships, '人物关系'), events: textList(events, '事件'), props: textList(props, '道具'), suspense: textList(suspense, '悬念'), endState: endState(ending) };
    const value = { ...content, signature: digest(content), savedAt: now() };
    atomicJson(path.join(p.drafts, episodeId + '.json'), value);
    return value;
  });
}

export function confirmEpisode(projectDir, { episodeId, source, expectedSignature } = {}) {
  identifier(episodeId, '单集编号'); required(source, '授权来源'); required(expectedSignature, '当前草稿签名');
  return mutate(projectDir, p => {
    const { series, characters } = loaded(p);
    const draft = read(path.join(p.drafts, episodeId + '.json'));
    const { signature, savedAt: _savedAt, ...content } = draft;
    if (signature !== expectedSignature || digest(content) !== expectedSignature) throw new Error('单集草稿已变化，请重新审阅当前版本');
    for (const [id, version] of Object.entries(draft.characterVersions || {})) if (versionAt(characters, id, version).status !== 'approved') throw new Error(`角色 ${id}@${version} 未确认，不能加入正式设定`);
    const previous = series.canon.find(item => item.episodeId === episodeId);
    if (previous?.signature === signature) return previous;
    const approved = { ...content, signature, status: 'confirmed', approval: { source: source.trim(), at: now() } };
    const index = series.canon.findIndex(item => item.episodeId === episodeId);
    if (index < 0) series.canon.push(approved); else series.canon[index] = approved;
    series.history.push(approved);
    atomicJson(p.series, series);
    return approved;
  });
}
