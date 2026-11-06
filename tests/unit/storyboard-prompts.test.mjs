import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generationPlan,approveGeneration,ensureImage,ensureVideo,contentReview} from '../../plugin/engine/generation/generation.mjs';
import {recordContentApproval} from '../../plugin/engine/core/content-approval.mjs';
import {approveEmptySettings} from '../helpers/settings.mjs';

const header='| 镜 | 段落 | 时长 | 转场 | 景别 | 画面 | 运镜 / 动态 | 首帧提示词 | 过渡提示词 | 尾帧提示词 | 屏幕文字 | 人声 | 音效 |';
const row=(id='s01')=>`| ${id} | 起 | 2s | — | 特写 | 破壳 | 固定 | 完整鸟蛋，猫爪在右侧 | 猫爪轻碰，蛋壳逐渐裂开 | 小鸟露头，猫爪停住 | — | 对白（小猫）：你好 | 1s 蛋壳裂声 |`;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-board-prompts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'shots'));fs.writeFileSync(path.join(dir,'frame.png'),'reviewed first frame');
 const shot={id:'s01',path:path.join(dir,'shots/s01.json'),duration:2,size:'特写'};
 const definition={image_role:'first_frame',initial_state:'完整鸟蛋，猫爪在右侧',references:[],settings:[]};
 fs.writeFileSync(shot.path,JSON.stringify(definition));
 const job={filmDir:dir,film:{size:[160,90],generation:{image:{provider:'openai',model:'image-test',estimated_cost_usd:0.1},video:{provider:'seedance',model:'doubao-seedance-2-5-test',estimated_cost_cny:1},budget:{image_usd:10,video_cny:10,max_image_tasks:10,max_video_tasks:10}}},style:{id:'ink-wash'},variant:{aspect:'16:9',isMain:true},shots:[shot],log(){}};
 fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(job.film));fs.writeFileSync(path.join(dir,'story.md'),'猫碰蛋，小鸟破壳。');
 const board=path.join(dir,'storyboard.md');fs.writeFileSync(board,[header,'|'+Array(13).fill('---').join('|')+'|',row(),'','## 声音铺底','| 时间 | 类别 | 内容 / 情绪 | 动作 |','|---|---|---|---|','| 0–2s | BGM | 俏皮 | 统一后期铺音乐 |','| 0–2s | 环境声 | 庭院风声 | 轻柔 |'].join('\n'));
 approveEmptySettings(dir,job.style.id);
 const save=value=>fs.writeFileSync(shot.path,JSON.stringify(value));
 const sign=step=>{const review=contentReview(job,step);recordContentApproval(job,review,{id:'test-'+review.signature,source:'用户审阅当前分镜和实际图片',expectedSignature:review.signature});};
 return {dir,job,shot,definition,board,save,sign};
}
test('three approved columns reach actual image/video calls with dialogue, sounds and timing',async t=>{
 const f=fixture(t);f.sign(4);f.sign(6);
 const image=generationPlan(f.job,'image');assert.match(image.items[0].input.prompt,/完整鸟蛋/);assert.doesNotMatch(image.items[0].input.prompt,/小鸟露头/);
 approveGeneration(f.job,'image',{source:'用户同意这批图片',expectedSignature:image.signature});
 await ensureImage(f.job,f.shot,{api:{generateImage:async({prompt,output})=>{assert.match(prompt,/完整鸟蛋/);fs.writeFileSync(output,'first frame');}}});f.sign(7);
 const video=generationPlan(f.job,'video');assert.equal(video.allowed,true,video.problems.join('\n'));approveGeneration(f.job,'video',{source:'用户明确开始本批视频',expectedSignature:video.signature});
 let submitted=0;
 await ensureVideo(f.job,f.shot,{api:{submitVideo:async({prompt,image,duration})=>{submitted++;for(const text of ['完整鸟蛋','逐渐裂开','小鸟露头','你好','蛋壳裂声','庭院风声','无背景音乐','2秒'])assert.ok(prompt.includes(text),text);assert.equal(duration,4);assert.ok(fs.existsSync(image));return {id:'task'};},getVideo:async()=>({status:'succeeded',videoUrl:'https://example.org/video'}),downloadVideo:async({output})=>fs.writeFileSync(output,'video')}});assert.equal(submitted,1);
});
test('motion/end changes require storyboard review but reuse unchanged approved first image',async t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png'});for(const n of [4,6,7])f.sign(n);
 const before=generationPlan(f.job,'video'),first=generationPlan(f.job,'image').items[0].signature;
 approveGeneration(f.job,'video',{source:'用户确认原批次',expectedSignature:before.signature});
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('小鸟露头，猫爪停住','小鸟完全出壳，猫爪停住'));
 assert.equal(generationPlan(f.job,'video').allowed,false);
 f.sign(6);const after=generationPlan(f.job,'video');assert.equal(after.allowed,true,after.problems.join('\n'));
 assert.equal(generationPlan(f.job,'image').items[0].signature,first);assert.notEqual(after.items[0].signature,before.items[0].signature);
 await assert.rejects(ensureVideo(f.job,f.shot,{api:{submitVideo(){throw Error('must not submit');}}}),/批准|授权|确认/);
});
test('JSON prompt mirrors cannot diverge from the reviewed board',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png',first_frame_prompt:'另一颗蛋',transition_prompt:'猫爪轻碰，蛋壳逐渐裂开',last_frame_prompt:'小鸟露头，猫爪停住'});for(const n of [4,6,7])f.sign(n);
 const plan=generationPlan(f.job,'video');assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/首帧|first_frame_prompt|不一致/);
});
test('escaped pipes and in-cell line breaks survive compilation, malformed/duplicate rows block',t=>{
 const f=fixture(t);fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('猫爪轻碰，蛋壳逐渐裂开','猫爪轻碰\\|停顿<br>蛋壳逐渐裂开'));
 const prompt=generationPlan(f.job,'video').items[0].input.prompt;assert.ok(prompt.includes('猫爪轻碰|停顿\n蛋壳逐渐裂开'));
 f.save({...f.definition,image:'frame.png'});for(const n of [4,6,7])f.sign(n);
 fs.appendFileSync(f.board,'\n'+row());assert.equal(generationPlan(f.job,'video').allowed,false);
});
test('variants share motion and sounds while using separately reviewed first/end compositions',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png'});for(const n of [4,6,7])f.sign(n);
 fs.appendFileSync(f.board,'\n## 副版重排（9:16）\n| 镜 | 处理方式 | 怎么排 | 首帧提示词 | 尾帧提示词 |\n|---|---|---|---|---|\n| s01 | 独立生成 | 主体居中 | 竖屏完整蛋居中 | 竖屏小鸟露头居中 |\n');
 const variant={...f.job,variant:{aspect:'9:16',isMain:false}};const plan=generationPlan(variant,'video');assert.equal(plan.allowed,false,'新画幅的图还没审');
 const review=contentReview(variant,7);recordContentApproval(variant,review,{id:'portrait-'+review.signature,source:'用户审阅竖屏图',expectedSignature:review.signature});
 const approved=generationPlan(variant,'video');assert.equal(approved.allowed,true,approved.problems.join('\n'));for(const text of ['竖屏完整蛋居中','竖屏小鸟露头居中','逐渐裂开','你好'])assert.ok(approved.items[0].input.prompt.includes(text),text);
 const before=approved.items[0].signature;f.save({...f.definition,image:'frame.png',source_start:1});assert.equal(generationPlan(variant,'video').items[0].signature,before);
});
test('old format blocks new generation but submitted tasks resume and imported sources remain usable',async t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png',video_prompt:'旧视频动作'});fs.writeFileSync(f.board,'| s01 | 旧分镜 |');for(const n of [4,6,7])f.sign(n);
 const plan=generationPlan(f.job,'video');assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/三栏|首帧提示词|补齐/);
 const item=plan.items[0],folder=path.join(f.dir,'assets/generated/16x9/s01','video-'+item.signature);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify({version:1,kind:'video',signature:item.signature,status:'submitted',taskId:'old-task'}));
 fs.rmSync(f.board);fs.rmSync(path.join(f.dir,'story.md'));
 const api={submitVideo(){throw Error('must not resubmit');},getVideo:async({id})=>{assert.equal(id,'old-task');return {status:'succeeded',videoUrl:'https://example.org/old'};},downloadVideo:async({output})=>fs.writeFileSync(output,'old video')};
 assert.ok(fs.existsSync(await ensureVideo(f.job,f.shot,{api})));
 f.save({video:path.relative(f.dir,path.join(folder,'source.mp4'))});assert.ok(fs.existsSync(await ensureVideo(f.job,f.shot,{api})));
});
test('sound cues use local shot time and exclude background sound outside this shot',t=>{
 const f=fixture(t);f.shot.start=4;
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('1s 蛋壳裂声','5s 蛋壳裂声').replace('0–2s | 环境声 | 庭院风声','4–6s | 环境声 | 庭院风声'));
 const prompt=generationPlan(f.job,'video').items[0].input.prompt;
 assert.match(prompt,/1秒 蛋壳裂声/);assert.match(prompt,/0–2秒；环境声；庭院风声/);assert.doesNotMatch(prompt,/无背景音乐/);
});
test('old duplicate prompts and incomplete columns cannot override or authorize new generation',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png',video_prompt:'偷偷改成吃掉小鸟'});for(const n of [4,6,7])f.sign(n);
 let plan=generationPlan(f.job,'video');assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/不一致/);assert.doesNotMatch(plan.items[0].input.prompt,/吃掉/);
 f.save({...f.definition,image:'frame.png'});fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('小鸟露头，猫爪停住','—'));
 plan=generationPlan(f.job,'video');assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/补齐尾帧提示词/);
});
test('a changed first-frame target needs its own image review as well as storyboard review',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png'});for(const n of [4,6,7])f.sign(n);
 const before=generationPlan(f.job,'image').items[0].signature;
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('完整鸟蛋，猫爪在右侧','完整鸟蛋，猫爪在左侧'));
 f.sign(6);assert.equal(generationPlan(f.job,'video').allowed,false,'分镜批准不能代替首帧图批准');
 assert.notEqual(generationPlan(f.job,'image').items[0].signature,before);
 f.sign(7);assert.equal(generationPlan(f.job,'video').allowed,true);
});
test('changing a timed sound bed only requires review of shots that use it',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png'});f.shot.start=0;
 const second={...f.shot,id:'s02',start:2,path:path.join(f.dir,'shots/s02.json')};fs.writeFileSync(second.path,JSON.stringify({...f.definition,image:'frame.png'}));f.job.shots.push(second);
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace(row(),row()+'\n'+row('s02')));for(const n of [4,6,7])f.sign(n);
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('庭院风声','庭院虫鸣'));
 assert.equal(generationPlan({...f.job,shots:[second]},'video').allowed,true,'无关镜头不需要重审');
 assert.equal(generationPlan({...f.job,shots:[f.shot]},'video').allowed,false);
});
test('variant tail composition changes require approval without regenerating the unchanged first image',t=>{
 const f=fixture(t);f.save({...f.definition,image:'frame.png'});for(const n of [4,6,7])f.sign(n);
 fs.appendFileSync(f.board,'\n## 副版重排（9:16）\n| 镜 | 首帧提示词 | 尾帧提示词 |\n|---|---|---|\n| s01 | 竖屏完整蛋居中 | 竖屏小鸟露头居中 |\n');
 const variant={...f.job,variant:{aspect:'9:16',isMain:false}};
 const sign=()=>{const review=contentReview(variant,7);recordContentApproval(variant,review,{id:'variant-'+review.signature,source:'只审副版变化构图，其余沿用',expectedSignature:review.signature});};sign();
 const image=generationPlan(variant,'image').items[0].signature;
 fs.writeFileSync(f.board,fs.readFileSync(f.board,'utf8').replace('竖屏小鸟露头居中','竖屏小鸟露头，上方留白'));
 assert.equal(generationPlan(variant,'video').allowed,false);
 assert.equal(generationPlan(variant,'image').items[0].signature,image);
 sign();assert.equal(generationPlan(variant,'video').allowed,true);
});
