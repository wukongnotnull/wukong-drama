import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFilm } from '../../plugin/engine/core/film-context.mjs';
import { sourceState } from '../../plugin/engine/core/operations.mjs';

function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-model-film-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.mkdirSync(path.join(dir,'shots'));fs.mkdirSync(path.join(dir,'assets'));
 fs.writeFileSync(path.join(dir,'shots/s01.json'),JSON.stringify({image_prompt:'kitchen',video_prompt:'cat moves',references:['assets/ref.png']}));
 fs.writeFileSync(path.join(dir,'assets/ref.png'),'imageA');
 const film={title:'test',style:'ink-wash',size:[1280,720],fps:24,seed:72,shots:[{id:'s01',file:'shots/s01.json',duration:30}],generation:{image:{provider:'openai'},video:{provider:'seedance',generate_audio:true},budget:{image_usd:1,video_cny:60,max_video_tasks:1}}};
 fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
 return {dir,film};
}
test('model film resolves generation without loading legacy visual scripts or fonts',t=>{
 const {dir}=fixture(t);const ctx=loadFilm(dir);
 assert.equal(ctx.pipeline.name,'generation');assert.equal(ctx.kits,undefined);assert.equal(ctx.styleScripts,undefined);assert.equal(ctx.style.fonts,undefined);
});
test('changing model source bytes invalidates production evidence',t=>{
 const {dir}=fixture(t),before=sourceState(dir);
 fs.writeFileSync(path.join(dir,'assets/ref.png'),'imageB');
 assert.notEqual(sourceState(dir),before);
});
test('secrets are never accepted in generation configuration',t=>{
 const {dir,film}=fixture(t);film.generation.image.api_key='not-a-real-key';
 fs.writeFileSync(path.join(dir,'film.json'),JSON.stringify(film));
 assert.throws(()=>loadFilm(dir),/未知字段/);
});
