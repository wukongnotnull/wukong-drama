// 统一解析引擎、插件与用户目录。所有路径都从这里取，别处不要拼 ~/.wukong-drama。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_ROOT = path.resolve(here, '..');
export const PLUGIN_ROOT = path.resolve(ENGINE_ROOT, '..');
export const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');
export const CATALOG_FILE = path.join(PLUGIN_ROOT, 'catalog.json');
export const TEMPLATES_DIR = path.join(ENGINE_ROOT, 'templates');

export const ENGINE_VERSION = JSON.parse(
  fs.readFileSync(path.join(ENGINE_ROOT, 'package.json'), 'utf8')
).version;

/** 用户数据根目录，可用环境变量 WUKONG_DRAMA_HOME 覆盖（测试、CI 用）。 */
export const HOME = process.env.WUKONG_DRAMA_HOME || path.join(os.homedir(), '.wukong-drama');

export const CACHE_DIR = path.join(HOME, 'cache');
export const FONT_CACHE_DIR = path.join(CACHE_DIR, 'fonts');
export const SFX_CACHE_DIR = path.join(CACHE_DIR, 'sfx');
export const USER_STYLES_DIR = path.join(HOME, 'styles');

export const SLOT_DIRS = {
  pipeline: path.join(ENGINE_ROOT, 'pipelines'),
  exporter: path.join(ENGINE_ROOT, 'exporters'),
};

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}
