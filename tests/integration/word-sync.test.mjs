import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {writeModelShot,generation} from '../fixtures/model.mjs';
const WKA=fileURLToPath(new URL('../../plugin/engine/bin/wkd.mjs',import.meta.url));
const home=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-word-home-'));
after(()=>fs.rmSync(home,{recursive:true,force:true}));
const env={...process.env,WUKONG_DRAMA_HOME:home,WKD_NO_FONT_DOWNLOAD:'1'};
const cli=(...args)=>spawnSync(process.execPath,[WKA,...args],{env,encoding:'utf8',maxBuffer:8e6});

test('模型素材的词首审阅保留音频来源与帧定位，修改标注复用模型画面',{timeout:600000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-word-film-'));fs.mkdirSync(path.join(dir,'shots'));
 try {
  const wave=path.join(dir,'voice.wav');
  const tone=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',"aevalsrc='0.2*sin(2*PI*440*t)*(between(t,0.2,0.25)+between(t,1.05,1.1)+between(t,2.11,2.16))':s=48000:d=3",wave]);assert.equal(tone.status,0,String(tone.stderr));
  const terms=['有素材','无素材','纯文字'];
  writeModelShot(path.join(dir,'shots/s01.json'),{color:'black',duration:0.3,size:[32,18]});
  writeModelShot(path.join(dir,'shots/s02.json'),{color:'#204060',duration:3.3,size:[32,18]});
  const film={title:'word',style:'anime',size:[32,18],fps:30,seed:1,generation,variants:{'9:16':{}},shots:[{id:'s01',file:'shots/s01.json',duration:0.17},{id:'s02',file:'shots/s02.json',duration:3.12}],audio:{voice_source:'user',voices:[{cue:'v01',text:terms.join('，'),at:0.17,file:'voice.wav'}]}};
  const filmFile=path.join(dir,'film.json');fs.writeFileSync(filmFile,JSON.stringify(film));
  const track=cli('soundtrack',dir);assert.equal(track.status,0,track.stderr);
  const recording=fs.readFileSync(wave),savedMix=fs.readFileSync(path.join(dir,'.cache/mix.wav'));
  const source=JSON.parse(fs.readFileSync(path.join(dir,'.cache/voice-sources.json'))).voices.v01;
  const times=[0.2,1.05,2.11];
  fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:terms.map((text,i)=>({id:`p${i}`,voice:'v01',text,method:'manual',range:[times[i],times[i]+0.05],source:{audio_sha256:source.audio_sha256,text_sha256:source.text_sha256},evidence:'固定音频脉冲测试标注'}))}));
  const originalSRT='1\n00:00:00,200 --> 00:00:01,000\n手改字幕\n';fs.writeFileSync(path.join(dir,'subtitles.srt'),originalSRT);
  for(const fps of [30,25]) for(const aspect of [null,'9:16']) for(const proxy of [false,true]) {
   film.fps=fps;fs.writeFileSync(filmFile,JSON.stringify({...film,cues:JSON.parse(fs.readFileSync(filmFile)).cues}));
   const r=cli('render',dir,...(aspect?['--aspect',aspect]:[]),...(proxy?['--proxy']:[]));assert.equal(r.status,0,r.stderr+r.stdout.slice(-2500));
   const report=JSON.parse(fs.readFileSync(path.join(dir,'review',`词级同步${aspect?'-9x16':''}${proxy?'-proxy':''}.json`)));
   const rate=proxy?Math.min(15,fps):fps;
   assert.equal(report.points.length,3);assert.equal(report.fps,rate);
   for(const [index,point] of report.points.entries()) {
    assert.equal(point.valid,true);assert.equal(point.verified,true);assert.equal(point.shot,'s02');
    assert.equal(point.globalFrame,Math.round((0.17+times[index])*rate));
    assert.equal(point.images.length,3);assert.ok(point.images.every(file=>fs.statSync(file).size>0));
    assert.ok(fs.statSync(point.audio).size>0);
   }
  }
  assert.equal(fs.readFileSync(path.join(dir,'subtitles.srt'),'utf8'),originalSRT);
  assert.deepEqual(fs.readFileSync(wave),recording,'原录音不变');
  assert.deepEqual(fs.readFileSync(path.join(dir,'.cache/mix.wav')),savedMix,'转码与审帧不改已存混音');
  const pointFile=path.join(dir,'sync-points.json'),data=JSON.parse(fs.readFileSync(pointFile));
  data.points[0].range[0]+=0.01;fs.writeFileSync(pointFile,JSON.stringify(data));
  const changed=cli('render',dir,'--proxy','--aspect','9:16');assert.equal(changed.status,0,changed.stderr);
  assert.match(changed.stdout,/s01 缓存命中/);assert.match(changed.stdout,/s02 缓存命中/,'声音审阅标注不重生或重转码模型画面');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
