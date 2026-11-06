import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as generation from '../../plugin/engine/generation/generation.mjs';
import { approveEmptySettings } from '../helpers/settings.mjs';


function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-gen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'shots')); fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/ref.png'), 'reference A');
  const definition = { image_prompt: '水墨人物', video_prompt: '缓慢抬头', references: ['assets/ref.png'] };
  const shot = { id: 's01', path: path.join(dir, 'shots/s01.json'), duration: 4, frames: 120 };
  fs.writeFileSync(shot.path, JSON.stringify(definition));
  const job = { filmDir: dir, film: { generation: { image: { provider: 'openai', model: 'image-test', estimated_cost_usd: 0.1 }, video: { provider: 'seedance', model: 'video-test', estimated_cost_cny: 1 }, budget: { image_usd: 10, video_cny: 100, max_video_tasks: 20, max_image_tasks: 20 } } }, style: { id: 'ink-wash' }, variant: { aspect: '16:9' }, designW: 1920, designH: 1080, log() {} };
  job.shots = [shot];
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ ...job.film, shots: [{ file: 'shots/s01.json' }] }));
  approveEmptySettings(dir,job.style.id);
  return { dir, definition, shot, job };
}
function mockApi() {
  const counts = { images: 0, submits: 0, polls: 0, downloads: 0 };
  return { counts,
    generateImage: async ({ output }) => { counts.images++; fs.writeFileSync(output, 'generated image'); return { model: 'image-test' }; },
    submitVideo: async () => { counts.submits++; return { id: 'task-1' }; },
    getVideo: async () => { counts.polls++; return { status: 'succeeded', videoUrl: 'https://example.com/video' }; },
    downloadVideo: async ({ output }) => { counts.downloads++; fs.writeFileSync(output, 'generated video'); },
  };
}
async function approve(f, api) {
  generation.approveGeneration(f.job, 'image', { source: 'test user approved image batch' });
  await generation.ensureImage(f.job, f.shot, { api });
  generation.approveGeneration(f.job, 'video', { source: 'test user approved video from reviewed image' });
}
test('generated sources persist and proxy/full requests share one paid job', async t => {
  assert.equal(typeof generation.ensureVideo, 'function');
  const f = fixture(t), api = mockApi();
  await approve(f, api);
  const first = await generation.ensureVideo(f.job, f.shot, { api });
  const second = await generation.ensureVideo({ ...f.job, proxy: true }, f.shot, { api });
  assert.equal(first, second); assert.ok(first.includes('/assets/generated/'));
  assert.deepEqual(api.counts, { images: 1, submits: 1, polls: 1, downloads: 1 });
});
test('poll timeout and download failure resume the same task without resubmission', async t => {
  const f = fixture(t), api = mockApi();
  await approve(f, api);
  const success = api.getVideo;
  api.getVideo = async () => ({ status: 'running' });
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api, pollTimeoutMs: 1, pollIntervalMs: 1 }), /超时/);
  api.getVideo = success;
  const download = api.downloadVideo;
  api.downloadVideo = async () => { throw Error('download interrupted'); };
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /download interrupted/);
  api.downloadVideo = download;
  await generation.ensureVideo(f.job, f.shot, { api });
  assert.equal(api.counts.submits, 1); assert.equal(api.counts.images, 1);
});
test('ambiguous POST is never automatically repeated; revision makes a new request', async t => {
  const f = fixture(t), api = mockApi();
  await approve(f, api);
  api.submitVideo = async () => { api.counts.submits++; throw Error('connection lost'); };
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /connection lost/);
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /revision|结果不明确/);
  assert.equal(api.counts.submits, 1);
  fs.writeFileSync(f.shot.path, JSON.stringify({ ...f.definition, revision: '2' }));
  await approve(f, api);
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /connection lost/);
  assert.equal(api.counts.submits, 2);
});
test('reference bytes and aspect invalidate sources and source evidence', async t => {
  const f = fixture(t), api = mockApi();
  await approve(f, api);
  const first = await generation.ensureVideo(f.job, f.shot, { api });
  const state = generation.generationEvidence(f.job, f.shot);
  fs.writeFileSync(path.join(f.dir, 'assets/ref.png'), 'reference B');
  assert.notDeepEqual(generation.generationEvidence(f.job, f.shot), state);
  await approve(f, api);
  assert.notEqual(await generation.ensureVideo(f.job, f.shot, { api }), first);
  const portrait = { ...f.job, variant: { aspect: '9:16' }, designW: 1080, designH: 1920 };
  await approve({ ...f, job: portrait }, api);
  assert.notEqual(await generation.ensureVideo(portrait, f.shot, { api }), first);
  assert.equal(api.counts.submits, 3);
});
test('failed remote task is retained and never submitted twice', async t => {
  const f = fixture(t), api = mockApi(); await approve(f, api); api.getVideo = async () => ({ status: 'failed', error: 'rejected' });
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /failed/);
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /failed/);
  assert.equal(api.counts.submits, 1);
  const summary=generation.generationPlan(f.job,'video').videoSummary;
  assert.equal(summary.blockedTasks,1);
  assert.match(summary.notice,/失败|核实/);
});
test('local inputs need no keys and unsafe/missing paths fail before providers', async t => {
  const f = fixture(t), api = mockApi();
  fs.writeFileSync(path.join(f.dir, 'assets/video.mp4'), 'local video');
  fs.writeFileSync(f.shot.path, JSON.stringify({ video: 'assets/video.mp4' }));
  assert.equal(await generation.ensureVideo(f.job, f.shot, { api }), path.join(f.dir, 'assets/video.mp4'));
  assert.equal(api.counts.submits, 0);
  fs.writeFileSync(f.shot.path, JSON.stringify({ ...f.definition, references: ['../private.png'] }));
  await assert.rejects(generation.ensureVideo(f.job, f.shot, { api }), /片目录/);
});
test('completed source mutation is rejected instead of silently replacing paid source', async t => {
  const f=fixture(t),api=mockApi();await approve(f,api);
  const source=await generation.ensureVideo(f.job,f.shot,{api});
  fs.writeFileSync(source,'modified source');
  await assert.rejects(generation.ensureVideo(f.job,f.shot,{api}),/已被修改/);
  assert.equal(api.counts.submits,1);
});
test('provider receives approved immutable reference bytes even if source changes during call',async t=>{
  const f=fixture(t),api=mockApi();
  generation.approveGeneration(f.job,'image',{source:'approved reference A'});
  const original=path.join(f.dir,'assets/ref.png');
  api.generateImage=async ({references,output})=>{
    fs.writeFileSync(original,'changed during call');
    assert.notEqual(references[0],original);
    assert.equal(fs.readFileSync(references[0],'utf8'),'reference A');
    fs.writeFileSync(output,'image from reference A');
  };
  await generation.ensureImage(f.job,f.shot,{api});
});
test('successful remote usage is durable before a failed download and does not reserve twice',async t=>{
  const f=fixture(t),api=mockApi();await approve(f,api);
  api.getVideo=async()=>({status:'succeeded',videoUrl:'https://example.org/output.mp4',usage:{completion_tokens:99,total_tokens:99},metadata:{framespersecond:24,duration:4}});
  const download=api.downloadVideo;
  api.downloadVideo=async()=>{throw new Error('download failed after billing');};
  await assert.rejects(generation.ensureVideo(f.job,f.shot,{api}),/download failed/);
  const videoState=fs.readdirSync(path.join(f.dir,'assets/generated/16x9/s01'),{recursive:true}).find(x=>x.startsWith('video-')&&x.endsWith('state.json'));
  const state=JSON.parse(fs.readFileSync(path.join(f.dir,'assets/generated/16x9/s01',videoState)));
  assert.equal(state.remoteStatus,'succeeded');assert.equal(state.status,'submitted');
  assert.equal(state.metadata.usage.completion_tokens,99);assert.equal(state.metadata.metadata.framespersecond,24);
  const records=()=>Object.values(JSON.parse(fs.readFileSync(path.join(f.dir,'.wkd/generation-ledger.json'))).entries).filter(x=>x.kind==='video');
  assert.equal(records().length,1);assert.equal(records()[0].usage.total_tokens,99);
  api.downloadVideo=download;
  await generation.ensureVideo(f.job,f.shot,{api});
  assert.equal(records().length,1);assert.equal(api.counts.submits,1);
});

test('short-shot video plan explains edit time, new source time and only-selected work', t => {
  const f=fixture(t);
  fs.writeFileSync(f.shot.path,JSON.stringify({...f.definition,image:'assets/ref.png'}));
  const durations=[1.5,2,1.5,1.5,1.5,2];
  f.job.shots=durations.map((duration,i)=>({...f.shot,id:`s0${i+1}`,duration}));
  f.job.film.shots=f.job.shots;
  const plan=generation.generationPlan(f.job,'video');
  assert.equal(plan.videoSummary.strategy,'per-shot');
  assert.equal(plan.videoSummary.filmSeconds,10);
  assert.equal(plan.videoSummary.selectedSeconds,10);
  assert.equal(plan.videoSummary.newSourceSeconds,24);
  assert.equal(plan.videoSummary.newEditSeconds,10);
  assert.equal(plan.videoSummary.excessSourceSeconds,14);
  assert.equal(plan.videoSummary.newTasks,6);
  assert.equal(plan.videoSummary.requiresDurationChoice,true);
  assert.match(plan.videoSummary.notice,/24.*10/);
  assert.deepEqual(plan.videoSummary.items.map(x=>[x.model,x.editSeconds,x.requestSeconds]),durations.map(d=>['video-test',d,4]));
  const partial=generation.generationPlan({...f.job,generationShots:[f.job.shots[1]]},'video');
  assert.equal(partial.videoSummary.filmSeconds,10);
  assert.equal(partial.videoSummary.selectedSeconds,2);
  assert.equal(partial.videoSummary.newSourceSeconds,4);
  delete f.job.film.generation.video.estimated_cost_cny;
  assert.equal(generation.generationPlan(f.job,'video').videoSummary.estimatedCost,null,'unknown cost must not be displayed as zero');
});

test('video approval rejects a changed displayed signature before writing approval', t => {
  const f=fixture(t);
  fs.writeFileSync(f.shot.path,JSON.stringify({...f.definition,image:'assets/ref.png'}));
  const displayed=generation.generationPlan(f.job,'video');
  f.job.film.generation.budget.video_cny=200;
  assert.throws(()=>generation.approveGeneration(f.job,'video',{source:'start this batch',expectedSignature:displayed.signature}),/计划.*变化|签名/);
  assert.ok(!fs.existsSync(path.join(f.dir,'.wkd/generation-approvals.json')));
  const current=generation.generationPlan(f.job,'video');
  assert.equal(generation.approveGeneration(f.job,'video',{source:'start updated batch',expectedSignature:current.signature}).signature,current.signature);
});

test('video progress persists checked state, emits waiting updates and resumes without new tasks', async t => {
  const f=fixture(t),api=mockApi(),logs=[];f.job.log=x=>logs.push(x);
  await approve(f,api);
  const signature=generation.generationPlan(f.job,'video').signature;
  api.getVideo=async()=>({status:'queued'});
  await assert.rejects(generation.ensureVideo(f.job,f.shot,{api,pollTimeoutMs:1,pollIntervalMs:1}),/超时/);
  const resumed=generation.generationPlan(f.job,'video');
  assert.equal(resumed.signature,signature,'observed remote progress does not invalidate the approved batch');
  assert.equal(resumed.videoSummary.newTasks,0);
  assert.equal(resumed.videoSummary.resumeTasks,1);
  assert.equal(resumed.videoSummary.newSourceSeconds,0);
  assert.equal(resumed.items[0].progress.remoteStatus,'queued');
  assert.ok(Number.isFinite(Date.parse(resumed.items[0].progress.lastCheckedAt)));
  let resumedPolls=0;
  api.getVideo=async()=>{
    await new Promise(resolve=>setTimeout(resolve,20));
    if (++resumedPolls===1) return {status:'running'};
    return {status:'succeeded',videoUrl:'https://example.com/private-download?token=secret'};
  };
  await generation.ensureVideo(f.job,f.shot,{api,progressIntervalMs:5,pollIntervalMs:1});
  assert.equal(api.counts.submits,1);
  assert.ok(logs.some(x=>/继续查询/.test(x)));
  assert.ok(logs.some(x=>/排队/.test(x)));
  assert.ok(logs.some(x=>/正在生成/.test(x)));
  assert.ok(logs.some(x=>/仍在等待/.test(x)));
  assert.ok(logs.some(x=>/下载/.test(x)));
  assert.ok(logs.some(x=>/完成/.test(x)));
  assert.ok(logs.every(x=>!x.includes('task-1')&&!x.includes('token=secret')));
  const complete=generation.generationPlan(f.job,'video');
  assert.equal(complete.videoSummary.newTasks,0);
  assert.equal(complete.videoSummary.resumeTasks,0);
  assert.equal(complete.items[0].progress.remoteStatus,'succeeded');
  assert.equal(complete.items[0].progress.localStatus,'completed');
  const count=logs.length;
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(logs.length,count,'heartbeat must stop after completion');
  fs.writeFileSync(f.shot.path,JSON.stringify({video:path.relative(f.dir,await generation.ensureVideo(f.job,f.shot,{api}))}));
  const imported=generation.generationPlan(f.job,'video');
  assert.equal(imported.videoSummary.items[0].requestSeconds,null,'imported clip physical duration has not been probed');
  assert.equal(imported.videoSummary.requiresDurationChoice,false);
});
