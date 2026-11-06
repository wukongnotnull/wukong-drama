// Explicit synthetic content approvals for tests about other production contracts.
import fs from 'node:fs';
import path from 'node:path';
import {contentReview} from '../../plugin/engine/generation/generation.mjs';
import {recordContentApproval} from '../../plugin/engine/core/content-approval.mjs';

export function approveFixtureContent(job){
  fs.mkdirSync(job.filmDir,{recursive:true});
  const story=path.join(job.filmDir,'story.md'),board=path.join(job.filmDir,'storyboard.md');
  if(!fs.existsSync(story))fs.writeFileSync(story,'# Fixture story\nSynthetic test action.');
  const shots=job.generationShots||job.shots||[];
  if(!fs.existsSync(board))fs.writeFileSync(board,shots.map(s=>`| ${s.id} | Fixture action |`).join('\n'));
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
