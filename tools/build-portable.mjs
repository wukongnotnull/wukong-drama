#!/usr/bin/env node
// 源码构建允许 Git；发布后的安装器不依赖 Git。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectResources, assertResourcesUnchanged, LICENSE_FILES, buildOptions } from './lib/package-resources.mjs';
import { filesAt,sha,validateBundle } from './install-agent.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,value)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
// ZIP store：固定 DOS 时间、UTF-8 文件名、排序，无外部 zip 工具或平台元数据。
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(entries){const local=[],central=[];let offset=0;for(const [name,data] of entries){
 const n=Buffer.from(name),crc=crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);
 h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
 local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
export function build(out,{mode='release'}={}) {
 out=path.resolve(out);if(out===ROOT||!out.startsWith(ROOT+path.sep)&&out===path.parse(out).root)throw new Error('无效输出目录');
 if(out===path.join(ROOT,'plugin')||out.startsWith(path.join(ROOT,'plugin')+path.sep))throw new Error('构建输出不能位于plugin内');
 const resources=collectResources({root:ROOT,target:'portable',mode});
 const bundle=path.join(out,'wukong-drama');
 if(fs.existsSync(bundle))validateBundle(bundle);
 fs.mkdirSync(out,{recursive:true});
 const stage=fs.mkdtempSync(path.join(out,'.wukong-build-'));
 const work=path.join(stage,'wukong-drama');
 try {
 const required=resources.files;
 for(const source of required){
  const stat=fs.lstatSync(path.join(ROOT,source));if(!stat.isFile())throw new Error('运行资源必须是普通文件：'+source);
  let relative=source.slice('plugin/'.length).replace(/(^|\/)SKILL\.md$/,'$1INSTRUCTIONS.md');
  let data=fs.readFileSync(path.join(ROOT,source));
  // 仅转换已重命名的指令文件名 token，不改普通文字/脚本中的相似子串。
  if(source.endsWith('.md'))data=Buffer.from(data.toString('utf8').replace(/(?<![A-Za-z0-9_.-])SKILL\.md(?![A-Za-z0-9_.-])/g,'INSTRUCTIONS.md'));
  write(path.join(work,relative),data);
 }
 for(const name of ['SKILL.md'])write(path.join(work,name),fs.readFileSync(path.join(ROOT,'distribution/portable',name)));
 for(const [source,dest] of LICENSE_FILES)write(path.join(work,dest),fs.readFileSync(path.join(ROOT,source)));
 const pluginVersion=json(path.join(ROOT,'plugin/plugin.json')).version;
 const manifest={schemaVersion:1,pluginVersion,engineVersion:json(path.join(work,'engine/package.json')).version,sourceCommit:resources.sourceCommit,buildMode:mode,entry:'SKILL.md',files:filesAt(work).map(p=>({path:p,sha256:sha(path.join(work,p))}))};
 write(path.join(work,'bundle.json'),JSON.stringify(manifest,null,2)+'\n');validateBundle(work);
 // 只检查明确的文档路径，不把教学占位符当运行资源。
 for(const file of filesAt(work).filter(f=>f.endsWith('.md'))){
  const text=fs.readFileSync(path.join(work,file),'utf8');
  for(const m of text.matchAll(/\]\(([^)]+\.md)\)/g)){
   if(/^(https?:|<|#)/.test(m[1]))continue;
   const dest=path.resolve(work,path.dirname(file),m[1]);
   if(!dest.startsWith(work+path.sep)||!fs.existsSync(dest))throw new Error(`指令链接缺失：${file} → ${m[1]}`);
  }
 }
 for(const [source,dest] of [['tools/install-agent.mjs','install-agent.mjs'],['distribution/agents.json','agents.json']])write(path.join(stage,dest),fs.readFileSync(path.join(ROOT,source)));
 const name=`wukong-drama-agent-skills-v${pluginVersion}${mode==='development'?'-development':''}.zip`;
 const entries=[...filesAt(work).map(p=>['wukong-drama/'+p,fs.readFileSync(path.join(work,p))]),...['install-agent.mjs','agents.json'].map(p=>[p,fs.readFileSync(path.join(stage,p))])].sort((a,b)=>a[0].localeCompare(b[0],'en'));
 assertResourcesUnchanged(resources);
 write(path.join(stage,name),zip(entries));
 if(fs.existsSync(bundle))fs.rmSync(bundle,{recursive:true});
 fs.renameSync(work,bundle);
 for(const p of ['install-agent.mjs','agents.json',name])fs.renameSync(path.join(stage,p),path.join(out,p));write(path.join(out,'SHA256SUMS'),sha(path.join(out,name))+'  '+name+'\n');
 return {buildMode:mode,bundle,archive:path.join(out,name),files:manifest.files.length,version:pluginVersion,sourceCommit:manifest.sourceCommit};
 } finally {fs.rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))){
 try{const {out,mode}=buildOptions(process.argv.slice(2));console.log(JSON.stringify(build(out||path.join(ROOT,'dist'),{mode}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
