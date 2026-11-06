import fs from 'node:fs';
import path from 'node:path';
import { loadFilm } from '../../core/film-context.mjs';
import { generationPlan, approveGeneration } from '../../generation/generation.mjs';
import { initSeries, readSeries, saveCharacterVersion, approveCharacterVersion, saveEpisodeDraft, confirmEpisode } from '../../core/series.mjs';

export function generationCommands({pos,opt,log,aspectOpt}) {
  const film = () => {
    if(!pos[0])throw Error('需要片目录');const ctx=loadFilm(pos[0],{aspect:aspectOpt()});
    if(opt('only')) {
      const selected=String(opt('only')).split(',');
      for(const id of selected)if(!ctx.shots.some(s=>s.id===id))throw Error(`没有镜头 ${id}`);
      ctx.shots=ctx.shots.filter(s=>selected.includes(s.id));
    }
    return ctx;
  };
  const kind = () => {const value=opt('kind','video');if(value!=='video')throw Error('图片请使用 image-plan / image-approve 选择来源与批准；generation 命令仅支持 video');return value;};
  const source = () => {const value=opt('source');if(typeof value!=='string'||!value.trim())throw Error('--source 必须记录用户的实际批准原文或引用');return value;};
  const project = () => {if(!pos[0])throw Error('需要剧集项目目录');return path.resolve(pos[0]);};
  return {
    'generation-plan': async()=>{const plan=generationPlan(film(),kind());log(JSON.stringify(plan,null,2));return plan.allowed?0:2;},
    'generation-approve': async()=>{
      const k=kind();
      const expectedSignature=opt('signature');
      if(typeof expectedSignature!=='string'||!expectedSignature.trim())throw Error('视频批准需要 --signature 绑定用户已明确确认开始的 generation-plan 批次');
      const ctx=film();
      log(JSON.stringify(approveGeneration(ctx,k,{source:source(),expectedSignature}),null,2));
    },
    'series-init': async()=>{log(JSON.stringify(initSeries(project(),{title:opt('name',path.basename(project())),entry:opt('entry','idea')}),null,2));},
    'series': async()=>{log(JSON.stringify(readSeries(project()),null,2));},
    'series-update': async()=>{
      const file=opt('file');if(typeof file!=='string')throw Error('series-update 需要 --file 指向 JSON 输入');
      const input=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
      let value;
      switch(opt('action')) {
        case 'character': value=saveCharacterVersion(project(),input);break;
        case 'approve-character': value=approveCharacterVersion(project(),{...input,source:source()});break;
        case 'draft': value=saveEpisodeDraft(project(),input);break;
        case 'confirm-episode': value=confirmEpisode(project(),{...input,source:source(),expectedSignature:opt('signature')||input.expectedSignature});break;
        default: throw Error('--action 应为 character、approve-character、draft 或 confirm-episode');
      }
      log(JSON.stringify(value,null,2));
    },
  };
}
