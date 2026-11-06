// Explicit synthetic content approvals for tests about other production contracts.
import fs from 'node:fs';
import path from 'node:path';
import {contentReview} from '../../plugin/engine/generation/generation.mjs';
import {storyboardPrompts,storyboardCells} from '../../plugin/engine/generation/storyboard-prompts.mjs';
import {recordContentApproval} from '../../plugin/engine/core/content-approval.mjs';

export function approveFixtureContent(job){
  fs.mkdirSync(job.filmDir,{recursive:true});
  const story=path.join(job.filmDir,'story.md'),board=path.join(job.filmDir,'storyboard.md');
  if(!fs.existsSync(story))fs.writeFileSync(story,'# Fixture story\nSynthetic test action.');
  const shots=job.generationShots||job.shots||[];
  // These fixtures explicitly prepare and review the current format; production never auto-approves it.
  const header='| 镜 | 时长 | 画面 | 首帧提示词 | 过渡提示词 | 尾帧提示词 | 人声 | 音效 |';
  const escape=value=>value.replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\n/g,'<br>');
  const rows=shots.map(shot=>{
    const file=shot.path||path.join(job.filmDir,shot.file);
    const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
    const previous=storyboardPrompts(job,shot)?.fields||{};
    const first=value.image_prompt||value.first_frame_prompt||previous.first_frame_prompt||'Fixture first state';
    const motion=value.video_prompt||value.transition_prompt||previous.transition_prompt||'Fixture action';
    const last=value.last_frame_prompt||previous.last_frame_prompt||'Fixture end state';
    delete value.image_prompt;delete value.video_prompt;
    for(const key of ['first_frame_prompt','transition_prompt','last_frame_prompt'])delete value[key];
    if(fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(value));
    return `| ${shot.id} | ${shot.duration}s | Fixture action | ${escape(first)} | ${escape(motion)} | ${escape(last)} | — | — |`;
  });
  const existing=fs.existsSync(board)?fs.readFileSync(board,'utf8'):'';
  const retained=existing.startsWith(header)?existing.split(/^## 副版重排/m)[0].split('\n').filter(line=>/^\|\s*s\d+\s*\|/.test(line)&&!shots.some(shot=>line.match(/^\|\s*(s\d+)\s*\|/)?.[1]===shot.id)):[];
  let source=[header,'|---|---|---|---|---|---|---|---|',...retained,...rows].join('\n');
  if(job.variant?.isMain===false){
    const previous=fs.existsSync(board)?fs.readFileSync(board,'utf8'):'';
    source=previous.split(/^## 副版重排/m)[0].trim();
    source+=`\n## 副版重排（${job.variant.aspect}）\n| 镜 | 首帧提示词 | 尾帧提示词 |\n|---|---|---|\n`+rows.map(line=>{const cells=storyboardCells(line);return `| ${cells[0]} | ${escape(cells[3])} | ${escape(cells[5])} |`;}).join('\n');
  }
  fs.writeFileSync(board,source);
  for(const step of [4,6]){
    const review=contentReview(job,step);
    recordContentApproval(job,review,{id:'fixture-content-'+review.signature,source:'Explicit fixture content review',expectedSignature:review.signature});
  }
}
export function approveFixtureFrames(job){
  approveFixtureContent(job);
  for(const shot of job.generationShots||job.shots||[]){
    const file=shot.path||path.join(job.filmDir,shot.file),value=JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file,JSON.stringify({...value,image_role:'first_frame',initial_state:'Fixture action begins here'}));
  }
  const review=contentReview(job,7);
  recordContentApproval(job,review,{id:'fixture-content-'+review.signature,source:'Explicit fixture content review',expectedSignature:review.signature});
}
