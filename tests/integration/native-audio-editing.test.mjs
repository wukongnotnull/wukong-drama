import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {runCli} from '../../plugin/engine/cli/run.mjs';
import {mixSoundtrack} from '../../plugin/engine/audio/soundtrack.mjs';

function fixture(t,{subtitles=false}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-native-edit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'shots'));fs.mkdirSync(path.join(dir,'assets'));
  for(const [name,hz,color] of [['main',440,'red'],['variant',880,'blue']]){
    const audio=name==='main'?'aevalsrc=if(lt(t\\,0.5)\\,sin(2*PI*220*t)\\,sin(2*PI*440*t)):s=48000:d=2':`sine=frequency=${hz}:sample_rate=48000:duration=2`;
    const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=10:d=2`,'-f','lavfi','-i',audio,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(dir,`assets/${name}.mp4`)]);assert.equal(r.status,0);
  }
  const film={title:'native',style:'cinematic',size:[160,90],fps:10,seed:1,generation:{image:{provider:'openai'},video:{provider:'seedance',generate_audio:true}},shots:[{id:'s01',file:'shots/s01.json',duration:1}],variants:{'9:16':{}},export:{name:'out',formats:['mp4']},...(subtitles?{subtitles:{mode:'burn'}}:{})};
  fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
  fs.writeFileSync(path.join(dir,'shots/s01.json'),JSON.stringify({video:'assets/main.mp4',source_start:0.5}));
  fs.writeFileSync(path.join(dir,'shots/s01.9x16.json'),JSON.stringify({video:'assets/variant.mp4'}));
  if(subtitles)for(const name of ['subtitles.srt','subtitles.9x16.srt'])fs.writeFileSync(path.join(dir,name),'1\n00:00:00,000 --> 00:00:01,000\n测试\n');
  const log=[],io={log:s=>log.push(s),error:s=>log.push(s)};
  const run=async(...args)=>{const code=await runCli(args,io);assert.equal(code,0,log.join('\n'));log.length=0;};
  return {dir,run};
}
function pcm(file){const r=spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-t','0.8','-f','s16le','-ac','1','-ar','48000','-'],{maxBuffer:1e6});assert.equal(r.status,0);return r.stdout;}
function crossings(bytes){let n=0;for(let i=2;i<bytes.length;i+=2)if(bytes.readInt16LE(i-2)<0&&bytes.readInt16LE(i)>=0)n++;return n;}

test('aspect variants reuse main native audio and preserve its source selection',async t=>{
  const f=fixture(t);await f.run('render',f.dir,'--proxy');await f.run('render',f.dir,'--proxy','--aspect','9:16');
  const main=await mixSoundtrack(f.dir,{log(){}}),variant=await mixSoundtrack(f.dir,{aspect:'9:16',log(){}});
  assert.equal(variant.tracks[0].file,main.tracks[0].file);assert.equal(variant.tracks[0].sourceStart,0.5);
  assert.deepEqual(pcm(variant.mix),pcm(main.mix));
  assert.ok(Math.abs(crossings(pcm(main.mix))-352)<8,'mixed audio must start at 0.5s, after the 220Hz opening');
});

test('variant subtitle preview carries the same actual audio as its reviewed proxy',async t=>{
  const f=fixture(t,{subtitles:true});await f.run('render',f.dir,'--proxy');await f.run('render',f.dir,'--proxy','--aspect','9:16');
  // A stale unrelated main mix must never be attached to the variant preview.
  const mainMix=path.join(f.dir,'.cache/mix.wav');
  const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=1200:duration=1','-ar','48000','-ac','2',mainMix]);assert.equal(r.status,0);
  await f.run('subtitles',f.dir,'--preview','--aspect','9:16');
  const proxy=pcm(path.join(f.dir,'review/小样-9x16.mp4')),preview=pcm(path.join(f.dir,'review/字幕预览-9x16.mp4'));
  assert.ok(Math.abs(crossings(proxy)-crossings(preview))<10);
});

test('a silent imported variant can reuse main sound without inventing another native audio track',async t=>{
  const f=fixture(t),source=path.join(f.dir,'assets/variant.mp4'),silent=path.join(f.dir,'assets/silent.mp4');
  const r=spawnSync('ffmpeg',['-v','error','-y','-i',source,'-c:v','copy','-an',silent]);assert.equal(r.status,0);
  fs.writeFileSync(path.join(f.dir,'shots/s01.9x16.json'),JSON.stringify({video:'assets/silent.mp4'}));
  await f.run('render',f.dir,'--proxy');await f.run('render',f.dir,'--proxy','--aspect','9:16');
  const main=await mixSoundtrack(f.dir,{log(){}}),variant=await mixSoundtrack(f.dir,{aspect:'9:16',log(){}});
  assert.deepEqual(pcm(main.mix),pcm(variant.mix));
});
