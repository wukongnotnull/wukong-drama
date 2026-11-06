// 工程读取与上下文解析，不依赖渲染或交付编排。
import fs from 'node:fs';
import path from 'node:path';
import { getRegistry, getStyles } from './registry.mjs';
import { resolveStyle } from './resolver.mjs';
import { validate } from './validate.mjs';
import { mergeSubtitleStyle } from './subtitle-layer.mjs';
import { resolveVariant, overrideShotPath } from './variants.mjs';
import { assertCompatibleProgress } from './state.mjs';

/**
 * @param {{requireShots?: boolean, aspect?: string|null}} [o] requireShots: false 时不检查镜头文件是否存在（制作声音时尚未完成镜头描述）；
 *   aspect: 要处理的画幅，缺省为主版。副版换成副版尺寸、优先用覆盖镜头文件 sNN.<后缀>.<扩展名>
 */
export function loadFilm(filmDir, { requireShots = true, aspect = null } = {}) {
  assertCompatibleProgress(filmDir);
  filmDir = path.resolve(filmDir);
  const file = path.join(filmDir, 'film.json');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const rawFilm = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!rawFilm.generation) throw new Error('此工程缺少 generation 模型配置。wukong-drama 只支持图片与视频模型创作，不再支持代码动画工程。');
  if (rawFilm.scripts !== undefined) throw new Error('模型工程不支持 scripts 代码画面；请使用 JSON 镜头描述和参考素材。');
  if (Array.isArray(rawFilm.shots) && rawFilm.shots.some(s => typeof s?.file === 'string' && !s.file.endsWith('.json'))) throw new Error('模型工程的镜头必须是 .json 文件，不支持 JavaScript、TypeScript 或其他代码镜头。');
  const errs = validate('film', rawFilm, 'film.json');
  if (errs.length) throw new Error('film.json 校验失败:\n  ' + errs.join('\n  '));
  const ids = new Set();
  for (const shot of rawFilm.shots) {
    if (ids.has(shot.id)) throw new Error(`film.json 镜头编号重复：${shot.id}；请修改编号后重试`);
    ids.add(shot.id);
  }

  const registry = getRegistry();
  const { styles } = getStyles();
  const style = styles.get(rawFilm.style);
  if (!style) throw new Error(`film.json 使用的风格 "${rawFilm.style}" 不存在。可用: ${[...styles.keys()].join(', ')}`);
  const resolved = resolveStyle(style, registry);
  if (resolved.errors.length) throw new Error('风格解析失败:\n  ' + resolved.errors.join('\n  '));

  const variant = resolveVariant({ film: rawFilm, style, filmDir }, aspect);
  const film = variant.isMain ? rawFilm : { ...rawFilm, size: variant.size };

  let t = 0;
  const shots = film.shots.map((s) => {
    const shot = { ...s, start: t, path: overrideShotPath(path.join(filmDir, s.file), variant.suffix) };
    if (requireShots && !fs.existsSync(shot.path)) throw new Error(`镜头 ${s.id} 的文件不存在: ${s.file}`);
    t += s.duration;
    return shot;
  });

  // 片子可以单独改字幕样式（film.json 的 subtitles.style），副版还能再覆盖一层；不用动插件目录里的 style.json
  const { by_aspect: byAspect = {}, ...baseSubtitles } = style.subtitles || {};
  const resolvedSubtitles = [byAspect[variant.aspect],film.subtitles?.style,variant.overrides.subtitles?.style].filter(Boolean)
    .reduce((acc,o)=>mergeSubtitleStyle(acc,o),baseSubtitles);
  const filmStyle = { ...style, subtitles: resolvedSubtitles };
  return { film, filmDir, style: filmStyle, registry, ...resolved, shots, totalDuration: t, variant };
}

