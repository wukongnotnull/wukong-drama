import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as pipeline from '../../plugin/engine/pipelines/generation/index.mjs';
import { nativeAudioTracks, generationEvidence, approveGeneration } from '../../plugin/engine/generation/generation.mjs';
import { fileDigest } from '../../plugin/engine/core/evidence.mjs';
import { approveEmptySettings } from '../helpers/settings.mjs';

function probe(file) {
  const result=spawnSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
function fixture(t,sourceDuration=0.8) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-model-pipeline-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'assets'));
  const source=path.join(dir,'assets/input.mp4');
  const made=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=20','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t',String(sourceDuration),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  const shot={id:'s01',duration:0.5,frames:5,start:0,path:path.join(dir,'shot.json')};
  fs.writeFileSync(shot.path,JSON.stringify({video:'assets/input.mp4'}));
  const job={filmDir:dir,film:{size:[160,90],fps:10,generation:{image:{model:'test'},video:{model:'test',generate_audio:true}}},variant:{aspect:'16:9'},style:{id:'anime'},shots:[shot],W:160,H:90,designW:160,designH:90,fps:10,log(){}};
  return {dir,source,shot,job,out:path.join(dir,'segment.mp4')};
}
test('real imported source normalizes exact frames and preserves native audio separately',async t=>{
  assert.equal(typeof pipeline.renderShots,'function');
  const f=fixture(t),before=fileDigest(f.source);let complete=0;
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out,hash:'test'}],{onDone:()=>complete++});
  const result=probe(f.out),video=result.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,160);assert.equal(video.height,90);assert.equal(video.nb_read_frames,'5');
  assert.equal(video.avg_frame_rate,'10/1');assert.equal(result.streams.some(s=>s.codec_type==='audio'),false);
  assert.equal(complete,1);assert.equal(fileDigest(f.source),before);
  const audio=nativeAudioTracks(f.job);assert.equal(audio.length,1);
  assert.equal(audio[0].start,0);assert.equal(audio[0].duration,0.5);
  assert.ok(Number(probe(audio[0].file).format.duration)>=0.79,'native source audio is retained without trimming');
  f.shot.duration=0.7;assert.equal(nativeAudioTracks(f.job)[0].file,audio[0].file);
  const stills=path.join(f.dir,'stills');fs.mkdirSync(stills);
  const files=await pipeline.renderStills(f.job,[{shot:'s01',t:0.3}],stills);
  assert.equal(files.length,1);assert.equal(probe(files[0]).streams[0].width,160);
});
for(const enabled of [undefined,false])test(`native audio extraction with generate_audio=${enabled}`,async t=>{
  const f=fixture(t);
  if(enabled===undefined)delete f.job.film.generation.video.generate_audio;
  else f.job.film.generation.video.generate_audio=enabled;
  const before=fileDigest(f.source);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  assert.equal(nativeAudioTracks(f.job).length,enabled===false?0:1);
  assert.equal(Object.hasOwn(generationEvidence(f.job,f.shot),'nativeAudio'),enabled!==false);
  assert.equal(fileDigest(f.source),before);
});
test('short source fails instead of freezing frames to hide missing action',async t=>{
  const f=fixture(t,0.2);
  await assert.rejects(pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{}),/时长不足/);
  assert.equal(fs.existsSync(f.out),false);
});
test('local image produces a review still without generation credentials',async t=>{
  const f=fixture(t);
  const image=path.join(f.dir,'assets/frame.png');
  const made=spawnSync('ffmpeg',['-v','error','-y','-i',f.source,'-frames:v','1',image],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  fs.writeFileSync(f.shot.path,JSON.stringify({image:'assets/frame.png',video_prompt:'cat runs'}));
  const files=await pipeline.renderStills(f.job,[{shot:'s01',t:0}],path.join(f.dir,'stills'));
  assert.equal(files.length,1);assert.equal(probe(files[0]).streams[0].height,90);
});
test('native audio deletion or mutation changes render evidence and requires reconstruction',async t=>{
  const f=fixture(t);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  const pristine=generationEvidence(f.job,f.shot);
  const audio=nativeAudioTracks(f.job)[0].file;
  fs.unlinkSync(audio);
  assert.notDeepEqual(generationEvidence(f.job,f.shot),pristine);
  assert.throws(()=>nativeAudioTracks(f.job),/render.*重建原生音轨/);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  assert.equal(nativeAudioTracks(f.job).length,1);
  fs.appendFileSync(audio,'corrupt bytes');
  assert.notDeepEqual(generationEvidence(f.job,f.shot),pristine);
  assert.throws(()=>nativeAudioTracks(f.job),/render.*重建原生音轨/);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  assert.equal(nativeAudioTracks(f.job).length,1);
  fs.unlinkSync(audio+'.json');
  assert.notDeepEqual(generationEvidence(f.job,f.shot),pristine);
  assert.throws(()=>nativeAudioTracks(f.job),/render.*重建原生音轨/);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  assert.equal(nativeAudioTracks(f.job).length,1);
  fs.writeFileSync(audio+'.json','broken JSON');
  assert.throws(()=>nativeAudioTracks(f.job),/render.*重建原生音轨/);
  await pipeline.renderShots(f.job,[{shot:f.shot,out:f.out}],{});
  assert.equal(nativeAudioTracks(f.job).length,1);
});
test('generated source must meet requested native resolution before scaling',t=>{
  const f=fixture(t);
  assert.equal(typeof pipeline.validateSourceVideo,'function');
  assert.throws(()=>pipeline.validateSourceVideo(f.job,f.shot,f.source,{generated:true}),/原生.*720p/);
  const imported=pipeline.validateSourceVideo(f.job,f.shot,f.source,{generated:false});
  assert.equal(imported.width,320);assert.equal(imported.height,180);
  assert.equal(imported.fps,20);assert.equal(imported.audio,true);
});
test('selected still generation uses the same local batch that was approved',async t=>{
  const f=fixture(t),image=path.join(f.dir,'assets/frame.png');
  const made=spawnSync('ffmpeg',['-v','error','-y','-i',f.source,'-frames:v','1',image],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
  const bytes=fs.readFileSync(image),second={...f.shot,id:'s02',path:path.join(f.dir,'second.json')};
  fs.writeFileSync(second.path,JSON.stringify({image_prompt:'solid blue',settings:[]}));
  f.job.shots.push(second);f.job.film.generation.image={model:'test',estimated_cost_usd:0.1,api_key_env:'WKD_SETTINGS_PIPELINE_TEST_KEY'};
  f.job.film.generation.budget={image_usd:1,max_image_tasks:2};approveEmptySettings(f.dir,'anime');
  approveGeneration({...f.job,shots:[second]},'image',{source:'测试只批准 s02 图片'});
  const prior=process.env.WKD_SETTINGS_PIPELINE_TEST_KEY;process.env.WKD_SETTINGS_PIPELINE_TEST_KEY='test-only';
  t.after(()=>{if(prior===undefined)delete process.env.WKD_SETTINGS_PIPELINE_TEST_KEY;else process.env.WKD_SETTINGS_PIPELINE_TEST_KEY=prior;});
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}),{status:200,headers:{'content-type':'application/json'}});});
  const files=await pipeline.renderStills(f.job,[{shot:'s02',t:0}],path.join(f.dir,'stills'));
  assert.equal(files.length,1);assert.equal(calls,1);assert.equal(probe(files[0]).streams[0].width,160);
});
