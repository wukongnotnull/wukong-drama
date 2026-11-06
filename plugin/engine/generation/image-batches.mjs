// Host calls stay in the agent. The engine prepares and verifies their durable handoff.
import { generationPlan, approveGeneration, ensureImage, imageTaskStatus, prepareHostImage, importHostImage } from './generation.mjs';
import { hostConfig, imagePreference, storedImageRoute } from './image-source.mjs';
import { assertProviderReady } from '../providers/index.mjs';

function batchJob(job,batch) {
  if(!batch)return {...job};
  if(!['art','settings','edit'].includes(batch.stage)||!Array.isArray(batch.items)||!batch.items.length)throw new Error('图片批次需要 art/settings/edit 阶段与非空 items');
  if(Object.keys(batch).some(k=>!['stage','items','aspect','generation'].includes(k)))throw new Error('图片批次含未知顶层字段');
  const ids=new Set();
  const shots=batch.items.map(item=>{
    if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id)||ids.has(item.id))throw new Error('图片素材编号无效或重复');
    ids.add(item.id);
    if(Object.keys(item).some(k=>!['id','prompt','references','settings','revision'].includes(k)))throw new Error('图片批次含未知字段');
    if(typeof item.prompt!=='string'||!item.prompt.trim())throw new Error('图片素材缺少提示词');
    if(batch.stage==='edit'&&!item.references?.length)throw new Error('图片修改必须附上实际原图 references');
    return {id:item.id,definition:{image_prompt:item.prompt,...Object.fromEntries(['references','settings','revision'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]]))}};
  });
  return {...job,imageStage:batch.stage,shots,generationShots:undefined};
}
function retainCompleted(job) {
  const preserveImages=new Set();
  for(const shot of job.shots) {
    try {if(['completed','imported'].includes(imageTaskStatus(job,shot).status))preserveImages.add(shot.id);}
    catch(e) {
      // Invalid API config must not hide an otherwise available host option. Persisted
      // routes, however, may contain successful sources and may never be discarded.
      if(storedImageRoute(job,shot)||!['unknown_provider','invalid_config','invalid_model','invalid_url','inline_credentials'].includes(e.code))throw e;
    }
  }
  return {...job,preserveImages};
}
function routeJob(job,method,host) {
  if(!['api','host'].includes(method))throw new Error('必须明确选择 --method host 或 api');
  if(method==='host')hostConfig(host);
  return {...job,imageRoute:{method,...(method==='host'?{host}:{})}};
}
function planRoute(job,method,host,options) {
  try {
    const ctx=routeJob(job,method,host),plan=generationPlan(ctx,'image');
    const problems=[...plan.problems];
    if(method==='api'&&plan.newTasks)try{assertProviderReady('image',job.film.generation?.image||{},options);}catch(e){problems.push(e.message);}
    if(plan.items.some(i=>!['new','completed','imported'].includes(i.status)))problems.push('本批存在已提交但尚未回收的结果；请先核对并导入，不能自动重复生成');
    return {...plan,method,label:method==='host'?host.label:'自定义 API',problems,allowed:problems.length===0};
  } catch(e) {return {method,allowed:false,problems:[e.message],items:[]};}
}
export function imageBatchPlan(job,{batch,host,...options}={}) {
  const ctx=retainCompleted(batchJob(job,batch));
  const routes={host:planRoute(ctx,'host',host,options),api:planRoute(ctx,'api',host,options)};
  const previous=imagePreference(ctx),recommended=routes[previous]?.allowed?previous:routes.host.allowed?'host':routes.api.allowed?'api':null;
  return {version:1,stage:ctx.imageStage||'shots',remaining:ctx.shots.length-ctx.preserveImages.size,recommended,routes};
}
export function approveImageBatch(job,{batch,host,method,signature,source,...options}={}) {
  const plan=imageBatchPlan(job,{batch,host,...options}),route=plan.routes[method];
  if(!route)throw new Error('必须明确选择 --method host 或 api');
  if(!route.allowed)throw new Error(route.problems.join('；'));
  if(!signature||route.signature!==signature)throw new Error('本批签名已变化或过期，请重新展示并选择');
  if(!plan.remaining)throw new Error('本批图片均已完成，无需重复授权或生成');
  return approveGeneration(routeJob(retainCompleted(batchJob(job,batch)),method,host),'image',{source});
}
export async function dispatchImageBatch(job,{batch,host,method,item,...options}={}) {
  const ctx=routeJob(retainCompleted(batchJob(job,batch)),method,host);
  const remaining=ctx.shots.filter(s=>!ctx.preserveImages.has(s.id));
  if(item&&!remaining.some(s=>s.id===item))throw new Error('指定素材不属于本批待生成项');
  if(!remaining.length)return {status:'completed',items:[]};
  // The persisted route must agree, even when an older approval for another method exists.
  for(const shot of remaining)if(storedImageRoute(ctx,shot)?.method!==method)throw new Error('缺少本批来源选择，或已切换到其他方式；请重新选择并授权');
  if(method==='host')return prepareHostImage(ctx,item?remaining.find(s=>s.id===item):remaining[0]);
  const outputs=[];
  for(const shot of item?remaining.filter(s=>s.id===item):remaining)outputs.push({item:shot.id,output:await ensureImage(ctx,shot,options)});
  return {status:'completed',method,items:outputs};
}
export async function importImageBatch(job,{batch,host,method,item,...input}={}) {
  if(method!=='host')throw new Error('image-import 只回收已选择的宿主结果');
  const ctx=routeJob(batchJob(job,batch),'host',host),shot=ctx.shots.find(s=>s.id===item);
  if(!shot||storedImageRoute(ctx,shot)?.method!=='host')throw new Error('素材尚未选择宿主来源');
  return importHostImage(ctx,shot,input);
}
