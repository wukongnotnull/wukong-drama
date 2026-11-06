import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../../plugin/engine/cli/run.mjs';
import { commandsFor } from '../../plugin/engine/cli/commands.mjs';
import { approveEmptySettings } from '../helpers/settings.mjs';

test('generation CLI plans without paying and rejects unpriced approvals',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-gen-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=[],errors=[],io={log:x=>out.push(x),error:x=>errors.push(x)};
 assert.equal(await runCli(['init','demo','--dir',root],io),0);
 const dir=path.join(root,'films/demo');out.length=0;
 approveEmptySettings(dir);
 assert.equal(await runCli(['generation-plan',dir,'--kind','video'],io),2);
 const plan=JSON.parse(out[0]);assert.equal(plan.kind,'video');assert.equal(plan.allowed,false);
 assert.equal(await runCli(['generation-approve',dir,'--kind','video','--signature',plan.signature,'--source','user approved'],io),1);
 assert.ok(!fs.existsSync(path.join(dir,'.wkd/generation-ledger.json')));
 assert.ok(!fs.existsSync(path.join(dir,'assets/generated')));
});
test('series CLI preserves source attribution and keeps drafts outside canon',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-series-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=[],io={log:x=>out.push(x),error:x=>out.push(x)};
 assert.equal(await runCli(['series-init',root,'--name','Cat and Mouse','--entry','script'],io),0,out.join('\n'));
 assert.equal(await runCli(['series',root],io),0);
 const file=path.join(root,'draft.json');fs.writeFileSync(file,JSON.stringify({episodeId:'ep01',title:'test',events:['sponge reveal']}));
 assert.equal(await runCli(['series-update',root,'--action','draft','--file',file],io),0,out.join('\n'));
 assert.equal(await runCli(['series-update',root,'--action','confirm-episode','--file',file],io),1);
});
test('new command write policies preserve locks and read-only plan behavior',()=>{
 const c=commandsFor({pos:[],opt:(_,d)=>d,log(){}});
 for(const name of ['generation-approve','series-init','series-update'])assert.equal(c[name].lock,'film');
 for(const name of ['generation-plan','series'])assert.equal(c[name].lock,'none');
});

test('video CLI approval requires the exact displayed plan signature',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wkd-video-approve-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=[],errors=[],io={log:x=>out.push(x),error:x=>errors.push(x)};
 assert.equal(await runCli(['init','demo','--dir',root],io),0);
 const dir=path.join(root,'films/demo');approveEmptySettings(dir);
 const filmFile=path.join(dir,'film.json'),film=JSON.parse(fs.readFileSync(filmFile));
 film.generation.video={generate_audio:false,provider:'seedance',model:'video-test',estimated_cost_cny:1};
 film.generation.budget={video_cny:100,max_video_tasks:20};
 fs.writeFileSync(filmFile,JSON.stringify(film));
 fs.writeFileSync(path.join(dir,'ref.png'),'imported reference');
 for(const shot of film.shots)fs.writeFileSync(path.join(dir,shot.file),JSON.stringify({image:'ref.png',video_prompt:'猫抬头'}));
 assert.equal(await runCli(['generation-approve',dir,'--kind','video','--source','start batch'],io),1);
 assert.match(errors.at(-1),/signature/);
 assert.ok(!fs.existsSync(path.join(dir,'.wkd/generation-approvals.json')));
 out.length=0;
 assert.equal(await runCli(['generation-plan',dir,'--kind','video'],io),0,errors.join('\n'));
 const plan=JSON.parse(out[0]);
 assert.equal(await runCli(['generation-approve',dir,'--kind','video','--signature','outdated','--source','start batch'],io),1);
 assert.ok(!fs.existsSync(path.join(dir,'.wkd/generation-approvals.json')));
 assert.equal(await runCli(['generation-approve',dir,'--kind','video','--signature',plan.signature,'--source','start batch'],io),0,errors.join('\n'));
});
