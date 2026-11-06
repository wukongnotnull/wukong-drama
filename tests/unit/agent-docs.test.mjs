import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('installation guide and reference regenerate together and check is read-only for both',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-install-docs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const name of ['tools/build-agent-docs.mjs','tools/install-agent.mjs','distribution/agents.json','plugin/plugin.json']){
  const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,name),dest);
 }
 fs.mkdirSync(path.join(dir,'docs'));
 const run=(...args)=>spawnSync(process.execPath,[path.join(dir,'tools/build-agent-docs.mjs'),...args],{encoding:'utf8'});
 let r=run();assert.equal(r.status,0,r.stderr);
 const names=['agent-installation.md','agent-installation-reference.md'];
 for(const name of names)assert.ok(fs.existsSync(path.join(dir,'docs',name)),name);
 assert.equal(run('--check').status,0);
 for(const name of names){
  const file=path.join(dir,'docs',name),before=fs.readFileSync(file);
  fs.writeFileSync(file,'edited');assert.equal(run('--check').status,1);assert.equal(fs.readFileSync(file,'utf8'),'edited');
  fs.unlinkSync(file);assert.equal(run('--check').status,1);assert.equal(fs.existsSync(file),false);
  fs.writeFileSync(file,before);
 }
 assert.equal(run('--check').status,0);
});
