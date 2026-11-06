// A remembered recommendation is never an approval. Routes are bound per production asset.
import path from 'node:path';
import { atomicJson } from '../core/evidence.mjs';
import { generationLock, strictJson } from './generation-budget.mjs';
import { settingsRoot } from '../core/settings.mjs';

const routeFile = job => path.join(job.filmDir,'.wkd/image-routes.json');
const preferenceFile = job => path.join(settingsRoot(job.filmDir),'.wkd/image-preference.json');
export const imageTarget = (job,shot) => `${job.imageStage||'shots'}/${job.variant?.aspect||'16:9'}/${shot.id}`;
export function storedImageRoute(job,shot) {
  const data=strictJson(routeFile(job),{version:1,items:{}});
  if(data.version!==1||!data.items||typeof data.items!=='object')throw new Error('图片来源记录损坏');
  return data.items[imageTarget(job,shot)]||null;
}
export function imageRoute(job,shot) {
  const route=(job.preserveImages?.has(shot.id)?null:job.imageRoute)||storedImageRoute(job,shot)||{method:'api'};
  if(!['host','api'].includes(route.method))throw new Error('图片来源记录无效，不能自动切换到 API');
  return route;
}
export function imagePreference(job) { return strictJson(preferenceFile(job))?.method||null; }
export function saveImageRoutes(job,entries,method) {
  const unlock=generationLock(routeFile(job)+'.lock');
  try {
    const data=strictJson(routeFile(job),{version:1,items:{}});
    if(data.version!==1||!data.items||typeof data.items!=='object')throw new Error('图片来源记录损坏');
    for(const {shot,route} of entries)data.items[imageTarget(job,shot)]=route;
    atomicJson(routeFile(job),data);
  } finally { unlock(); }
  const release=generationLock(preferenceFile(job)+'.lock');
  try { atomicJson(preferenceFile(job),{version:1,method,updatedAt:new Date().toISOString()}); }
  finally { release(); }
}
export function hostConfig(host) {
  if(!host||host.available!==true||['id','label','tool','evidence'].some(k=>typeof host[k]!=='string'||!host[k].trim()))throw new Error('未核实当前可调用的 Agent 生图工具');
  if(typeof host.references!=='boolean'||typeof host.edit!=='boolean'||!(host.maxReferences===null||Number.isInteger(host.maxReferences)&&host.maxReferences>=0))throw new Error('宿主参考图／编辑能力声明不完整');
  return {provider:'host',name:host.id,tool:host.tool,label:host.label,references:host.references,edit:host.edit,maxReferences:host.maxReferences};
}
export function validateHostRequest(config,references) {
  if(references.length&&(!config.references||!config.edit))throw new Error('当前宿主不支持本批参考图／图片修改');
  if(config.maxReferences!==null&&references.length>config.maxReferences)throw new Error('本批参考图数量超过宿主能力，不可丢弃参考图');
}
