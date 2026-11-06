import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-resource-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(p,s='source')=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s);};
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init','-b','main');
 for(const p of ['plugin/engine/a.mjs','plugin/skills/a/SKILL.md','plugin/catalog.json','plugin/plugin.json','tools/build-plugin.mjs','distribution/agents.json','LICENSE','LICENSE-MEDIA','docs/UPSTREAM.md','docs/note.md','.gitignore'])write(p);
 for(const p of ['plugin/engine/.wkd/state.json','plugin/engine/credentials.json','plugin/skills/a/review/report.md','plugin/skills/a/generated/task.json','plugin/skills/a/media/user.mp4','plugin/skills/cinematic/examples/stealing-kitten/media/final/portrait.mp4'])write(p);
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','base');
 return {root,write,git};
}
async function api(){const file=new URL('../../tools/lib/package-resources.mjs',import.meta.url);assert.ok(fs.existsSync(file),'shared resource collector required');return import(file.href);}
test('both targets use the same safe tracked resources and development is explicit',async t=>{
 const f=fixture(t),{collectResources}=await api();f.write('plugin/engine/new.mjs');
 for(const target of ['native','portable']){
  const release=collectResources({root:f.root,target});assert.equal(release.buildMode,'release');assert.ok(!release.files.includes('plugin/engine/new.mjs'));
  assert.ok(release.files.includes('plugin/skills/cinematic/examples/stealing-kitten/media/final/portrait.mp4'));
  for(const p of release.files)assert.ok(!/\.wkd|credentials|\/review\/|\/generated\/|user\.mp4/.test(p),p);
  const dev=collectResources({root:f.root,target,mode:'development'});assert.equal(dev.buildMode,'development');assert.ok(dev.files.includes('plugin/engine/new.mjs'));
 }
});
test('release rejects staged or unstaged participating changes, unrelated docs do not block',async t=>{
 const f=fixture(t),{collectResources}=await api();f.write('docs/note.md','new note');
 assert.doesNotThrow(()=>collectResources({root:f.root,target:'native'}));
 for(const p of ['plugin/engine/a.mjs','tools/build-plugin.mjs','distribution/agents.json','LICENSE-MEDIA']){
  f.write(p,'changed');assert.throws(()=>collectResources({root:f.root,target:'portable'}),/未提交|dirty/);
  f.git('add',p);assert.throws(()=>collectResources({root:f.root,target:'native'}),/未提交|dirty/);f.git('restore','--source=HEAD','--staged','--worktree',p);
 }
});
test('a changed snapshot or nonregular runtime resource is rejected',async t=>{
 const f=fixture(t),{collectResources,assertResourcesUnchanged}=await api();
 const plan=collectResources({root:f.root,target:'native',mode:'development'});f.write('plugin/engine/a.mjs','changed');assert.throws(()=>assertResourcesUnchanged(plan),/变化|changed/);
 fs.symlinkSync(path.join(f.root,'LICENSE'),path.join(f.root,'plugin/engine/link.mjs'));
 assert.throws(()=>collectResources({root:f.root,target:'native',mode:'development'}),/普通文件|regular/);
});
