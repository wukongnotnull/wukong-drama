import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {loadFilm} from '../../plugin/engine/core/film-context.mjs';
function fixture(t,audio,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-film-format-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'s01.json'),'{}');const file=path.join(dir,'film.json');
 fs.writeFileSync(file,JSON.stringify({title:'format',style:'ink-wash',size:[160,90],fps:24,seed:1,generation:{image:{provider:'openai'},video:{provider:'seedance'}},shots:[{id:'s01',file:'s01.json',duration:1}],...(audio?{audio}:{}),...extra}));return {dir,file};
}
for(const audio of [{voiceover:[]},{vo_source:'none'},{voiceover:[],voices:[],vo_source:'none',voice_source:'none'}])test(`old audio fields are rejected without rewriting ${Object.keys(audio)}`,t=>{
 const f=fixture(t,audio),before=fs.readFileSync(f.file);assert.throws(()=>loadFilm(f.dir),/voiceover|vo_source/);assert.deepEqual(fs.readFileSync(f.file),before);
});
test('empty scripts is no longer accepted',t=>{const f=fixture(t,null,{scripts:[]}),before=fs.readFileSync(f.file);assert.throws(()=>loadFilm(f.dir),/scripts/);assert.deepEqual(fs.readFileSync(f.file),before);});
test('current audio names and absent audio load directly without a migration context',t=>{
 for(const audio of [{voices:[],voice_source:'none'},null]){const f=fixture(t,audio);const ctx=loadFilm(f.dir);assert.equal(Object.hasOwn(ctx,'legacyFields'),false);if(audio)assert.deepEqual(ctx.film.audio,audio);}
});
test('loadFilm can skip the shot-file check (for the soundtrack step)', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { loadFilm } = await import('../../plugin/engine/core/film-context.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wkd-load-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  fs.writeFileSync(path.join(dir, 'shots', 's01.json'), '{}');
  const shots = ['s01', 's02', 's03'].map((id, i) => ({ id, file: `shots/${id}.json`, duration: i + 1 }));
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify({ title: 't', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1, generation: {image:{provider:"openai"},video:{provider:"seedance"}}, shots }));
  assert.throws(() => loadFilm(dir), /镜头 s02 的文件不存在/);
  const ctx = loadFilm(dir, { requireShots: false });
  assert.equal(ctx.shots.length, 3);
  assert.equal(ctx.totalDuration, 6);
  assert.equal(ctx.shots[2].start, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});
