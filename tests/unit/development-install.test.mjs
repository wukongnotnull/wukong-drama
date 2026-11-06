import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {operate,sha,filesAt,validateBundle} from '../../tools/install-agent.mjs';
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-dev-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bundle=path.join(dir,'bundle'),project=path.join(dir,'project');fs.mkdirSync(project);
 for(const p of ['SKILL.md','engine/bin/wkd.mjs','engine/package.json','catalog.json','skills/director/INSTRUCTIONS.md']){const f=path.join(bundle,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'fixture');}
 const file=path.join(bundle,'bundle.json'),manifest={schemaVersion:1,entry:'SKILL.md',pluginVersion:'1.0.0',engineVersion:'1.0.0',sourceCommit:'1'.repeat(40),buildMode:'development'};
 const save=()=>{manifest.files=filesAt(bundle).filter(p=>p!=='bundle.json').map(p=>({path:p,sha256:sha(path.join(bundle,p))}));fs.writeFileSync(file,JSON.stringify(manifest));};save();
 return {dir,bundle,project,manifest,save,opt:{agent:'codex',scope:'project',project,bundle}};
}
test('development install and upgrade require explicit allowance before any write',t=>{
 const f=fixture(t),before=filesAt(f.dir);
 assert.throws(()=>operate('install',f.opt),/allow-development/);assert.deepEqual(filesAt(f.dir),before);
 assert.throws(()=>operate('install',{...f.opt,dryRun:true}),/allow-development/);
 const result=operate('install',{...f.opt,allowDevelopment:true});assert.equal(result.state,'current');
 assert.equal(operate('status',f.opt).resources,'verified');
 f.manifest.buildMode='release';f.save();assert.throws(()=>operate('install',f.opt),/构建模式不同/);f.manifest.buildMode='development';f.save();
 f.manifest.pluginVersion='1.0.1';f.save();const receipt=fs.readFileSync(path.join(result.target,'.wukong-install.json'));
 assert.throws(()=>operate('upgrade',f.opt),/allow-development/);assert.deepEqual(fs.readFileSync(path.join(result.target,'.wukong-install.json')),receipt);
 operate('upgrade',{...f.opt,allowDevelopment:true});fs.appendFileSync(path.join(f.bundle,'SKILL.md'),'change');f.save();
 assert.throws(()=>operate('upgrade',{...f.opt,allowDevelopment:true}),/相同版本内容不同/);
 assert.equal(operate('uninstall',f.opt).state,'missing');
});
test('development CLI allowance is parsed, invalid markers reject, unmarked packages are rejected before writes',t=>{
 const f=fixture(t);const script=new URL('../../tools/install-agent.mjs',import.meta.url);
 const r=spawnSync(process.execPath,[script.pathname,'install','--agent','codex','--scope','project','--project',f.project,'--bundle',f.bundle,'--allow-development','--dry-run','--json'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).dryRun,true);
 f.manifest.buildMode='invalid';f.save();assert.throws(()=>validateBundle(f.bundle),/buildMode|构建模式/);
 delete f.manifest.buildMode;f.save();const before=filesAt(f.dir);assert.throws(()=>operate('install',f.opt),/buildMode|构建模式/);assert.deepEqual(filesAt(f.dir),before);
});
