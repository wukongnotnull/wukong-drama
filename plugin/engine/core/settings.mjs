// Project visual settings and per-film review. Approval binds text, style and image bytes.
import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, digest, fileDigest } from './evidence.mjs';
import { withSeriesLock } from './series.mjs';
import { assertCompatibleProgress, assertProjectCompatible } from './state.mjs';

const kinds = { character:'characters', prop:'props', scene:'scenes' };
const labels = { character:'角色', prop:'道具', scene:'场景' };
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const own = (o,k) => object(o) && Object.hasOwn(o,k);
const now = () => new Date().toISOString();
function text(value,label) {
  if(typeof value!=='string'||!value.trim())throw new Error(`${label}不能为空`);
  return value.trim();
}
function id(value) {
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)||['__proto__','prototype','constructor'].includes(value))throw new Error('设定编号或版本无效');
  return value;
}
function token(ref) {
  if(!object(ref)||!Object.hasOwn(kinds,ref.kind))throw new Error('设定类别应为 character、prop 或 scene');
  return `${ref.kind}/${id(ref.id)}@${id(ref.version)}`;
}
function read(file,fallback) {
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw new Error(`无法读取设定文件 ${file}：${error.message}`);}
}
export function settingsRoot(filmDir) {
  const dir=path.resolve(filmDir),parent=path.dirname(dir);
  return path.basename(parent)==='films'?path.dirname(parent):dir;
}
function localReference(root,relative,{required=true}={}) {
  if(typeof relative!=='string'||!relative.trim()||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(s=>!s||s==='..'))throw new Error('设定参考图必须是项目内的相对路径');
  const target=path.resolve(root,relative),realRoot=fs.realpathSync(root);
  let existing=target;while(!fs.existsSync(existing)&&path.dirname(existing)!==existing)existing=path.dirname(existing);
  const real=fs.realpathSync(existing);
  if(real!==realRoot&&!real.startsWith(realRoot+path.sep))throw new Error('设定参考图不能越出项目');
  if(required&&(!fs.existsSync(target)||!fs.statSync(target).isFile()||!fs.statSync(target).size))throw new Error(`设定参考图不存在或为空：${relative}`);
  return target;
}
function library(root,kind) {
  const plural=kinds[kind],file=path.join(root,plural+'.json'),data=read(file,{version:1,[plural]:{}});
  if(!object(data)||data.version!==1||!object(data[plural]))throw new Error(`设定库结构无效：${file}`);
  return {file,data,entries:data[plural]};
}
function versionAt(root,ref) {
  token(ref);const db=library(root,ref.kind),record=own(db.entries,ref.id)?db.entries[ref.id]:null;
  if(!own(record?.versions,ref.version))throw new Error(`设定版本不存在：${token(ref)}`);
  return {...db,value:record.versions[ref.version]};
}
export function saveSettingVersion(projectDir,input={}) {
  const {kind,version,name,description=input.appearance,state='base',importance='key',references=[],voice='',notes=''}=input;
  token(input);text(name,'设定名称');text(description,'设定文字');text(state,'剧情状态');
  if(!['key','minor'].includes(importance))throw new Error('importance 应为 key 或 minor');
  if(!Array.isArray(references)||references.length>16)throw new Error('参考图必须是最多 16 项的路径列表');
  if(typeof voice!=='string'||typeof notes!=='string')throw new Error('声线和备注必须是文字');
  assertProjectCompatible(projectDir);
  return withSeriesLock(projectDir,p=>{
    const db=library(p.root,kind),current=own(db.entries,input.id)?db.entries[input.id]:{id:input.id,name,versions:{}};
    if(!object(current.versions))throw new Error('设定版本结构无效');
    if(Object.hasOwn(current.versions,version))throw new Error(`设定版本已存在：${token(input)}；修改或状态变化请新建版本`);
    for(const ref of references)localReference(p.root,ref,{required:false});
    const value={version,name:name.trim(),[kind==='character'?'appearance':'description']:description.trim(),state,importance,references:[...references],voice,notes,status:'draft',createdAt:now()};
    db.entries[input.id]={...current,versions:{...current.versions,[version]:value}};
    atomicJson(db.file,db.data);return value;
  });
}
export function initSettings(filmDir) {
  assertCompatibleProgress(filmDir);
  const file=path.join(path.resolve(filmDir),'settings.json');
  if(fs.existsSync(file))throw new Error('设定清单已存在，不覆盖');
  const data={version:1,categories:Object.fromEntries(Object.values(kinds).map(k=>[k,{status:'pending'}])),selections:[]};
  atomicJson(file,data);return data;
}
function manifestAt(filmDir) {
  const manifest=read(path.join(filmDir,'settings.json'),null);
  if(!manifest)throw new Error('缺少设定清单，请先 settings-init 并完成第 5 道设定审查');
  if(manifest.version!==1||!object(manifest.categories)||!Array.isArray(manifest.selections))throw new Error('设定清单结构无效');
  const keys=manifest.selections.map(token);
  if(new Set(keys).size!==keys.length)throw new Error('设定清单重复引用版本');
  for(const [kind,plural] of Object.entries(kinds)) {
    const c=manifest.categories[plural],selected=manifest.selections.filter(r=>r.kind===kind);
    if(!object(c)||!['used','not-applicable'].includes(c.status))throw new Error(`${labels[kind]}设定清单尚未检查`);
    if(c.status==='not-applicable') {
      text(c.reason,`${labels[kind]}不适用原因`);
      if(selected.length)throw new Error(`${labels[kind]}已声明不适用，却有选中设定`);
    } else if(!selected.length)throw new Error(`${labels[kind]}已声明使用，但缺少设定版本`);
  }
  return manifest;
}
function proofAt(filmDir) {
  const proof=read(path.join(filmDir,'.wkd/settings-approval.json'),{version:1,current:null,history:[]});
  if(!object(proof)||proof.version!==1||!Array.isArray(proof.history))throw new Error('设定确认记录结构无效');
  return proof;
}
function describe(root,ref,style) {
  const {value}=versionAt(root,ref),description=text(ref.kind==='character'?value.appearance:value.description,'设定文字');
  text(value.name,'设定名称');
  const references=value.references||[];
  if(!Array.isArray(references)||references.length>16)throw new Error('设定参考图列表无效');
  const importance=value.importance||'key';
  if(!['key','minor'].includes(importance))throw new Error('设定重要性无效');
  if(importance==='key'&&!references.length)throw new Error(`重点${labels[ref.kind]} ${ref.id} 缺少参考图`);
  const images=references.map(relative=>{const file=localReference(root,relative);return {path:relative,sha256:fileDigest(file)};});
  const content={ref:{kind:ref.kind,id:ref.id,version:ref.version},style,name:value.name,description,state:value.state||'base',importance,voice:value.voice||'',notes:value.notes||'',references:images};
  const signature=digest(content),approval=value.visualApprovals?.[style];
  const status=approval?.signature===signature?'reused':approval?'changed':'new';
  return {...content,key:token(ref),signature,status,approval:approval||null};
}
function affectedShots(filmDir,manifest,items,proof) {
  const selected=new Map(manifest.selections.map(r=>[token(r),r])),current=new Map(items.map(i=>[i.key,i]));
  const folder=path.join(filmDir,'shots');if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(f=>/^s\d{2,3}(?:\.[\w-]+)?\.json$/.test(f)).flatMap(name=>{
    const shot=read(path.join(folder,name)),reasons=[];
    if(!Array.isArray(shot.settings)) {
      if(manifest.selections.length)reasons.push('尚未声明镜头设定关联');
    } else for(const ref of shot.settings) {
      const key=token(ref),item=current.get(key);
      if(!selected.has(key))reasons.push(`${key} 已移出本片清单，请选择新版或核实关联`);
      else if(!item||item.status!=='reused'||proof.current?.selections?.[key]!==item.signature)reasons.push(`${key} 新增、变化或待本片确认`);
    }
    return reasons.length?[{file:'shots/'+name,reasons}]:[];
  });
}
export function settingsReview(filmDir,{write=false}={}) {
  assertCompatibleProgress(filmDir);filmDir=path.resolve(filmDir);
  const root=settingsRoot(filmDir),film=read(path.join(filmDir,'film.json')),style=text(film.style,'影片风格'),problems=[],items=[];
  let manifest=null;
  try{manifest=manifestAt(filmDir);}catch(e){problems.push(e.message);}
  const proof=proofAt(filmDir);
  if(manifest)for(const ref of manifest.selections)try{items.push(describe(root,ref,style));}catch(e){problems.push(`${token(ref)}：${e.message}`);}
  const signature=digest({style,manifest,items:items.map(i=>({key:i.key,signature:i.signature})),problems});
  const result={version:1,style,signature,ready:problems.length===0,categories:manifest?.categories||null,items,problems,affectedShots:manifest?affectedShots(filmDir,manifest,items,proof):[]};
  if(write) {
    const reviewDir=path.join(filmDir,'review');fs.mkdirSync(reviewDir,{recursive:true});
    atomicJson(path.join(reviewDir,'设定审查.json'),result);
    const lines=['# 角色／道具／场景设定审查','',`风格：${style}`,`审查签名：${signature}`,''];
    for(const [kind,plural] of Object.entries(kinds))lines.push(`- ${labels[kind]}：${result.categories?.[plural]?.status||'待检查'} ${result.categories?.[plural]?.reason||''}`);
    for(const item of items) {
      lines.push('',`## ${labels[item.ref.kind]}：${item.name}（${item.ref.version} / ${item.state}）`,`${item.status==='reused'?'沿用已确认':item.status==='changed'?'变化待复审':'新增待审'} · ${item.importance==='key'?'重点':'简化'}`,'',item.description,item.notes);
      for(const ref of item.references)lines.push('',`![${item.name}](${path.join(root,ref.path)})`);
    }
    if(problems.length)lines.push('','## 待补齐',...problems.map(x=>'- '+x));
    lines.push('','## 受影响镜头',...(result.affectedShots.length?result.affectedShots.map(s=>`- ${s.file}：${s.reasons.join('；')}`):['无待复核关联。']));
    fs.writeFileSync(path.join(reviewDir,'设定审查.md'),lines.join('\n')+'\n');
  }
  return result;
}
function freeze(root,item) {
  const dir=path.join(root,'.wkd-settings/approved',item.signature);fs.mkdirSync(dir,{recursive:true});
  const references=item.references.map((ref,i)=>{
    const original=localReference(root,ref.path),bytes=fs.readFileSync(original);
    if(digest(bytes)!==ref.sha256)throw new Error('参考图在设定批准期间变化，请重新审查');
    const file=path.join(dir,`reference-${i+1}${path.extname(original)||'.png'}`);
    if(fs.existsSync(file)){if(fileDigest(file)!==ref.sha256)throw new Error('已批准设定快照被修改，请恢复备份');}
    else fs.writeFileSync(file,bytes,{flag:'wx'});
    return {path:path.relative(root,file),sha256:ref.sha256};
  });
  const {approval:_approval,status:_status,...content}=item;
  const settingFile=path.join(dir,'setting.json');
  if(fs.existsSync(settingFile)) {
    if(digest(read(settingFile))!==digest(content))throw new Error('已批准设定文字快照被修改，请恢复备份');
  } else atomicJson(settingFile,content);
  return references;
}
export function approveSettings(filmDir,{source,expectedSignature,reuse=false}={}) {
  assertCompatibleProgress(filmDir);filmDir=path.resolve(filmDir);
  text(expectedSignature,'当前设定审查签名');if(!reuse)text(source,'实际用户确认来源');
  const root=settingsRoot(filmDir);
  return withSeriesLock(root,()=>{
    const report=settingsReview(filmDir);
    if(report.signature!==expectedSignature)throw new Error('设定审查签名已变化，请重新展示当前材料');
    if(!report.ready)throw new Error(report.problems.join('；'));
    if(reuse&&(!report.items.length||report.items.some(i=>i.status!=='reused')))throw new Error('只可复用已有当前风格批准的设定；新增、变化或无对象清单需要实际审查确认');
    // Freeze every input before updating any approval; no partial approval on a missing image.
    const frozen=report.items.map(item=>freeze(root,item));
    if(settingsReview(filmDir).signature!==expectedSignature)throw new Error('设定在批准期间变化，请重新审查');
    for(const [i,item] of report.items.entries())if(item.status!=='reused') {
      const db=versionAt(root,item.ref),approval={signature:item.signature,style:report.style,source:source.trim(),at:now(),references:frozen[i]};
      const value={...db.value,status:'approved',visualApprovals:{...db.value.visualApprovals,[report.style]:approval},visualHistory:[...(db.value.visualHistory||[]),approval]};
      db.entries[item.ref.id].versions[item.ref.version]=value;atomicJson(db.file,db.data);
    }
    const previous=proofAt(filmDir),current={signature:expectedSignature,style:report.style,inventory:digest(report.categories),selections:Object.fromEntries(report.items.map(i=>[i.key,i.signature])),source:reuse?'继承项目中已有的视觉批准':source.trim(),inherited:reuse,at:now()};
    if(previous.current?.signature===current.signature)return previous.current;
    atomicJson(path.join(filmDir,'.wkd/settings-approval.json'),{version:1,current,history:[...previous.history,current]});return current;
  });
}
export function requireSettingsInventory(filmDir,style) {
  const manifest=manifestAt(filmDir),proof=proofAt(filmDir).current;
  if(!proof||proof.style!==style||proof.inventory!==digest(manifest.categories))throw new Error('本片设定清单尚未确认或风格／分类已变化，请完成第 5 道设定审查');
  return {manifest,proof};
}
export function settingSnapshotFiles(filmDir) {
  const root=settingsRoot(filmDir),report=settingsReview(filmDir),files=[];
  if(!report.ready)throw new Error(report.problems.join('；'));
  for(const item of report.items) {
    files.push(path.join(root,kinds[item.ref.kind]+'.json'),path.join(root,'.wkd-settings/approved',item.signature,'setting.json'));
    for(const ref of [...item.references,...(item.approval?.references||[])])files.push(localReference(root,ref.path));
  }
  return [...new Set(files)];
}
export function resolveShotSettings(job,definition) {
  const dir=path.resolve(job.filmDir),root=settingsRoot(dir),style=job.style?.id||job.film.style;
  if(!fs.existsSync(path.join(dir,'settings.json'))) {
    if(definition.settings!==undefined)throw new Error('镜头声明了设定，但缺少本片设定清单');
    return {bindings:[],references:[],prompt:''};
  }
  const {manifest,proof}=requireSettingsInventory(dir,style);
  if(definition.settings===undefined&&manifest.selections.length)throw new Error('请明确镜头的 settings 关联；无设定对象时填写 settings: []');
  if(definition.settings!==undefined&&!Array.isArray(definition.settings))throw new Error('镜头 settings 必须是设定引用数组');
  const references=[],bindings=[],prompts=[],seen=new Set(),selected=new Set(manifest.selections.map(token));
  for(const ref of definition.settings||[]) {
    const key=token(ref);if(seen.has(key))throw new Error(`镜头重复引用设定 ${key}`);seen.add(key);
    if(!selected.has(key))throw new Error(`设定 ${key} 不在当前清单，可能已改版，请复核镜头`);
    const item=describe(root,ref,style);
    if(item.status!=='reused')throw new Error(`设定 ${key} ${item.status==='changed'?'已变化，批准过期':'尚未确认'}，请先完成设定审查`);
    if(proof.selections[key]!==item.signature)throw new Error(`设定 ${key} 尚未完成本片确认或已变化，请重新审查／复用`);
    for(const refImage of item.approval.references||[]) {
      const file=localReference(root,refImage.path);
      if(fileDigest(file)!==refImage.sha256)throw new Error(`设定 ${key} 批准快照被修改，请恢复备份`);
      references.push(file);
    }
    if((item.approval.references||[]).length!==item.references.length)throw new Error(`设定 ${key} 缺少完整批准快照`);
    bindings.push({kind:ref.kind,id:ref.id,version:ref.version,state:item.state,signature:item.signature});
    prompts.push(`${labels[ref.kind]} ${item.name}（${ref.version}，${item.state}）：${item.description}${item.notes?'；'+item.notes:''}`);
  }
  return {bindings,references:[...new Set(references)],prompt:prompts.length?'已确认设定，保持以下视觉特征与剧情状态：\n'+prompts.join('\n'):''};
}
