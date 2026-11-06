// 模型风格解析：校验引擎版本并选择 generation 管线。
import { ENGINE_VERSION } from './paths.mjs';
import { satisfies } from './semver.mjs';

export function resolveStyle(style, registry) {
  const errors = [];
  if (!satisfies(ENGINE_VERSION, style.engine)) {
    errors.push(`风格 ${style.id} 需要引擎 ${style.engine}，当前是 ${ENGINE_VERSION}`);
  }
  if (style.pipeline !== 'generation') errors.push(`风格 ${style.id} 必须使用 generation 模型管线，不再支持代码动画管线`);
  const pipeline = registry.pipelines.get(style.pipeline);
  if (!pipeline) errors.push(`风格 ${style.id} 需要管线 "${style.pipeline}"，但它没有注册`);
  else if (pipeline.status === 'planned') errors.push(`管线 "${style.pipeline}" 还在规划中（status: planned），暂不可用`);
  return { pipeline, errors };
}
