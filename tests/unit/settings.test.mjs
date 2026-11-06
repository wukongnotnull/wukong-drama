import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as settingsApi from '../../plugin/engine/core/settings.mjs';
import { initSeries, saveCharacterVersion, approveCharacterVersion } from '../../plugin/engine/core/series.mjs';
import { generationPlan, approveGeneration, ensureImage, ensureVideo } from '../../plugin/engine/generation/generation.mjs';
import { migrateProgress, LAST_STEP, REVIEW_GATES } from '../../plugin/engine/core/state.mjs';

const settings = async () => settingsApi;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value,null,2)); };
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-settings-')),dir=path.join(root,'films/ep01');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'assets'),{recursive:true});
  fs.writeFileSync(path.join(root,'assets/hero.png'),'reference A');
  const film={style:'anime',generation:{image:{provider:'openai',model:'image-test',estimated_cost_usd:0.1},video:{generate_audio:false,provider:'seedance',model:'video-test',estimated_cost_cny:1},budget:{image_usd:10,video_cny:20,max_image_tasks:20,max_video_tasks:20}},shots:[{id:'s01',file:'shots/s01.json',duration:4},{id:'s02',file:'shots/s02.json',duration:4}]};
  write(path.join(dir,'film.json'),film);
  for(const shot of film.shots)write(path.join(dir,shot.file),{image_prompt:'镜头构图',video_prompt:'缓慢走动',settings:[]});
  const job={filmDir:dir,film,style:{id:'anime'},variant:{aspect:'16:9'},shots:film.shots.map(s=>({...s,path:path.join(dir,s.file)})),log(){}};
  return {root,dir,job};
}
const ref={kind:'character',id:'hero',version:'v1'};
async function configured(t) {
  const api=await settings(),f=fixture(t);
  api.initSettings(f.dir);
  api.saveSettingVersion(f.root,{...ref,name:'主角',description:'短发蓝衣，禁止改变眼睛颜色',state:'base',importance:'key',references:['assets/hero.png']});
  const manifest={version:1,categories:{characters:{status:'used'},props:{status:'not-applicable',reason:'没有道具'},scenes:{status:'not-applicable',reason:'纯色背景'}},selections:[ref]};
  write(path.join(f.dir,'settings.json'),manifest);
  write(f.job.shots[0].path,{image_prompt:'镜头构图',video_prompt:'缓慢走动',settings:[ref]});
  return {...f,api,manifest};
}
function approve(f) {
  const review=f.api.settingsReview(f.dir);
  return f.api.approveSettings(f.dir,{expectedSignature:review.signature,source:'用户确认当前设定文字与参考图'});
}

test('16 steps include settings before storyboard; migration preserves proof without inventing settings approval',()=>{
  assert.equal(LAST_STEP,16);assert.equal(Object.keys(REVIEW_GATES).length,13);
  const old={flow:5,step:8,history:[{step:5,note:'分镜通过',approvalId:'prior',signature:'original'}]};
  const {state}=migrateProgress(old);
  assert.equal(state.flow,6);assert.equal(state.step,9);assert.equal(state.history[0].step,6);
  assert.equal(state.history[0].signature,'original');assert.equal(state.history.some(h=>h.step===5),false);
  assert.equal(old.step,8);
});
test('inventory is mandatory, cannot overwrite, and key objects require references while minor ones can be text only',async t=>{
  const api=await settings(),f=fixture(t);api.initSettings(f.dir);
  assert.throws(()=>api.initSettings(f.dir),/已存在/);
  assert.equal(api.settingsReview(f.dir).ready,false);
  api.saveSettingVersion(f.root,{...ref,name:'主角',description:'蓝衣',importance:'key'});
  write(path.join(f.dir,'settings.json'),{version:1,categories:{characters:{status:'used'},props:{status:'not-applicable',reason:'无'},scenes:{status:'not-applicable',reason:'无'}},selections:[ref]});
  assert.match(api.settingsReview(f.dir).problems.join(' '),/参考图/);
  assert.throws(()=>api.saveSettingVersion(f.root,{...ref,name:'主角',description:'红衣'}),/已存在/);
  const minor={kind:'prop',id:'cup',version:'v1'};
  api.saveSettingVersion(f.root,{...minor,name:'背景杯',description:'白色杯子',importance:'minor'});
  assert.throws(()=>api.saveSettingVersion(f.root,{kind:'scene',id:'room',version:'v1',name:'房间',description:'明亮',references:['../outside.png']}),/参考图|项目/);
});
test('unapproved settings block image and video, exact review signature is required',async t=>{
  const f=await configured(t);
  assert.throws(()=>generationPlan(f.job),/设定.*确认|设定.*批准/);
  assert.throws(()=>f.api.approveSettings(f.dir,{source:'确认',expectedSignature:'old'}),/变化|签名/);
  const calls=[];await assert.rejects(ensureImage(f.job,f.job.shots[0],{api:{generateImage(){calls.push(1);}}}),/设定/);
  await assert.rejects(ensureVideo(f.job,f.job.shots[0],{api:{submitVideo(){calls.push(1);}}}),/设定/);
  assert.equal(calls.length,0);
});
test('approved text and actual reference bytes enter image generation and stable video prompts',async t=>{
  const f=await configured(t);approve(f);
  approveGeneration(f.job,'image',{source:'测试预算批准'});
  const api={generateImage:async({prompt,references,output})=>{assert.match(prompt,/短发蓝衣/);assert.equal(fs.readFileSync(references[0],'utf8'),'reference A');fs.writeFileSync(output,'image');return {};},submitVideo:async({prompt})=>{assert.match(prompt,/短发蓝衣/);return {id:'task'};},getVideo:async()=>({status:'succeeded',videoUrl:'https://example.org/v'}),downloadVideo:async({output})=>fs.writeFileSync(output,'video')};
  await ensureImage(f.job,f.job.shots[0],{api});
  const single={...f.job,shots:[f.job.shots[0]]};approveGeneration(single,'video',{source:'测试视频预算批准'});
  await ensureVideo(single,single.shots[0],{api});
});
test('reference or text changes invalidate approval, report affected primary and variant shots, and preserve other signatures',async t=>{
  const f=await configured(t);approve(f);
  write(path.join(f.dir,'shots/s01.9x16.json'),{image_prompt:'竖版',settings:[ref]});
  const before=generationPlan(f.job).items[1].signature;
  fs.writeFileSync(path.join(f.root,'assets/hero.png'),'reference B');
  const report=f.api.settingsReview(f.dir);
  assert.equal(report.items[0].status,'changed');assert.ok(report.affectedShots.some(s=>s.file==='shots/s01.9x16.json'));
  assert.throws(()=>generationPlan(f.job),/设定.*变化|设定.*过期/);
  assert.equal(generationPlan({...f.job,shots:[f.job.shots[1]]}).items[0].signature,before);
  approve(f);
  const db=JSON.parse(fs.readFileSync(path.join(f.root,'characters.json')));db.characters.hero.versions.v1.appearance='红衣';write(path.join(f.root,'characters.json'),db);
  assert.throws(()=>generationPlan(f.job),/设定.*变化|设定.*过期/);
});
test('same-series same-style reuse preserves original approval, style changes need review',async t=>{
  const f=await configured(t);approve(f);
  const dir2=path.join(f.root,'films/ep02');write(path.join(dir2,'film.json'),f.job.film);write(path.join(dir2,'settings.json'),f.manifest);
  const before=fs.readFileSync(path.join(f.root,'characters.json'),'utf8');
  f.api.approveSettings(dir2,{reuse:true,expectedSignature:f.api.settingsReview(dir2).signature});
  assert.equal(fs.readFileSync(path.join(f.root,'characters.json'),'utf8'),before);
  write(path.join(dir2,'film.json'),{...f.job.film,style:'cinematic'});
  assert.throws(()=>f.api.approveSettings(dir2,{reuse:true,expectedSignature:f.api.settingsReview(dir2).signature}),/复用|审查/);
});
test('legacy films can inspect existing inputs but cannot buy generation before settings review',async t=>{
  const f=fixture(t);for(const shot of f.job.shots)write(shot.path,{image_prompt:'legacy',video_prompt:'move'});
  assert.equal(generationPlan(f.job).allowed,false);
  assert.throws(()=>approveGeneration(f.job,'image',{source:'预算批准'}),/设定/);
  const calls=[];await assert.rejects(ensureImage(f.job,f.job.shots[0],{api:{generateImage(){calls.push(1);}}}),/设定/);assert.equal(calls.length,0);
});
test('all three kinds and named story states are reviewed together, older versions remain intact',async t=>{
  const f=await configured(t),prop={kind:'prop',id:'key',version:'v1-broken'},scene={kind:'scene',id:'room',version:'v1-night'};
  f.api.saveSettingVersion(f.root,{...prop,name:'钥匙',description:'半截铜钥匙，约五厘米',state:'broken',references:['assets/hero.png']});
  f.api.saveSettingVersion(f.root,{...scene,name:'房间',description:'门在左侧，窗在右侧，夜晚冷光',state:'night',references:['assets/hero.png']});
  f.manifest.selections.push(prop,scene);f.manifest.categories.props={status:'used'};f.manifest.categories.scenes={status:'used'};write(path.join(f.dir,'settings.json'),f.manifest);
  write(f.job.shots[0].path,{image_prompt:'持钥匙站在房间',video_prompt:'缓慢开门',settings:[ref,prop,scene]});
  approve(f);const item=generationPlan(f.job).items[0];
  assert.match(item.input.prompt,/五厘米/);assert.match(item.input.prompt,/门在左侧/);
  assert.deepEqual(item.input.settings.map(x=>x.state),['base','broken','night']);
  const before=JSON.parse(fs.readFileSync(path.join(f.root,'props.json'))).props.key.versions['v1-broken'];
  const next={...prop,version:'v2-intact'};f.api.saveSettingVersion(f.root,{...next,name:'钥匙',description:'完整铜钥匙',state:'intact',references:['assets/hero.png']});
  f.manifest.selections=f.manifest.selections.map(r=>r.kind==='prop'?next:r);write(path.join(f.dir,'settings.json'),f.manifest);
  assert.match(f.api.settingsReview(f.dir).affectedShots[0].reasons.join(' '),/移出本片清单/);
  assert.throws(()=>generationPlan(f.job),/不在当前清单/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'props.json'))).props.key.versions['v1-broken'],before);
});
test('existing series character is reused without treating its old narrative approval as visual approval',async t=>{
  const f=fixture(t),api=await settings();initSeries(f.root,{title:'series'});
  saveCharacterVersion(f.root,{id:'hero',version:'v1',name:'主角',appearance:'蓝衣',references:['assets/hero.png']});
  approveCharacterVersion(f.root,{id:'hero',version:'v1',source:'历史剧情角色确认'});
  write(path.join(f.dir,'settings.json'),{version:1,categories:{characters:{status:'used'},props:{status:'not-applicable',reason:'无'},scenes:{status:'not-applicable',reason:'无'}},selections:[ref]});
  const review=api.settingsReview(f.dir);assert.equal(review.items[0].status,'new');
  assert.throws(()=>api.approveSettings(f.dir,{reuse:true,expectedSignature:review.signature}),/复用/);
  api.approveSettings(f.dir,{source:'用户确认实际图片',expectedSignature:review.signature});
  const value=JSON.parse(fs.readFileSync(path.join(f.root,'characters.json'))).characters.hero.versions.v1;
  assert.equal(value.approval.source,'历史剧情角色确认');assert.equal(value.visualApprovals.anime.source,'用户确认实际图片');
});
test('unchanged shots can generate from a selected batch while another setting is awaiting revision',async t=>{
  const f=await configured(t);approve(f);
  fs.writeFileSync(path.join(f.root,'assets/hero.png'),'changed');
  const job={...f.job,generationShots:[f.job.shots[1]]};
  approveGeneration(job,'image',{source:'只批准不相关的 s02'});
  let calls=0;await ensureImage(job,job.shots[1],{api:{generateImage:async({output})=>{calls++;fs.writeFileSync(output,'unrelated');}}});
  assert.equal(calls,1);
});
test('review rejects missing category reasons and image symlinks outside project',async t=>{
  const f=await configured(t);delete f.manifest.categories.props.reason;write(path.join(f.dir,'settings.json'),f.manifest);
  assert.match(f.api.settingsReview(f.dir).problems.join(' '),/不适用原因/);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'ref.png'),'outside');fs.symlinkSync(outside,path.join(f.root,'outside'));
  assert.throws(()=>f.api.saveSettingVersion(f.root,{kind:'prop',id:'x',version:'v1',name:'x',description:'x',references:['outside/ref.png']}),/越出项目/);
});
test('setting descriptions do not invent a missing composition or motion prompt',async t=>{
  const f=await configured(t);approve(f);
  write(f.job.shots[0].path,{settings:[ref]});
  const plan=generationPlan({...f.job,shots:[f.job.shots[0]]});
  assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/缺少 image 提示词/);
  assert.equal(plan.items[0].input.prompt,'');
});
