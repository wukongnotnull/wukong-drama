import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../../plugin/engine/cli/run.mjs';
import { loadFilm } from '../../plugin/engine/core/film-context.mjs';
import { ensureImage } from '../../plugin/engine/generation/generation.mjs';
import { approveEmptySettings } from '../helpers/settings.mjs';
import { saveSettingVersion, settingsReview, approveSettings } from '../../plugin/engine/core/settings.mjs';
import { commandsFor } from '../../plugin/engine/cli/commands.mjs';

const host={id:'codex-imagegen',label:'Codex imagegen',tool:'image_gen',evidence:'current session tool discovery',available:true,references:true,edit:true,maxReferences:null};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-image-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const output=[],io={log:x=>output.push(x),error:x=>output.push(x)};
 assert.equal(await runCli(['init','demo','--dir',root],io),0,output.join('\n'));
 const dir=path.join(root,'films/demo');approveEmptySettings(dir);
 const job=loadFilm(dir);fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
 fs.writeFileSync(path.join(dir,'assets/ref.png'),png);
 fs.writeFileSync(job.shots[0].path,JSON.stringify({image_prompt:'small illustrated house',references:['assets/ref.png'],settings:[]}));
 job.shots=job.shots.slice(0,1);
 return {root,dir,job,output,io};
}
async function api() { return import('../../plugin/engine/generation/image-batches.mjs'); }
test('image-plan CLI offers the discovered host with no API key and never authorizes it',async t=>{
 const f=await fixture(t),cap=path.join(f.root,'host.json');fs.writeFileSync(cap,JSON.stringify(host));f.output.length=0;
 assert.equal(await runCli(['image-plan',f.dir,'--host',cap,'--only','s01'],f.io),0,f.output.join('\n'));
 const plan=JSON.parse(f.output[0]);assert.equal(plan.recommended,'host');assert.equal(plan.routes.host.allowed,true);
 assert.equal(plan.routes.host.estimatedCost,null);assert.equal(plan.routes.api.allowed,false);
 assert.ok(!fs.existsSync(path.join(f.dir,'.wkd/generation-approvals.json')));
});
test('host handoff needs current selection, freezes references, imports a decodable result, and renders without API',async t=>{
 const f=await fixture(t),a=await api(),opts={host,method:'host'};
 let p=a.imageBatchPlan(f.job,{host});
 await assert.rejects(a.dispatchImageBatch(f.job,opts),/授权|选择/);
 assert.throws(()=>a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:''}),/来源/);
 a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'user selected Codex for this batch'});
 assert.equal(a.imageBatchPlan(f.job,{host}).recommended,'host');
 const handoff=await a.dispatchImageBatch(f.job,opts);
 assert.equal(handoff.method,'host');assert.equal(handoff.item,'s01');assert.equal(handoff.prompt,'small illustrated house');
 assert.notEqual(handoff.references[0],path.join(f.dir,'assets/ref.png'));assert.deepEqual(fs.readFileSync(handoff.references[0]),png);
 await assert.rejects(a.dispatchImageBatch(f.job,opts),/提交|回收|重复/);
 await assert.rejects(ensureImage(f.job,f.job.shots[0]),/宿主|Agent|image-dispatch/);
 const file=path.join(f.root,'result.png');fs.writeFileSync(file,png);
 const result=await a.importImageBatch(f.job,{...opts,item:handoff.item,signature:handoff.signature,file,source:'exact tool result file'});
 assert.equal(result.status,'completed');assert.ok(fs.existsSync(result.output));
 assert.equal(await ensureImage(f.job,f.job.shots[0],{api:{generateImage(){throw Error('API must not run');}}}),result.output);
 assert.equal(a.imageBatchPlan(f.job,{host}).remaining,0);
 assert.ok(!fs.existsSync(path.join(f.dir,'.wkd/generation-ledger.json')));
 f.output.length=0;
 assert.equal(await runCli(['still',f.dir,'--frames','1'],f.io),0,f.output.join('\n'));
});
test('changed references invalidate approval; capabilities filter unsupported routes',async t=>{
 const f=await fixture(t),a=await api();
 assert.equal(a.imageBatchPlan(f.job,{host:{...host,references:false}}).routes.host.allowed,false);
 assert.equal(a.imageBatchPlan(f.job,{host:{...host,maxReferences:0}}).routes.host.allowed,false);
 assert.equal(a.imageBatchPlan(f.job,{}).routes.host.allowed,false);
 const p=a.imageBatchPlan(f.job,{host});fs.writeFileSync(path.join(f.dir,'assets/ref.png'),Buffer.concat([png,Buffer.from('changed')]));
 assert.throws(()=>a.approveImageBatch(f.job,{host,method:'host',signature:p.routes.host.signature,source:'yes'}),/变化|过期|签名/);
});
test('host import rejects mismatched result, fake PNG and changed inputs without completing',async t=>{
 const f=await fixture(t),a=await api(),opts={host,method:'host'};
 const p=a.imageBatchPlan(f.job,{host});a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'yes'});
 const h=await a.dispatchImageBatch(f.job,opts),file=path.join(f.root,'fake.png');fs.writeFileSync(file,png.subarray(0,24));
 await assert.rejects(a.importImageBatch(f.job,{...opts,item:h.item,signature:'bad',file,source:'tool result'}),/签名/);
 await assert.rejects(a.importImageBatch(f.job,{...opts,item:h.item,signature:h.signature,file,source:'tool result'}),/图片|ffmpeg|解码/);
 fs.writeFileSync(file,png);fs.writeFileSync(f.job.shots[0].path,JSON.stringify({image_prompt:'changed',settings:[]}));
 await assert.rejects(a.importImageBatch(f.job,{...opts,item:h.item,signature:h.signature,file,source:'tool result'}),/签名|提交/);
});
test('art and initial settings use the same choice flow before setting approval; edits require reference capability',async t=>{
 const f=await fixture(t),a=await api();fs.rmSync(path.join(f.dir,'settings.json'));
 for(const stage of ['art','settings']) {
   const batch={stage,items:[{id:'design-a',prompt:'draft design'}]},opts={batch,host,method:'host'};
   const p=a.imageBatchPlan(f.job,opts);assert.equal(p.routes.host.allowed,true,p.routes.host.problems.join('\n'));
   a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'yes for '+stage});
   assert.equal((await a.dispatchImageBatch(f.job,opts)).stage,stage);
 }
 const batch={stage:'art',items:[{id:'edit-a',prompt:'make the sky blue',references:['assets/ref.png']}]};
 assert.equal(a.imageBatchPlan(f.job,{batch,host:{...host,edit:false}}).routes.host.allowed,false);
});
test('art choice works in the brief folder before style selection creates film.json',async t=>{
 const f=await fixture(t),dir=path.join(f.root,'films/early'),cap=path.join(f.root,'host.json'),batch=path.join(f.root,'art.json');
 fs.writeFileSync(cap,JSON.stringify(host));fs.writeFileSync(batch,JSON.stringify({stage:'art',aspect:'16:9',items:[{id:'ink',prompt:'ink landscape'}]}));
 assert.equal(await runCli(['brief','early','--dir',f.root],f.io),0);
 f.output.length=0;
 assert.equal(await runCli(['image-plan',dir,'--batch',batch,'--host',cap],f.io),0,f.output.join('\n'));
 assert.equal(JSON.parse(f.output[0]).routes.host.allowed,true);
 const signature=JSON.parse(f.output[0]).routes.host.signature,args=[dir,'--batch',batch,'--host',cap,'--method','host'];
 assert.equal(await runCli(['image-approve',...args,'--signature',signature,'--source','user chose two art candidates'],f.io),0);
 f.output.length=0;assert.equal(await runCli(['image-dispatch',...args,'--item','ink'],f.io),0,f.output.join('\n'));
 const handoff=JSON.parse(f.output[0]),result=path.join(f.root,'actual.png');fs.writeFileSync(result,png);
 f.output.length=0;assert.equal(await runCli(['image-import',...args,'--item','ink','--signature',handoff.signature,'--file',result,'--source','actual art result'],f.io),0,f.output.join('\n'));
 assert.ok(fs.existsSync(JSON.parse(f.output[0]).output));
 assert.ok(!fs.existsSync(path.join(dir,'film.json')));
});
test('partial success survives switching remaining assets to API and preference persists per project',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'art',items:[{id:'a',prompt:'one'},{id:'b',prompt:'two'}]},opts={host,batch,method:'host'};
 f.job.film.generation.image.estimated_cost_usd=0.1;f.job.film.generation.budget.max_image_tasks=5;
 const env={OPENAI_API_KEY:'test-only'},plan=a.imageBatchPlan(f.job,{host,batch,env});
 a.approveImageBatch(f.job,{...opts,signature:plan.routes.host.signature,source:'host batch'});
 const h=await a.dispatchImageBatch(f.job,opts),file=path.join(f.root,'result.png');fs.writeFileSync(file,png);
 const saved=await a.importImageBatch(f.job,{...opts,item:h.item,signature:h.signature,file,source:'tool output a'});
 let p=a.imageBatchPlan(f.job,{batch,host,env});assert.equal(p.remaining,1);assert.equal(p.routes.api.newTasks,1);
 a.approveImageBatch(f.job,{batch,host,method:'api',env,signature:p.routes.api.signature,source:'API for remaining item'});
 assert.equal(a.imageBatchPlan({...f.job},{batch,host,env}).recommended,'api');
 let calls=0;
 await a.dispatchImageBatch(f.job,{batch,host,method:'api',api:{generateImage:async({output})=>{calls++;fs.writeFileSync(output,png);return {};}}});
 assert.equal(calls,1);assert.ok(fs.existsSync(saved.output));assert.equal(a.imageBatchPlan(f.job,{batch,host,env}).remaining,0);
 const fresh={stage:'art',items:[{id:'c',prompt:'three'}]};
 await assert.rejects(a.dispatchImageBatch(f.job,{batch:fresh,host,method:'api',api:{}}),/授权|选择/);
 const other=await fixture(t);assert.equal(a.imageBatchPlan(other.job,{host}).recommended,'host');
});
test('host batch completes several items without reasking and cannot fall back to older API approval',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'art',items:[{id:'a',prompt:'one'},{id:'b',prompt:'two'}]},opts={host,batch,method:'host'};
 let p=a.imageBatchPlan(f.job,{host,batch});a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'one approval for two images'});
 const file=path.join(f.root,'result.png');fs.writeFileSync(file,png);
 for(const id of ['a','b']) {
   const h=await a.dispatchImageBatch(f.job,opts);assert.equal(h.item,id);
   await a.importImageBatch(f.job,{...opts,item:id,signature:h.signature,file,source:'corresponding result '+id});
 }
 assert.equal(a.imageBatchPlan(f.job,{host,batch}).remaining,0);
});
test('API route retains conservative budgets and rejects an unavailable host',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'art',items:[{id:'a',prompt:'one'}]},env={OPENAI_API_KEY:'test-only'};
 f.job.film.generation.image.estimated_cost_usd=10;
 const p=a.imageBatchPlan(f.job,{batch,host:{...host,available:false},env});
 assert.equal(p.routes.api.allowed,false);assert.match(p.routes.api.problems.join(' '),/预算/);
 assert.equal(p.routes.host.allowed,false);assert.equal(p.recommended,null);
 assert.throws(()=>a.approveImageBatch(f.job,{batch,host,method:'api',env,signature:p.routes.api.signature,source:'yes'}),/预算/);
});
test('approved setting text and snapshots reach host; changed settings block new submissions',async t=>{
 const f=await fixture(t),a=await api(),ref={kind:'character',id:'hero',version:'v1'};
 saveSettingVersion(f.root,{...ref,name:'Hero',description:'blue coat, green eyes',references:['films/demo/assets/ref.png']});
 fs.writeFileSync(path.join(f.dir,'settings.json'),JSON.stringify({version:1,categories:{characters:{status:'used'},props:{status:'not-applicable',reason:'none'},scenes:{status:'not-applicable',reason:'none'}},selections:[ref]}));
 fs.writeFileSync(f.job.shots[0].path,JSON.stringify({image_prompt:'portrait',settings:[ref]}));
 assert.throws(()=>a.imageBatchPlan(f.job,{host}),/设定/);
 approveSettings(f.dir,{expectedSignature:settingsReview(f.dir).signature,source:'user approved visual settings'});
 const p=a.imageBatchPlan(f.job,{host});a.approveImageBatch(f.job,{host,method:'host',signature:p.routes.host.signature,source:'host batch'});
 const h=await a.dispatchImageBatch(f.job,{host,method:'host'});assert.match(h.prompt,/blue coat, green eyes/);assert.deepEqual(fs.readFileSync(h.references[0]),png);
 fs.writeFileSync(path.join(f.dir,'assets/ref.png'),Buffer.concat([png,Buffer.from('changed')]));
 assert.throws(()=>a.imageBatchPlan(f.job,{host}),/变化|过期/);
});
test('failed API submission never triggers host or an automatic second API call',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'art',items:[{id:'a',prompt:'one'}]},env={OPENAI_API_KEY:'test-only'};
 f.job.film.generation.image.estimated_cost_usd=0.1;
 const p=a.imageBatchPlan(f.job,{batch,host,env});a.approveImageBatch(f.job,{batch,host,env,method:'api',signature:p.routes.api.signature,source:'use API'});
 let calls=0;const opts={batch,host,method:'api',api:{generateImage:async()=>{calls++;throw new Error('lost response');}}};
 await assert.rejects(a.dispatchImageBatch(f.job,opts),/lost response/);
 await assert.rejects(a.dispatchImageBatch(f.job,opts),/结果不明确/);assert.equal(calls,1);
 await assert.rejects(a.dispatchImageBatch(f.job,{batch,host,method:'host'}),/选择|授权/);
});
test('altered host reference snapshots and completed output bytes fail closed',async t=>{
 const f=await fixture(t),a=await api(),opts={host,method:'host'},file=path.join(f.root,'result.png');fs.writeFileSync(file,png);
 const p=a.imageBatchPlan(f.job,{host});a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'yes'});
 const h=await a.dispatchImageBatch(f.job,opts);fs.writeFileSync(h.references[0],Buffer.concat([png,Buffer.from('changed')]));
 await assert.rejects(a.importImageBatch(f.job,{...opts,item:h.item,signature:h.signature,file,source:'actual result'}),/快照/);
 fs.writeFileSync(h.references[0],png);
 const saved=await a.importImageBatch(f.job,{...opts,item:h.item,signature:h.signature,file,source:'same actual result after restored snapshot'});
 fs.writeFileSync(saved.output,'corrupted');assert.throws(()=>a.imageBatchPlan(f.job,{host}),/已被修改/);
});
test('generic edit requires an original and explicit unattended CLI selection cannot be omitted',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'edit',items:[{id:'edit',prompt:'blue sky',references:['assets/ref.png'],settings:[]}]};
 assert.equal(a.imageBatchPlan(f.job,{batch,host}).routes.host.allowed,true);
 assert.throws(()=>a.imageBatchPlan(f.job,{batch:{stage:'edit',items:[{id:'edit',prompt:'blue sky'}]},host}),/原图/);
 assert.equal(await runCli(['image-approve',f.dir,'--source','yes'],f.io),1);
 assert.equal(await runCli(['generation-approve',f.dir,'--kind','image','--source','yes'],f.io),1);
 const commands=commandsFor({pos:[],opt:(_,d)=>d,log(){}});
 assert.equal(commands['image-plan'].lock,'none');
 for(const name of ['image-approve','image-dispatch','image-import'])assert.equal(commands[name].lock,'film');
});
test('the selected route remains the recommendation when the last item is a retained success from another route',async t=>{
 const f=await fixture(t),a=await api(),batch={stage:'art',items:[{id:'a',prompt:'one'},{id:'b',prompt:'two'}]},opts={batch,host,method:'host'},env={OPENAI_API_KEY:'test-only'};
 f.job.film.generation.image.estimated_cost_usd=0.1;f.job.film.generation.budget.max_image_tasks=5;
 let p=a.imageBatchPlan(f.job,{batch,host});a.approveImageBatch(f.job,{...opts,signature:p.routes.host.signature,source:'host batch'});
 const h=await a.dispatchImageBatch(f.job,{...opts,item:'b'}),file=path.join(f.root,'b.png');fs.writeFileSync(file,png);
 await a.importImageBatch(f.job,{...opts,item:'b',signature:h.signature,file,source:'b tool output'});
 p=a.imageBatchPlan(f.job,{batch,host,env});a.approveImageBatch(f.job,{batch,host,env,method:'api',signature:p.routes.api.signature,source:'switch remaining a to API'});
 assert.equal(a.imageBatchPlan(f.job,{batch,host,env}).recommended,'api');
});
test('a non-image reference cannot be offered to the host as a usable generation route',async t=>{
 const f=await fixture(t),a=await api();fs.writeFileSync(path.join(f.dir,'assets/ref.png'),'not an image');
 const plan=a.imageBatchPlan(f.job,{host});assert.equal(plan.routes.host.allowed,false);assert.match(plan.routes.host.problems.join(' '),/PNG|图片/);
});

test('old image generation approval route cannot bypass image source selection',async t=>{
 const f=await fixture(t);const filmFile=path.join(f.dir,'film.json'),film=JSON.parse(fs.readFileSync(filmFile));
 film.generation.image={provider:'openai',model:'image-test',estimated_cost_usd:0.1};film.generation.budget={image_usd:10,max_image_tasks:10};fs.writeFileSync(filmFile,JSON.stringify(film));
 for(const shot of film.shots)fs.writeFileSync(path.join(f.dir,shot.file),JSON.stringify({image_prompt:'cat'}));
 const code=await runCli(['generation-approve',f.dir,'--kind','image','--method','api','--source','old API batch'],f.io);assert.equal(code,1);assert.match(f.output.at(-1),/image-approve/);
 assert.equal(fs.existsSync(path.join(f.dir,'.wkd/generation-approvals.json')),false);
});
