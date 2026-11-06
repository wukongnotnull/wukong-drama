// 内容批准只证明被审阅的材料版本；与费用授权、模型任务身份分别记录。
import fs from 'node:fs';
import path from 'node:path';
import {digest,fileDigest,readJson,atomicJson} from './evidence.mjs';
import {assertCompatibleProgress} from './state.mjs';
import {aspectOf} from './variants.mjs';

const fileOf=job=>path.join(job.filmDir,'.wkd/content-approvals.json');
function text(job,name){
  const file=path.join(job.filmDir,name);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.statSync(file).size)throw new Error(`内容审查缺少 ${name}，请先准备实际材料`);
  return fs.readFileSync(file,'utf8');
}
function ledger(job){
  const value=readJson(fileOf(job),{version:1,history:[]});
  if(value?.version!==1||!Array.isArray(value.history))throw new Error('内容批准记录损坏，保留原文件并核实');
  return value;
}
export function contentSnapshot(job,step,{frames={}}={}){
  if(![4,6,7].includes(step))throw new Error('内容审查仅支持第4、6、7道');
  const story=digest({text:text(job,'story.md'),style:job.style?.id||job.film.style});
  const size=readJson(path.join(job.filmDir,'film.json'),{}).size;
  const mainAspect=Array.isArray(size)?aspectOf(size):job.variant?.aspect||'16:9';
  const aspect=step===6?mainAspect:job.variant?.aspect||mainAspect;
  if(step===4){const value={step,story};return {...value,signature:digest(value)};}
  const allLines=text(job,'storyboard.md').split('\n');
  const reformatAt=allLines.findIndex(line=>/^#{2,3}\s*副版重排/.test(line));
  const lines=reformatAt<0?allLines:allLines.slice(0,reformatAt);
  const rowId=line=>/^\|\s*(s\d{2,3})\s*\|/.exec(line)?.[1];
  const shared=lines.filter(line=>!rowId(line)).join('\n').trim();
  const shots=(job.generationShots||job.shots||[]).map(shot=>{
    const rows=lines.filter(line=>rowId(line)===shot.id);
    if(!rows.length)throw new Error(`内容审查缺少 ${shot.id} 的分镜表行`);
    const {id,duration,size,note,transition}=shot;
    const storyboard=digest({story,shared,shot:{id,duration,size,note,transition},rows});
    if(step===6)return {id,signature:storyboard};
    const frame=frames[id];
    if(!frame?.file||!fs.existsSync(frame.file))throw new Error(`${id} 缺少实际分镜图，不能签批图片`);
    const image={path:path.relative(job.filmDir,frame.file),sha256:fileDigest(frame.file),role:frame.role||null,initialState:frame.initialState||null};
    const reformat=job.variant?.isMain===false&&reformatAt>=0?allLines.slice(reformatAt).filter(line=>rowId(line)===id):[];
    return {id,storyboard,image,signature:digest({storyboard,image,reformat})};
  });
  const value={step,aspect,story,shots};return {...value,signature:digest(value)};
}
export function recordContentApproval(job,review,{id,source,expectedSignature}={}){
  assertCompatibleProgress(job.filmDir);
  if(!id||typeof source!=='string'||!source.trim())throw new Error('内容批准需要真实批准编号与用户来源');
  if(review.signature!==expectedSignature)throw new Error('内容材料已变化，批准签名不匹配，请重新展示当前版本');
  const data=ledger(job),old=data.history.find(a=>a.id===id);
  if(old){if(old.review.signature!==review.signature||old.source!==source)throw new Error('同一内容批准身份对应不同材料或结论');return old;}
  const approval={id,source,at:new Date().toISOString(),review};
  atomicJson(fileOf(job),{...data,history:[...data.history,approval]});return approval;
}
export function requireContentApproval(job,review){
  const history=ledger(job).history;
  if(review.step===4){
    const last=history.filter(a=>a.review?.step===4).at(-1);
    if(last?.review.story!==review.story)throw new Error('剧本内容尚未批准或已变化；请先展示当前剧本并签批第4道');
    return;
  }
  for(const shot of review.shots){
    const last=history.filter(a=>a.review?.step===review.step&&a.review.aspect===review.aspect&&a.review.shots?.some(s=>s.id===shot.id)).at(-1);
    if(last?.review.shots.find(s=>s.id===shot.id)?.signature!==shot.signature)throw new Error(`${shot.id} ${review.step===6?'分镜':'分镜图／动作初态'}内容尚未批准或已变化；请补审第${review.step}道，不会自动重新生成`);
  }
}
