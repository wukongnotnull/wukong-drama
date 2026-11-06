import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as generation from '../../plugin/engine/generation/generation.mjs';
import { approveEmptySettings } from '../helpers/settings.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shot = { id: 's01', duration: 4, path: path.join(dir, 'shot.json') };
  fs.writeFileSync(shot.path, JSON.stringify({ image_prompt: 'cat', video_prompt: 'cat runs' }));
  const job = { filmDir: dir, film: { size: [1280,720], generation: {
    image: { model: 'test-image', estimated_cost_usd: 0.2 },
    video: { generate_audio: false, model: 'test-video', estimated_cost_cny: 2 },
    budget: { image_usd: 1, video_cny: 3, max_image_tasks: 2, max_video_tasks: 1 },
  } }, variant: { aspect: '16:9' }, style: { id: 'cartoon' }, shots: [shot] };
  const counts = { image: 0, video: 0 };
  const api = {
    generateImage: async ({output}) => {counts.image++;fs.writeFileSync(output,'image');},
    submitVideo: async () => {counts.video++;return {id:'one'};},
    getVideo: async () => ({status:'succeeded',videoUrl:'https://example.org/a.mp4'}),
    downloadVideo: async ({output}) => fs.writeFileSync(output,'video'),
  };
  approveEmptySettings(dir,job.style.id);
  return {dir,shot,job,api,counts};
}
test('plan is read-only and unknown estimates block paid calls', async t => {
  assert.equal(typeof generation.generationPlan, 'function');
  const f=fixture(t);delete f.job.film.generation.image.estimated_cost_usd;
  const before=fs.readdirSync(f.dir);
  const plan=generation.generationPlan(f.job,'image');
  assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/估算/);
  assert.deepEqual(fs.readdirSync(f.dir),before);
  await assert.rejects(generation.ensureImage(f.job,f.shot,{api:f.api}),/估算|授权/);
  assert.equal(f.counts.image,0);
});
test('approval binds input bytes and cannot be reused after prompt changes', async t => {
  const f=fixture(t);
  await assert.rejects(generation.ensureImage(f.job,f.shot,{api:f.api}),/授权/);
  generation.approveGeneration(f.job,'image',{source:'explicit user permission'});
  fs.writeFileSync(f.shot.path,JSON.stringify({image_prompt:'different cat',video_prompt:'cat runs'}));
  await assert.rejects(generation.ensureImage(f.job,f.shot,{api:f.api}),/授权/);
  assert.equal(f.counts.image,0);
});
test('image source is required before video batch approval', t => {
  const f=fixture(t);
  assert.throws(()=>generation.approveGeneration(f.job,'video',{source:'yes'}),/分镜图/);
});
test('cumulative task ceiling survives a new revision and a fresh approval', async t => {
  const f=fixture(t);
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  await generation.ensureImage(f.job,f.shot,{api:f.api});
  generation.approveGeneration(f.job,'video',{source:'video approved'});
  await generation.ensureVideo(f.job,f.shot,{api:f.api});
  fs.writeFileSync(f.shot.path,JSON.stringify({image_prompt:'cat',video_prompt:'cat jumps'}));
  const plan=generation.generationPlan(f.job,'video');
  assert.equal(plan.allowed,false);assert.match(plan.problems.join(' '),/任务上限/);
  assert.throws(()=>generation.approveGeneration(f.job,'video',{source:'retry'}),/任务上限/);
  await assert.rejects(generation.ensureVideo(f.job,f.shot,{api:f.api}),/任务上限|授权/);
  assert.equal(f.counts.video,1);assert.equal(f.counts.image,1);
});
test('concurrent identical requests cannot submit twice', async t => {
  const f=fixture(t);
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  const generate=f.api.generateImage;
  f.api.generateImage=async args=>{await new Promise(resolve=>setTimeout(resolve,30));return generate(args);};
  const outcomes=await Promise.allSettled([generation.ensureImage(f.job,f.shot,{api:f.api}),generation.ensureImage(f.job,f.shot,{api:f.api})]);
  assert.equal(f.counts.image,1);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
});
test('missing credentials do not create an ambiguous submission or consume budget', async t => {
  const f=fixture(t);
  f.job.film.generation.image.api_key_env='WKD_TEST_NEVER_CONFIGURED_KEY';
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  await assert.rejects(generation.ensureImage(f.job,f.shot),/WKD_TEST_NEVER_CONFIGURED_KEY/);
  assert.equal(generation.generationPlan(f.job,'image').reservedCost,0);
});
test('downstream video credentials and duration are checked before any paid image', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected network call');});
  const f=fixture(t);
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  await assert.rejects(generation.ensureImage(f.job,f.shot,{env:{OPENAI_API_KEY:'test-only'}}),/ARK_API_KEY/);
  assert.equal(generation.generationPlan(f.job,'image').reservedCost,0);
  f.job.film.generation.video.model='doubao-seedance-2-5-260628';f.shot.duration=31;
  await assert.rejects(generation.ensureImage(f.job,f.shot,{env:{OPENAI_API_KEY:'test-only',ARK_API_KEY:'test-only'}}),/30/);
  assert.equal(generation.generationPlan(f.job,'image').reservedCost,0);
});
test('invalid image quality or reference fails locally before reserving a request',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('unexpected network');});
  const f=fixture(t);
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  f.job.film.generation.image.quality='invalid-quality';
  const env={OPENAI_API_KEY:'test-only',ARK_API_KEY:'test-only'};
  await assert.rejects(generation.ensureImage(f.job,f.shot,{env}),/质量/);
  assert.equal(generation.generationPlan(f.job,'image').reservedCost,0);
  delete f.job.film.generation.image.quality;
  fs.writeFileSync(path.join(f.dir,'invalid.png'),'not a PNG');
  fs.writeFileSync(f.shot.path,JSON.stringify({image_prompt:'cat',video_prompt:'cat runs',references:['invalid.png']}));
  generation.approveGeneration(f.job,'image',{source:'reference approved'});
  await assert.rejects(generation.ensureImage(f.job,f.shot,{env}),/PNG|图片/);
  assert.equal(generation.generationPlan(f.job,'image').reservedCost,0);assert.equal(calls,0);
});
test('invalid first-frame file does not consume the only video task',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('unexpected network');});
  const f=fixture(t);
  generation.approveGeneration(f.job,'image',{source:'image approved'});
  await generation.ensureImage(f.job,f.shot,{api:f.api}); // fixture deliberately writes non-PNG bytes
  generation.approveGeneration(f.job,'video',{source:'video approved'});
  await assert.rejects(generation.ensureVideo(f.job,f.shot,{env:{OPENAI_API_KEY:'test-only',ARK_API_KEY:'test-only'}}),/PNG|图片/);
  const plan=generation.generationPlan(f.job,'video');
  assert.equal(plan.reservedCost,0);assert.equal(plan.reservedTasks,0);assert.equal(calls,0);
});
