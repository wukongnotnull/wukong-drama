import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runCli} from '../../plugin/engine/cli/run.mjs';
import {loadFilm} from '../../plugin/engine/core/film-context.mjs';
import {generationPlan,ensureVideo} from '../../plugin/engine/generation/generation.mjs';
import {approveEmptySettings} from '../helpers/settings.mjs';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-content-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const lines=[],io={log:s=>lines.push(s),error:s=>lines.push(s)};
 assert.equal(await runCli(['init','demo','--dir',root],io),0);
 const dir=path.join(root,'films/demo'),file=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(file));
 film.size=[160,90];film.shots=[{id:'s01',file:'shots/s01.json',duration:1,size:'远景'},{id:'s02',file:'shots/s02.json',duration:1,size:'近景'}];
 film.generation.video={provider:'seedance',model:'doubao-seedance-2-0-test',estimated_cost_cny:1};film.generation.budget={video_cny:10,max_video_tasks:10};
 fs.writeFileSync(file,JSON.stringify(film));approveEmptySettings(dir);
 fs.writeFileSync(path.join(dir,'story.md'),'# 猫偷蛋\n猫伸爪，随后抬头。');
 fs.writeFileSync(path.join(dir,'storyboard.md'),'| s01 | 伸爪 |\n| s02 | 抬头 |\n');
 for(const s of film.shots){fs.writeFileSync(path.join(dir,s.id+'.png'),'reviewed picture '+s.id);fs.writeFileSync(path.join(dir,s.file),JSON.stringify({image:s.id+'.png',image_role:'first_frame',initial_state:'动作开始前',video_prompt:'猫伸爪'}));}
 const run=async(...args)=>{lines.length=0;const code=await runCli(args,io);return {code,text:lines.join('\n')};};
 const sign=async(step,only=null)=>{
   const args=[dir,'--step',String(step),...(only?['--only',only]:[])];
   const p=await run('content-review',...args);assert.equal(p.code,0,p.text);
   const signature=JSON.parse(p.text).signature;
   const r=await run('signoff',dir,'用户已审阅当前材料','--step',String(step),'--content-signature',signature,...(only?['--only',only]:[]));assert.equal(r.code,0,r.text);
 };
 return {dir,run,sign,job:()=>loadFilm(dir)};
}
test('new paid video requires content approvals independently of its budget',async t=>{
 const f=await fixture(t),plan=generationPlan(f.job(),'video');
 assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/内容|剧本|分镜/);
 await f.sign(4);await f.sign(6);
 assert.equal(generationPlan(f.job(),'video').allowed,false,'图片存在不代表已审图');
 await f.sign(7);assert.equal(generationPlan(f.job(),'video').allowed,true);
});
test('changed frame invalidates only that shot and partial signoff cannot approve the other',async t=>{
 const f=await fixture(t);for(const n of [4,6,7])await f.sign(n);
 fs.appendFileSync(path.join(f.dir,'s01.png'),'changed');
 const job=f.job();assert.equal(generationPlan({...job,shots:[job.shots[1]]},'video').allowed,true);
 assert.equal(generationPlan({...job,shots:[job.shots[0]]},'video').allowed,false);
 await f.sign(7,'s02');assert.equal(generationPlan(f.job(),'video').allowed,false);
 await f.sign(7,'s01');assert.equal(generationPlan(f.job(),'video').allowed,true);
});
test('review signature rejects changed story and representative frames cannot silently become first frames',async t=>{
 const f=await fixture(t),review=await f.run('content-review',f.dir,'--step','4');
 assert.equal(review.code,0,review.text);fs.appendFileSync(path.join(f.dir,'story.md'),'变更');
 const r=await f.run('signoff',f.dir,'通过','--step','4','--content-signature',JSON.parse(review.text).signature);
 assert.equal(r.code,1);assert.match(r.text,/变化|签名/);
 for(const n of [4,6,7])await f.sign(n);
 const file=f.job().shots[0].path,shot=JSON.parse(fs.readFileSync(file));shot.image_role='representative';fs.writeFileSync(file,JSON.stringify(shot));
 const p=generationPlan(f.job(),'video');assert.equal(p.allowed,false);assert.match(p.problems.join(' '),/首帧|first_frame/);
});
test('legacy imported media stays usable without invented content approvals',async t=>{
 const f=await fixture(t),job=f.job(),shot=job.shots[0];fs.writeFileSync(path.join(f.dir,'existing.mp4'),'old source');fs.writeFileSync(shot.path,JSON.stringify({video:'existing.mp4'}));
 const file=await ensureVideo(job,shot,{api:{submitVideo(){throw Error('must not submit');}}});
 assert.equal(file,path.join(f.dir,'existing.mp4'));assert.ok(!fs.existsSync(path.join(f.dir,'.wkd/content-approvals.json')));
});

test('changed storyboard rows do not invalidate unrelated shot content',async t=>{
 const f=await fixture(t);for(const n of [4,6,7])await f.sign(n);
 const file=path.join(f.dir,'storyboard.md');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('伸爪','收爪'));
 const job=f.job();
 assert.equal(generationPlan({...job,shots:[job.shots[1]]},'video').allowed,true);
 assert.equal(generationPlan({...job,shots:[job.shots[0]]},'video').allowed,false);
 await f.sign(6,'s01');await f.sign(7,'s01');assert.equal(generationPlan(f.job(),'video').allowed,true);
});

test('reformatting preserves main storyboard approval and only the new frame needs review',async t=>{
 const f=await fixture(t);for(const n of [4,6,7])await f.sign(n);
 const filmFile=path.join(f.dir,'film.json'),film=JSON.parse(fs.readFileSync(filmFile));film.variants={'9:16':{}};fs.writeFileSync(filmFile,JSON.stringify(film));
 fs.appendFileSync(path.join(f.dir,'storyboard.md'),'\n## 副版重排（9:16）\n| s01 | 猫置于中线 |\n| s02 | 留出顶部 |\n');
 assert.equal(generationPlan(f.job(),'video').allowed,true,'副版表不会使主版分镜失效');
 const p=await f.run('content-review',f.dir,'--step','7','--aspect','9:16');assert.equal(p.code,0,p.text);
 const signed=await f.run('signoff',f.dir,'用户确认副版首帧','--step','7','--aspect','9:16','--content-signature',JSON.parse(p.text).signature);assert.equal(signed.code,0,signed.text);
 assert.equal(generationPlan(loadFilm(f.dir,{aspect:'9:16'}),'video').allowed,true);
});

test('a new paid request cannot promise a selection past its requested source length',async t=>{
 const f=await fixture(t);for(const n of [4,6,7])await f.sign(n);
 const file=f.job().shots[0].path;fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file)),source_start:5}));
 const plan=generationPlan(f.job(),'video');assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/选段.*源/);
});
