// Model assets are persistent production sources, never disposable render cache.
import fs from 'node:fs';
import path from 'node:path';
import * as providers from '../providers/index.mjs';
import { digest, fileDigest, atomicJson } from '../core/evidence.mjs';
import { generationLock, strictJson, budgetSummary, saveApproval, reserveRequest, finishReservation, requireGenerationApproval } from './generation-budget.mjs';
import { resolveShotSettings, requireSettingsInventory } from '../core/settings.mjs';
import { imageRoute, saveImageRoutes, hostConfig, validateHostRequest } from './image-source.mjs';
import { imageMime, atomicWrite } from '../providers/media.mjs';
import { run as ffmpeg } from '../core/ffmpeg.mjs';

function localFile(dir, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('素材必须使用片目录内的相对路径');
  const target = path.resolve(dir, relative), root = fs.realpathSync(dir);
  if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('素材不能越出片目录');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile() || !fs.statSync(target).size) throw new Error(`素材不存在或为空：${relative}`);
  if (!fs.realpathSync(target).startsWith(root + path.sep)) throw new Error('素材符号链接不能越出片目录');
  return target;
}
function snapshot(file) { return file && fs.existsSync(file) ? { file, sha256: fileDigest(file), bytes: fs.statSync(file).size } : null; }
function readShot(job, shot) {
  let value;
  try { value = job.imageStage ? shot.definition : JSON.parse(fs.readFileSync(localFile(job.filmDir, shot.path ? path.relative(job.filmDir,shot.path) : shot.file), 'utf8')); }
  catch { throw new Error(`镜头 ${shot.id} 必须是有效的 JSON 模型镜头`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`镜头 ${shot.id} 描述无效`);
  const keys = ['image_prompt','video_prompt','references','image','video','revision','settings'];
  if (Object.keys(value).some(x => !keys.includes(x))) throw new Error(`镜头 ${shot.id} 含未知字段`);
  for (const key of ['image_prompt','video_prompt','image','video','revision']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !value[key].trim())) throw new Error(`镜头 ${shot.id} 的 ${key} 必须是非空字符串`);
  if (value.references !== undefined && (!Array.isArray(value.references) || value.references.length > 16)) throw new Error('references 必须为最多 16 项的本地参考图列表');
  const settings=['art','settings'].includes(job.imageStage)&&value.settings===undefined?{bindings:[],references:[],prompt:''}:resolveShotSettings(job,value);
  const references=[...new Set([...(value.references||[]).map(x=>localFile(job.filmDir,x)),...settings.references])];
  if(references.length>16)throw new Error('镜头与设定合计参考图超过 16 张，请精选必要视图');
  return { ...value, ...Object.fromEntries(['image_prompt','video_prompt'].filter(k=>value[k]&&settings.prompt).map(k=>[k,value[k]+'\n\n'+settings.prompt])), settings:settings.bindings, references, image: value.image && localFile(job.filmDir, value.image), video: value.video && localFile(job.filmDir, value.video) };
}
function configFor(job, kind) { return providers.resolveProvider(kind, job.film.generation?.[kind] || {}); }
function semanticConfig(config) {
  const { request_timeout_ms, estimated_cost_usd, estimated_cost_cny, ...value } = config;
  return value;
}
function imageSize(job, config) {
  if (config.size) return config.size;
  const [w,h] = [job.designW, job.designH].every(Number.isFinite) ? [job.designW,job.designH] : job.film.size || [1920,1080];
  if (w === h) return '1024x1024';
  return w > h ? `1536x${Math.round(1536*h/w/16)*16}` : `${Math.round(1536*w/h/16)*16}x1536`;
}
function rootFor(job, shot) {
  if(job.imageStage&&!['art','settings','edit'].includes(job.imageStage))throw new Error('未知图片生成阶段');
  if (!(job.imageStage?/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/:/^s\d{2,3}$/).test(shot.id)) throw new Error('模型素材编号必须是安全标识');
  const aspect = job.variant?.aspect || '16:9';
  if (!/^\d+:\d+$/.test(aspect)) throw new Error('生成画幅无效');
  return path.join(job.filmDir, 'assets/generated',...(job.imageStage?['designs',job.imageStage]:[]), aspect.replace(':','x'), shot.id);
}
function stateAt(dir, kind, signature) {
  const folder = path.join(dir, `${kind}-${signature}`);
  const stateFile = path.join(folder, 'state.json');
  const state = strictJson(stateFile);
  if (state && (state.version !== 1 || state.signature !== signature || state.kind !== kind || !['submitting','submitted','completed','failed','cancelled','expired'].includes(state.status))) throw new Error('生成任务记录不兼容，已停止自动调用');
  return { folder, stateFile, state, output: path.join(folder, kind === 'image' ? 'source.png' : 'source.mp4') };
}
function imageRequest(job, shot, definition = readShot(job, shot)) {
  const route=imageRoute(job,shot);
  const config = definition.image?{provider:'imported'}:route.method==='host'?hostConfig(route.host):configFor(job, 'image'), size = imageSize(job, config);
  const input = { version:1,kind:'image',shot:shot.id,aspect:job.variant?.aspect || '16:9',style:job.style?.id,config:semanticConfig(config),size,prompt:definition.image_prompt || '',revision:definition.revision || '',references:definition.references.map(file => ({path:path.relative(job.filmDir,file),sha256:fileDigest(file)})) };
  if(definition.settings.length)input.settings=definition.settings;
  if(job.imageStage)input.stage=job.imageStage;
  const signature = digest(input);
  return { ...stateAt(rootFor(job,shot), 'image', signature), kind:'image',signature,input,config,definition,imported:definition.image || null };
}
export function imageTaskStatus(job,shot) {
  const r=imageRequest(job,shot);
  return {status:r.imported||r.definition.video?'imported':assertComplete(r)?'completed':r.state?.status||'new',signature:r.signature,output:r.imported||r.output};
}
function availableImage(job, shot, definition) {
  const request = imageRequest(job,shot,definition);
  if (request.imported) return request.imported;
  if (request.state?.status === 'completed' && fs.existsSync(request.output)) return request.output;
  return null;
}
function videoRequest(job, shot, definition = readShot(job,shot)) {
  const config = configFor(job,'video');
  const image = availableImage(job,shot,definition);
  const input = { version:1,kind:'video',shot:shot.id,aspect:job.variant?.aspect || '16:9',config:semanticConfig(config),duration:Math.max(4,Math.ceil(shot.duration)),prompt:definition.video_prompt || '',revision:definition.revision || '',image:image ? {path:path.relative(job.filmDir,image),sha256:fileDigest(image)} : null };
  if(definition.settings.length)input.settings=definition.settings;
  const signature = digest(input);
  return { ...stateAt(rootFor(job,shot),'video',signature),kind:'video',signature,input,config,definition,image,imported:definition.video || null };
}
function requestStatus(request) {
  if (request.imported || (request.kind === 'image' && request.definition.video)) return 'imported';
  return request.state?.status || 'new';
}
function allShots(job) {
  return job.generationShots || job.shots || (job.film.shots || []).map(s => ({...s,path:path.join(job.filmDir,s.file)}));
}
function videoSummary(job, requests, items, budget) {
  const seconds = n => Math.round(n * 1e6) / 1e6;
  const rows = requests.map(({shot,request:r},i) => ({
    shot:shot.id,model:r.config.model || null,status:items[i].status,editSeconds:shot.duration,
    requestSeconds:r.imported ? null : r.input.duration,
  }));
  const pending = rows.filter(x => x.status === 'new');
  const newSourceSeconds = seconds(pending.reduce((n,x) => n + x.requestSeconds,0));
  const newEditSeconds = seconds(pending.reduce((n,x) => n + x.editSeconds,0));
  const resumeTasks = items.filter(x => x.progress?.resumable).length;
  const readyTasks = items.filter(x => ['completed','imported'].includes(x.status)).length;
  const blockedTasks = items.length - pending.length - resumeTasks - readyTasks;
  const excessSourceSeconds = seconds(newSourceSeconds - newEditSeconds);
  const remaining = [resumeTasks && `${resumeTasks}条已有任务可继续查询`,blockedTasks && `${blockedTasks}条失败或提交结果待核实`,readyTasks && `${readyTasks}项已完成或已导入`].filter(Boolean).join('；');
  return {
    strategy:'per-shot',filmSeconds:seconds((job.film.shots || job.shots || allShots(job)).reduce((n,x) => n + x.duration,0)),
    selectedSeconds:seconds(rows.reduce((n,x) => n + x.editSeconds,0)),
    newTasks:pending.length,resumeTasks,blockedTasks,newSourceSeconds,newEditSeconds,excessSourceSeconds,
    estimatedCost:items.filter(x=>x.status==='new').every(x=>Number.isFinite(x.estimatedCost)) ? budget.estimatedCost : null,
    currency:budget.currency,budgetLimit:budget.limit,
    requiresDurationChoice:excessSourceSeconds > 0,
    notice:(pending.length ? `逐镜生成${pending.length}条、合计${newSourceSeconds}秒源视频，剪入成片${newEditSeconds}秒；多出的${excessSourceSeconds}秒用于选取动作，不是成片新增时长。` : '本批无新增视频任务。') + remaining,
    items:rows,
  };
}
export function generationPlan(job, kind = 'image') {
  if (!['image','video'].includes(kind)) throw new Error('生成类别必须为 image 或 video');
  const requests = allShots(job).map(shot => ({shot,request:kind === 'image' ? imageRequest(job,shot) : videoRequest(job,shot)}));
  const items = requests.map(({shot,request:r}) => ({shot:shot.id,signature:r.signature,status:requestStatus(r),estimatedCost:r.config[kind === 'image' ? 'estimated_cost_usd' : 'estimated_cost_cny'] ?? null,input:r.input,source:r.imported ? path.relative(job.filmDir,r.imported) : null}));
  if (kind === 'video') requests.forEach(({request:r},i) => {
    if (r.state && !r.imported) items[i].progress = {
      localStatus:r.state.status,remoteStatus:r.state.remoteStatus || null,
      submittedAt:r.state.submittedAt || null,lastCheckedAt:r.state.lastCheckedAt || null,
      resumable:!!r.state.taskId && r.state.status === 'submitted',
    };
  });
  const budget = job.film.generation?.budget || {};
  const host=kind==='image'&&(job.imageRoute?.method==='host'||requests.length>0&&requests.every(({request:r})=>r.config.provider==='host'||r.imported));
  const summary = host?{currency:null,estimatedCost:null,reservedCost:null,limit:null,maxTasks:null,reservedTasks:null,newTasks:items.filter(i=>i.status==='new').length,problems:[],costNotice:'费用／额度由宿主管理，当前不可估算'}:budgetSummary(job,kind,items);
  const problems = [...summary.problems];
  if(!['art','settings'].includes(job.imageStage)&&requests.some(({request})=>requestStatus(request)==='new'))try{requireSettingsInventory(job.filmDir,job.style?.id||job.film.style);}catch(e){problems.push(e.message);}
  for (const {shot,request:r} of requests) if (requestStatus(r) === 'new') {
    if (!r.input.prompt) problems.push(`${shot.id} 缺少 ${kind} 提示词`);
    if (r.config.provider==='host') {
      try {
        validateHostRequest(r.config,r.definition.references);
        for(const file of r.definition.references)imageMime(fs.readFileSync(file));
      } catch(e){problems.push(`${shot.id}：${e.message}`);}
      continue;
    }
    if (!r.config.model) problems.push(`${shot.id} 未配置 ${kind} 模型`);
    if (kind === 'image' && r.config.model && r.input.prompt) {
      try { providers.validateImageConfig({config:r.config,prompt:r.input.prompt,references:r.definition.references,size:r.input.size}); }
      catch (error) { problems.push(`${shot.id}：${error.message}`); }
    }
    if (kind === 'video' && !r.image) problems.push(`${shot.id} 缺少已生成或导入的分镜图；请先生成并审核图片`);
    if (kind === 'video' && r.config.model && r.input.prompt) {
      try { providers.validateVideoRequest({config:r.config,prompt:r.input.prompt,duration:r.input.duration,ratio:'adaptive'}); }
      catch (error) { problems.push(`${shot.id}：${error.message}`); }
    }
  }
  const signature = digest({version:1,kind,budget,items:items.map(x => ({shot:x.shot,signature:x.signature,estimatedCost:x.estimatedCost,source:x.source}))});
  return {version:1,kind,aspect:job.variant?.aspect || '16:9',signature,items,budget,...summary,problems,allowed:problems.length === 0,...(kind==='video'?{videoSummary:videoSummary(job,requests,items,summary)}:{})};
}
export function approveGeneration(job, kind, {source,expectedSignature} = {}) {
  const plan = generationPlan(job,kind);
  if (expectedSignature !== undefined && expectedSignature !== plan.signature) throw new Error('生成计划已变化，签名与用户看到的批次不一致；请重新展示并确认开始');
  const approval=saveApproval(job,plan,source);
  if(kind==='image') {
    const entries=allShots(job).map(shot=>({shot,route:imageRoute(job,shot)}));
    saveImageRoutes(job,entries,job.imageRoute?.method||entries[0]?.route.method||'api');
  }
  return {...plan,approval};
}
function ready(kind, request, api, options) {
  if (!request.config.model) throw new Error(`请设置 ${kind === 'image' ? 'OPENAI_IMAGE_MODEL' : 'SEEDANCE_MODEL'} 或 generation.${kind}.model`);
  if (api === providers) providers.assertProviderReady(kind,request.config,options);
}
function assertComplete(request) {
  if (request.state?.status !== 'completed') return false;
  if (!fs.existsSync(request.output)) {
    if (request.kind === 'video' && request.state.taskId) return false;
    throw new Error('已付费生成的图片源文件缺失；请恢复备份，不会自动重复生成');
  }
  const actual = snapshot(request.output);
  if (actual.sha256 !== request.state.output?.sha256 || actual.bytes !== request.state.output?.bytes) throw new Error('生成源素材已被修改；请作为新的本地素材导入，不会自动覆盖或重复生成');
  return true;
}
function safeMetadata(value) {
  const data = {};
  for (const key of ['provider','model','format','bytes']) if (typeof value?.[key] === 'string' || Number.isFinite(value?.[key])) data[key] = value[key];
  const numbers = object => Object.fromEntries(Object.entries(object || {}).filter(([key,val]) => /^[a-z_]+$/.test(key) && Number.isFinite(val) && val >= 0));
  if (value?.usage) {
    data.usage = numbers(value.usage);
    for (const key of ['input_tokens_details','output_tokens_details','tool_usage']) if (value.usage[key] && typeof value.usage[key] === 'object') data.usage[key] = numbers(value.usage[key]);
  }
  if (value?.metadata) data.metadata = Object.fromEntries(Object.entries(value.metadata).filter(([key,val]) => ['duration','frames','fps','framespersecond','resolution','ratio','generate_audio','draft','model','created_at','updated_at','seed','output_format','service_tier'].includes(key) && ['number','string','boolean'].includes(typeof val)));
  return data;
}
function saveState(request, patch) {
  const state = {...request.state,version:1,kind:request.kind,signature:request.signature,request:request.input,...patch};
  atomicJson(request.stateFile,state); request.state = state; return state;
}
function frozenInput(request, file, expectedHash, name) {
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== expectedHash) throw new Error('参考素材在提交前发生变化，请重新查看并授权当前计划');
  const output = path.join(request.folder,'inputs',name);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  if (fs.existsSync(output)) {
    if (fileDigest(output) !== expectedHash) throw new Error('生成任务的输入快照已被修改，请先核对记录');
    return output;
  }
  const part = output + `.${process.pid}.part`;
  try { fs.writeFileSync(part,bytes); fs.renameSync(part,output); }
  finally { fs.rmSync(part,{force:true}); }
  return output;
}
function authorize(job, shot, request) {
  const plan = generationPlan({...job,shots:allShots(job).length ? allShots(job) : [shot]},request.kind);
  if (!plan.allowed) throw new Error(plan.problems.join('；'));
  const item = plan.items.find(x => x.signature === request.signature);
  if (!item) throw new Error('当前镜头不属于生成批次');
  reserveRequest(job,plan,item);
}
export async function ensureImage(job, shot, options = {}) {
  const api = options.api || providers;
  let request = imageRequest(job,shot);
  if (request.imported) return request.imported;
  if (assertComplete(request)) return request.output;
  if(request.config.provider==='host')throw new Error('当前选择 Agent 宿主生图；请 image-dispatch 交接，再 image-import 回收实际图片，不会改用 API');
  if(!['art','settings'].includes(job.imageStage))requireSettingsInventory(job.filmDir,job.style?.id||job.film.style);
  ready('image',request,api,options);
  // A production frame should not be billed when its declared downstream video cannot run.
  if (request.definition.video_prompt && !request.definition.video) {
    const video = videoRequest(job,shot,request.definition);
    ready('video',video,api,options);
    providers.validateVideoRequest({config:video.config,prompt:video.input.prompt,duration:video.input.duration,ratio:'adaptive'});
  }
  const unlock = generationLock(request.folder + '.lock');
  const lockedSignature = request.signature;
  try {
    request = imageRequest(job,shot);
    if (request.signature !== lockedSignature) throw new Error('镜头输入在取得生成锁时发生变化，请重新查看计划');
    if (assertComplete(request)) return request.output;
    if (request.state) throw new Error('上次图片提交结果不明确；请核对服务商记录，确需重新生成时修改 revision 并重新授权');
    const references = request.definition.references.map((file,i) => frozenInput(request,file,request.input.references[i].sha256,`reference-${i+1}${path.extname(file) || '.png'}`));
    if (api === providers) await providers.validateImageRequest({config:request.config,prompt:request.input.prompt,references,size:request.input.size,output:request.output},options);
    authorize(job,shot,request);
    saveState(request,{status:'submitting',submittedAt:new Date().toISOString()});
    try {
      const metadata = await api.generateImage({config:request.config,prompt:request.input.prompt,references,size:request.input.size,output:request.output},options);
      const output = snapshot(request.output);
      if (!output?.bytes) throw new Error('图片生成未产生有效素材');
      saveState(request,{status:'completed',output:{sha256:output.sha256,bytes:output.bytes},metadata:safeMetadata(metadata)});
      finishReservation(job.filmDir,request.signature,'completed',safeMetadata(metadata).usage);
      return request.output;
    } catch (error) { finishReservation(job.filmDir,request.signature,'ambiguous'); throw error; }
  } finally { unlock(); }
}
export function prepareHostImage(job,shot) {
  let request=imageRequest(job,shot);
  if(request.config.provider!=='host')throw new Error('本项尚未选择宿主生图');
  const unlock=generationLock(request.folder+'.lock');
  try {
    request=imageRequest(job,shot);
    const plan=generationPlan(job,'image'),item=plan.items.find(i=>i.signature===request.signature);
    if(!plan.allowed)throw new Error(plan.problems.join('；'));
    requireGenerationApproval(job,plan,item);
    if(request.state||request.imported)throw new Error('本项已经提交或完成；请回收结果，不能重复调用宿主');
    validateHostRequest(request.config,request.definition.references);
    const references=request.definition.references.map((file,i)=>frozenInput(request,file,request.input.references[i].sha256,`reference-${i+1}${path.extname(file)||'.png'}`));
    saveState(request,{status:'submitting',submittedAt:new Date().toISOString(),approval:plan.signature});
    return {method:'host',stage:job.imageStage||'shots',item:shot.id,signature:request.signature,tool:request.config.tool,prompt:request.input.prompt,references,aspect:request.input.aspect,requestedSize:request.input.size,costNotice:plan.costNotice};
  } finally {unlock();}
}
export async function importHostImage(job,shot,{signature,file,source}={}) {
  const request=imageRequest(job,shot);
  if(request.config.provider!=='host'||signature!==request.signature)throw new Error('宿主结果签名与当前输入不符');
  if(typeof source!=='string'||!source.trim())throw new Error('需要本次实际工具结果或手动导入的来源说明');
  const unlock=generationLock(request.folder+'.lock');
  try {
    request.state=strictJson(request.stateFile);
    if(request.state?.status!=='submitting')throw new Error('缺少待回收的宿主提交记录，或本项已经完成');
    if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile())throw new Error('需要本次实际图片文件的绝对路径');
    const bytes=fs.readFileSync(file);imageMime(bytes);
    const original=path.join(request.folder,'received-image');
    await atomicWrite(original,bytes);
    const temp=path.join(request.folder,'decoded.png');
    try {
      await ffmpeg(['-xerror','-i',original,'-frames:v','1',temp]);
      const decoded=fs.readFileSync(temp);imageMime(decoded);
      // Recheck all semantic inputs after the asynchronous decoder, before attaching the result.
      if(imageRequest(job,shot).signature!==signature)throw new Error('导入期间输入变化，请核对旧结果');
      for(const [i,ref] of request.input.references.entries()) {
        const frozen=path.join(request.folder,'inputs',`reference-${i+1}${path.extname(request.definition.references[i])||'.png'}`);
        if(!fs.existsSync(frozen)||fileDigest(frozen)!==ref.sha256)throw new Error('宿主交接的参考图快照已变化，请核对本次结果');
      }
      await atomicWrite(request.output,decoded);
      const output=snapshot(request.output);
      saveState(request,{status:'completed',output:{sha256:output.sha256,bytes:output.bytes},metadata:{provider:'host',tool:request.config.tool,source:source.trim(),receivedSha256:digest(bytes)}});
      return {status:'completed',item:shot.id,signature,output:request.output,review:'pending'};
    } finally {fs.rmSync(temp,{force:true});}
  } finally {unlock();}
}
export async function ensureVideo(job, shot, options = {}) {
  const api = options.api || providers;
  let request = videoRequest(job,shot);
  if (request.imported) return request.imported;
  if (assertComplete(request)) return request.output;
  if(!request.state)requireSettingsInventory(job.filmDir,job.style?.id||job.film.style);
  ready('video',request,api,options);
  if (!request.image) throw new Error('缺少已生成或导入的分镜图；先生成并审核图片，再授权视频批次');
  if (api === providers && providers.validateVideoRequest) providers.validateVideoRequest({config:request.config,prompt:request.input.prompt,duration:request.input.duration,ratio:'adaptive'});
  const unlock = generationLock(request.folder + '.lock');
  const lockedSignature = request.signature;
  let phase = request.state ? '查询已有任务' : '提交任务';
  const report = message => job.log?.(`[视频 ${shot.id} ${job.variant?.aspect || '16:9'}] ${message}`);
  let heartbeat;
  const startProgress = () => { heartbeat = setInterval(() => report(`仍在等待${phase}；任务记录保留，不重复提交`),options.progressIntervalMs ?? 30_000); };
  try {
    request = videoRequest(job,shot);
    if (request.signature !== lockedSignature) throw new Error('镜头输入在取得生成锁时发生变化，请重新查看计划');
    if (assertComplete(request)) return request.output;
    if (['failed','cancelled','expired'].includes(request.state?.status)) throw new Error(`视频任务 ${request.state.status}；保留记录，修改 revision 后需重新授权`);
    if (request.state && !request.state.taskId) throw new Error('上次视频提交结果不明确；请核对服务商记录，确需重新生成时修改 revision 并重新授权');
    if (!request.state) {
      const image = frozenInput(request,request.image,request.input.image.sha256,'first-frame.png');
      if (api === providers) await providers.validateVideoInput({config:request.config,prompt:request.input.prompt,image,duration:request.input.duration,ratio:'adaptive'},options);
      authorize(job,shot,request);
      saveState(request,{status:'submitting',submittedAt:new Date().toISOString()});
      startProgress();
      report('正在提交本批已授权任务');
      try {
        const task = await api.submitVideo({config:request.config,prompt:request.input.prompt,image,duration:request.input.duration,ratio:'adaptive'},options);
        if (!task?.id || typeof task.id !== 'string') throw new Error('视频创建响应缺少任务 ID');
        saveState(request,{status:'submitted',taskId:task.id});
        phase = '服务进度查询';
        report('任务已提交，开始查询进度');
      } catch (error) { finishReservation(job.filmDir,request.signature,'ambiguous'); throw error; }
    } else { startProgress();report('继续查询已有任务，不重新提交'); }
    const timeout = options.pollTimeoutMs ?? job.film.generation?.poll_timeout_ms ?? 600_000;
    const interval = options.pollIntervalMs ?? job.film.generation?.poll_interval_ms ?? 5_000;
    if (!Number.isFinite(timeout) || timeout < 1 || !Number.isFinite(interval) || interval < 1) throw new Error('轮询时间必须为正数');
    const deadline = Date.now() + timeout;
    let lastStatus = null;
    while (true) {
      if (options.signal?.aborted) throw new Error('视频查询已取消；任务 ID 已保存，下次复用');
      const config = {...request.config,request_timeout_ms:Math.min(request.config.request_timeout_ms,Math.max(1,deadline-Date.now()))};
      const status = await api.getVideo({config,id:request.state.taskId},options);
      const known = ['queued','running','succeeded','failed','cancelled','expired'].includes(status.status);
      saveState(request,{lastCheckedAt:new Date().toISOString(),remoteStatus:known ? status.status : 'unknown'});
      if (status.status !== lastStatus && ['queued','running'].includes(status.status)) {
        phase = status.status === 'queued' ? '服务排队' : '视频生成';
        report(status.status === 'queued' ? '服务正在排队，继续查询原任务' : '视频正在生成，继续查询原任务');
      }
      lastStatus = status.status;
      if (['failed','cancelled','expired'].includes(status.status)) {
        saveState(request,{status:status.status,metadata:safeMetadata(status)});
        finishReservation(job.filmDir,request.signature,status.status,safeMetadata(status).usage);
        throw new Error(`视频任务 ${status.status}；请在服务商控制台核对原因`);
      }
      if (status.status === 'succeeded') {
        if (!status.videoUrl) throw new Error('视频任务成功但缺少下载地址');
        const metadata = safeMetadata(status);
        // Remote generation may already be billed even if local download fails.
        saveState(request,{status:'submitted',remoteStatus:'succeeded',metadata});
        finishReservation(job.filmDir,request.signature,'succeeded',metadata.usage);
        phase = '视频下载';report('生成完成，正在下载并保存实际视频');
        await api.downloadVideo({url:status.videoUrl,output:request.output},options);
        const output = snapshot(request.output);
        if (!output?.bytes) throw new Error('视频下载未产生有效素材');
        saveState(request,{status:'completed',output:{sha256:output.sha256,bytes:output.bytes},metadata});
        finishReservation(job.filmDir,request.signature,'completed',metadata.usage);
        report('视频已保存完成，等待后期核对与审片');
        return request.output;
      }
      if (!['queued','running'].includes(status.status)) throw new Error('视频服务返回未知状态，已保留任务等待核对');
      if (Date.now() >= deadline) throw new Error('视频轮询超时；任务 ID 已保存，重跑原命令继续查询，不会重新提交');
      await new Promise(resolve => setTimeout(resolve,Math.min(interval,Math.max(1,deadline-Date.now()))));
    }
  } finally { clearInterval(heartbeat); unlock(); }
}
export function generationEvidence(job, shot) {
  const definition = readShot(job,shot);
  const image = imageRequest(job,shot,definition), video = videoRequest(job,shot,definition);
  const imageFile = image.imported || (image.state?.status === 'completed' ? image.output : null);
  const videoFile = video.imported || (video.state?.status === 'completed' ? video.output : null);
  const selectedVideo = snapshot(videoFile);
  const native = (job.film.generation?.video?.generate_audio !== false) && selectedVideo ? nativeAudioPath(job,shot,selectedVideo.file) : null;
  return { imageRequest:image.input,videoRequest:video.input,references:definition.references.map(snapshot),image:snapshot(imageFile),video:selectedVideo,
    imported:{image:!!image.imported,video:!!video.imported},
    ...(!video.imported ? {sourceTechnical:snapshot(videoFile && videoFile+'.technical.json')} : {}),
    ...((job.film.generation?.video?.generate_audio !== false) ? {nativeAudio:{wave:snapshot(native),record:snapshot(native && native+'.json')}} : {}) };
}
export function nativeAudioPath(job, shot, source) {
  return path.join(rootFor(job,shot),`audio-${fileDigest(source)}`,'native.wav');
}
export function nativeAudioTracks(job) {
  if (job.film.generation?.video?.generate_audio === false) return [];
  let start = 0;
  return allShots(job).flatMap(shot => {
    const source = generationEvidence(job,shot).video?.file;
    const file = source && nativeAudioPath(job,shot,source);
    const at = shot.start ?? start; start = at + shot.duration;
    if (!source) return [];
    let valid = false;
    try {
      const record = strictJson(file+'.json');
      valid = record?.version === 1 && record.source === fileDigest(source) && fs.existsSync(file) && fs.statSync(file).size > 0 && record.output === fileDigest(file);
    } catch { /* An unreadable or corrupt sidecar requires deterministic reconstruction. */ }
    if (!valid) throw new Error(`${shot.id} 原生音轨缺失或已改变，请先 render 重建原生音轨`);
    return [{file,start:at,duration:shot.duration,shot:shot.id,gain:1}];
  });
}
