#!/usr/bin/env node
// 扫描所有风格 → 生成 plugin/catalog.json（director 选风格用）
// 并刷新 README.md 里 <!-- gallery --> 与 <!-- progress --> 之间的内容。
// 用法：node tools/build-catalog.mjs [--check]   --check 只校验是否最新（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WUKONG_DRAMA_HOME = process.env.WUKONG_DRAMA_HOME || path.join(ROOT, '.tmp-home'); // 不把用户风格写进目录
const { getStyles, getRegistry } = await import(path.join(ROOT, 'plugin/engine/core/registry.mjs'));
const { resolveStyle } = await import(path.join(ROOT, 'plugin/engine/core/resolver.mjs'));

const categoryNames = { dongfang: '东方神韵', katong: '卡通漫画', dianying: '真人影视' };
const { styles, problems } = getStyles();
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const reg = getRegistry();

function bestFor(dir) {
  const f = path.join(dir, 'STYLE.md');
  if (!fs.existsSync(f)) return [];
  const m = fs.readFileSync(f, 'utf8').match(/^适合[:：]\s*(.+)$/m);
  return m ? m[1].split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : [];
}

const entries = [...styles.values()].filter((st) => st.origin === 'builtin').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((st) => {
  const ok = resolveStyle(st, reg).errors.length === 0;
  const examples = fs.existsSync(path.join(st.dir, 'examples'))
    ? fs.readdirSync(path.join(st.dir, 'examples')).filter((d) => fs.existsSync(path.join(st.dir, 'examples', d, 'film.json')))
    : [];
  return {
    id: st.id,
    order: st.order,
    name: st.name,
    name_en: st.name_en,
    category: st.category,
    categoryName: categoryNames[st.category] || st.category,
    status: ok ? 'available' : 'broken',
    pipeline: st.pipeline,
    keywords: st.keywords,
    best_for: bestFor(st.dir),
    skill: `skills/${st.id}`,
    examples: examples.map((e) => `skills/${st.id}/examples/${e}`),
  };
});
const categories = Object.fromEntries(entries.map((entry) => [entry.category, entry.categoryName]));

const done = entries.filter((e) => e.status === 'available').length;
const catalog = {
  _generated: '由 tools/build-catalog.mjs 生成，请勿手改',
  progress: { done, total: entries.length },
  categories,
  styles: entries,
};
const out = path.join(ROOT, 'plugin/catalog.json');
const text = JSON.stringify(catalog, null, 2) + '\n';

// README 片段
const progress = `**目前可以选择 ${done} 种画风**`;
const rows = Object.entries(categories).map(([cat, cname]) => {
  const list = entries.filter((e) => e.category === cat).map((e) => (e.status === 'available' ? `**${e.name}**` : e.name));
  return `| ${cname} | ${list.join(' · ')} |`;
});
const gallery = ['| 类型 | 画风 |', '|---|---|', ...rows].join('\n');

const replaceBlock = (src, tag, body) =>
  src.replace(new RegExp(`(<!-- ${tag} -->)[\\s\\S]*?(<!-- /${tag} -->)`), `$1\n${body}\n$2`);

const check = process.argv.includes('--check');
let stale = false;
if (check) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) stale = true;
} else {
  fs.writeFileSync(out, text);
}
for (const f of ['README.md']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const next = replaceBlock(replaceBlock(src, 'progress', progress), 'gallery', gallery);
  if (check) stale ||= next !== src;
  else fs.writeFileSync(p, next);
}
fs.rmSync(path.join(ROOT, '.tmp-home'), { recursive: true, force: true });
if (check && stale) {
  console.error('catalog.json 或 README 不是最新的，请运行 node tools/build-catalog.mjs');
  process.exit(1);
}
console.log(`${check ? '校验通过' : '已生成'} catalog.json：${done} 个模型风格可用`);
