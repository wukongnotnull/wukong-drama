import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const word = await import('../../plugin/engine/core/word-sync.mjs').catch(() => ({}));
test('来源绑定、重复词选择、过期测量回退和整体平移', () => {
  assert.equal(typeof word.resolveWordSync,'function','缺少词级来源解析');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-word-'));
  try {
    fs.writeFileSync(path.join(dir,'voice.wav'),'actual voice bytes');
    const film={audio:{voice_source:'user',voices:[{cue:'v01',text:'有素材，无素材，有素材',at:1,file:'voice.wav'}]},cues:{v01:[1,4]}};
    const ctx={filmDir:dir,film};
    word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:3}]);
    const source=JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices.v01;
    const point={id:'materials',voice:'v01',text:'有素材',occurrence:2,method:'manual',source:{audio_sha256:source.audio_sha256,text_sha256:source.text_sha256},range:[2,2.5],evidence:'听审标注'};
    fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:[point]}));
    let result=word.resolveWordSync(ctx);
    assert.deepEqual(result.cues['word:materials'],[3,3.5]);
    assert.equal(result.evidence['word:materials'].verified,true);
    film.audio.voices[0].at=2;
    assert.deepEqual(word.resolveWordSync(ctx).cues['word:materials'],[4,4.5]);
    assert.equal(word.resolveWordSync(ctx).evidence['word:materials'].verified,false,'混音未刷新时不能宣称通过');
    word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:3}]);
    assert.equal(word.resolveWordSync(ctx).evidence['word:materials'].verified,true);
    fs.writeFileSync(path.join(dir,'voice.wav'),'new audio');
    result=word.resolveWordSync(ctx);
    assert.equal(result.evidence['word:materials'].verified,false);
    assert.equal(result.evidence['word:materials'].method,'estimated');
    assert.notDeepEqual(result.cues['word:materials'],[4,4.5]);
    delete point.occurrence;
    fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:[point]}));
    assert.throws(()=>word.resolveWordSync(ctx),/occurrence/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('词首映射到转码帧；越界不静默夹取',()=>{
  for(const fps of [30,15,25,13]) for(let target=0;target<10;target++) {
    const r=word.wordFrame({in:(target+5)/fps},{startFrame:5,frames:10},{fps});
    assert.equal(r.valid,true);assert.equal(r.frame,target);assert.equal(r.globalFrame,target+5);
  }
  assert.equal(word.wordFrame({in:-1},{startFrame:0,frames:30},{fps:30}).valid,false);
  assert.equal(word.wordFrame({in:1},{startFrame:0,frames:30},{fps:30}).valid,false);
});

test('超出全片的词点仍进入末镜审阅并明确标为越界',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-word-outside-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const audio=path.join(dir,'voice.wav');fs.writeFileSync(audio,'registered audio source');
  const film={audio:{voice_source:'user',voices:[{cue:'v',text:'词尾',at:0,file:'voice.wav'}]}};
  word.writeVoiceSources({filmDir:dir,film},[{file:audio,duration:3}]);
  const {audio_sha256,text_sha256}=JSON.parse(fs.readFileSync(path.join(dir,'.cache/voice-sources.json'))).voices.v;
  const source={audio_sha256,text_sha256};
  fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:[
    {id:'inside',voice:'v',text:'词',method:'manual',range:[0.2,0.3],source,evidence:'听审'},
    {id:'outside',voice:'v',text:'尾',method:'manual',range:[2.2,2.3],source,evidence:'听审'},
  ]}));
  const job=word.prepareWordShots({filmDir:dir,film,fps:10,shots:[{id:'s01',startFrame:0,frames:10},{id:'s02',startFrame:10,frames:10}]});
  const points=job.shots.flatMap(s=>s.wordPoints);
  assert.equal(points.length,2,'不得把超出全片的声明词点静默丢弃');
  assert.equal(points[0].valid,true);assert.equal(points[1].valid,false);
  assert.equal(points[1].shot,'s02');assert.match(points[1].reason,/范围/);
});

test('错误声明、估算分级、音色变化、无关配乐与来源清理',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-word-validation-'));
 try {
  assert.deepEqual(word.resolveWordSync({filmDir:dir,film:{}}).points,[]);
  fs.writeFileSync(path.join(dir,'voice.wav'),'voice content');
  const line={cue:'v01',text:'𠮷有素材',at:0,file:'voice.wav'};
  const ctx={filmDir:dir,film:{audio:{voice_source:'user',voices:[line]},cues:{}}};
  word.writeVoiceSources(ctx,[{file:path.join(dir,'voice.wav'),duration:1}]);
  const src=JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices.v01;
  const point={id:'unicode',voice:'v01',text:'有素材',method:'manual',source:{audio_sha256:src.audio_sha256,text_sha256:src.text_sha256},range:[0.2,0.8],evidence:'听审'};
  const put=p=>fs.writeFileSync(path.join(dir,'sync-points.json'),JSON.stringify({version:1,points:Array.isArray(p)?p:[p]}));put(point);
  let r=word.resolveWordSync(ctx);assert.equal(r.evidence['word:unicode'].verified,true);
  ctx.film.audio.tracks=[{file:'bgm.wav'}];assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,true);
  line.voice='different';assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,false);delete line.voice;
  put({...point,range:[0.5,1.2]});assert.throws(()=>word.resolveWordSync(ctx),/超出/);
  put({...point,source:undefined});assert.throws(()=>word.resolveWordSync(ctx),/缺少/);
  put([point,point]);assert.throws(()=>word.resolveWordSync(ctx),/重复/);
  put({...point,text:'不存在'});assert.throws(()=>word.resolveWordSync(ctx),/不存在/);
  put({...point,method:'estimated',range:undefined,source:undefined});assert.equal(word.resolveWordSync(ctx).evidence['word:unicode'].verified,false);
  ctx.film.audio.voices=[];word.writeVoiceSources(ctx,[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'.cache','voice-sources.json'))).voices,{});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
