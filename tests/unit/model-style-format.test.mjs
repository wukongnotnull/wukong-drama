import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const prior=process.env.WUKONG_DRAMA_HOME;
const home=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-model-style-compat-'));
process.env.WUKONG_DRAMA_HOME=home;
after(()=>{if(prior===undefined)delete process.env.WUKONG_DRAMA_HOME;else process.env.WUKONG_DRAMA_HOME=prior;fs.rmSync(home,{recursive:true,force:true});});
const {getStyles}=await import('../../plugin/engine/core/registry.mjs');
const legacyFields={kits:{},libs:[],scripts:[],fonts:[],post:[]};
function styleFixture(t,id,fields={}) {
  const dir=path.join(home,'styles',id);fs.mkdirSync(dir,{recursive:true});t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const value={id,name:'旧模型风格',category:'custom',order:101,engine:'>=0.1.0',pipeline:'generation',fps:24,keywords:['test'],...legacyFields,...fields};
  const file=path.join(dir,'style.json');fs.writeFileSync(file,JSON.stringify(value,null,2));return {file,value};
}

test('empty obsolete visual fields are rejected without rewriting the user style',t=>{
 const {file,value}=styleFixture(t,'old-model'),before=fs.readFileSync(file);
 const {styles,problems}=getStyles();assert.equal(styles.has(value.id),false);assert.match(problems.join('\n'),/kits|libs|scripts|fonts|post/);assert.deepEqual(fs.readFileSync(file),before);
});

for(const [field,value] of Object.entries({kits:{canvas2d:'^0.1'},libs:['three'],scripts:['paint.js'],fonts:[{family:'Inter'}],post:['glow']})) {
  test(`nonempty legacy ${field} remains unsupported`,t=>{
    const {file}=styleFixture(t,`nonempty-${field}`,{[field]:value}),before=fs.readFileSync(file);
    const {styles,problems}=getStyles();assert.equal(styles.has(`nonempty-${field}`),false);assert.match(problems.join('\n'),new RegExp(field));
    assert.deepEqual(fs.readFileSync(file),before);
  });
}

test('empty fields never restore a code pipeline or accept wrongly typed legacy fields',t=>{
  styleFixture(t,'old-code',{pipeline:'browser'});
  styleFixture(t,'wrong-types',{kits:[],libs:{},scripts:null});
  const {styles,problems}=getStyles();assert.equal(styles.has('old-code'),false);assert.equal(styles.has('wrong-types'),false);
  assert.match(problems.join('\n'),/generation/);assert.match(problems.join('\n'),/kits|libs|scripts/);
});
