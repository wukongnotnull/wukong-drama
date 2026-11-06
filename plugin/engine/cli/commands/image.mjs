import fs from 'node:fs';
import path from 'node:path';
import { loadFilm } from '../../core/film-context.mjs';
import { imageBatchPlan, approveImageBatch, dispatchImageBatch, importImageBatch } from '../../generation/image-batches.mjs';

export function imageCommands({pos,opt,log,aspectOpt}) {
  const json=flag=>{const file=opt(flag);if(!file)return undefined;if(typeof file!=='string')throw new Error(`--${flag} 需要 JSON 文件`);return JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));};
  const input=(importing=false)=>{
    if(!pos[0])throw new Error('需要片目录');
    const batch=json('batch')||(!importing?json('file'):undefined);
    const filmDir=path.resolve(pos[0]);let job;
    if(batch?.stage==='art'&&!fs.existsSync(path.join(filmDir,'film.json'))) {
      if(!fs.existsSync(path.join(filmDir,'brief.md')))throw new Error('请先 brief 创建本片简报目录');
      const aspect=aspectOpt()||batch.aspect;
      if(typeof aspect!=='string'||!/^\d+:\d+$/.test(aspect)||aspect.split(':').some(n=>Number(n)<=0))throw new Error('美术定调批次须提供简报已确认的 aspect');
      const [w,h]=aspect.split(':').map(Number);
      job={filmDir,film:{style:'visual-development',size:[w,h],generation:batch.generation||{}},style:{id:'visual-development'},variant:{aspect},shots:[]};
    } else job=loadFilm(filmDir,{aspect:aspectOpt(),requireShots:!batch});
    if(opt('only')) {
      if(batch)throw new Error('资产批次请直接在 batch.items 中列出本批项目');
      const selected=String(opt('only')).split(',');
      for(const id of selected)if(!job.shots.some(s=>s.id===id))throw new Error(`没有镜头 ${id}`);
      job.shots=job.shots.filter(s=>selected.includes(s.id));
    }
    return {job,args:{batch,host:json('host'),method:opt('method'),signature:opt('signature'),source:opt('source'),item:opt('item')}};
  };
  return {
    'image-plan':async()=>{const {job,args}=input(),plan=imageBatchPlan(job,args);log(JSON.stringify(plan,null,2));return plan.recommended||!plan.remaining?0:2;},
    'image-approve':async()=>{const {job,args}=input();log(JSON.stringify(approveImageBatch(job,args),null,2));},
    'image-dispatch':async()=>{const {job,args}=input();log(JSON.stringify(await dispatchImageBatch(job,args),null,2));},
    'image-import':async()=>{const {job,args}=input(true),file=opt('file');if(typeof file!=='string')throw new Error('需要 --file 指向本次实际图片');log(JSON.stringify(await importImageBatch(job,{...args,file:path.resolve(file)}),null,2));},
  };
}
