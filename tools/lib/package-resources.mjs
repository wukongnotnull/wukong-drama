// Build-time policy only. The distributed installer remains standalone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const LICENSE_FILES=[['LICENSE','LICENSE'],['LICENSE-MEDIA','LICENSE-MEDIA'],['docs/UPSTREAM.md','UPSTREAM.md']];
const excluded=new Set(['node_modules','.cache','.wkd','.git','outputs','output','review','stills','tmp','dist','__pycache__','generated']);
const extensions=new Set(['.mjs','.cjs','.js','.jsx','.ts','.tsx','.json','.md','.yaml','.yml','.py','.txt','.html','.css','.svg','.png','.jpg','.jpeg','.webp','.woff','.woff2','.ttf','.otf','.srt']);
const sensitive=p=>/^(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$))/i.test(p);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
function eligible(file,target){
 if(file.split('/').some(p=>excluded.has(p)||sensitive(p)))return false;
 const ext=path.posix.extname(file).toLowerCase();
 const media=file.startsWith('plugin/skills/cinematic/examples/stealing-kitten/media/')&&['.mp4','.wav'].includes(ext);
 if(!extensions.has(ext)&&!media)return false;
 return target==='native'?/^plugin\/(engine\/|skills\/|commands\/|assets\/|(?:\.codex-plugin\/|\.claude-plugin\/)?plugin\.json$|catalog\.json$)/.test(file):/^plugin\/(engine\/|skills\/|catalog\.json$)/.test(file);
}
export function collectResources({root,target,mode='release'}){
 root=path.resolve(root);
 if(!['native','portable'].includes(target)||!['release','development'].includes(mode))throw new Error('未知打包目标或构建模式');
 const sourceCommit=git(root,['rev-parse','--verify','HEAD']).trim();
 const tracked=git(root,['ls-files','-z','--cached',...(mode==='development'?['--others','--exclude-standard']:[]),'--','plugin','tools','distribution','.gitignore',...LICENSE_FILES.map(([p])=>p)]).split('\0').filter(Boolean);
 const files=[...new Set(tracked.filter(p=>eligible(p,target)))].sort();
 if(!files.length)throw new Error('缺少运行资源');
 const inputs=[...new Set([...files,...tracked.filter(p=>p.startsWith('tools/')||p.startsWith('distribution/')||p==='plugin/plugin.json'||p==='.gitignore'),...LICENSE_FILES.map(([p])=>p)])].sort();
 if(mode==='release'){
  try{git(root,['diff','--quiet','HEAD','--',...inputs]);}catch{throw new Error('正式包输入存在未提交修改；请提交后构建，或显式使用 --development');}
 }
 const hashes=inputs.map(file=>{
  const full=path.join(root,file);
  if(!fs.lstatSync(full).isFile())throw new Error('打包资源必须是普通文件：'+file);
  return [file,hash(fs.readFileSync(full))];
 });
 return {root,target,buildMode:mode,sourceCommit,files,hashes};
}
export function assertResourcesUnchanged(plan){
 const now=collectResources({root:plan.root,target:plan.target,mode:plan.buildMode});
 if(now.sourceCommit!==plan.sourceCommit||JSON.stringify(now.hashes)!==JSON.stringify(plan.hashes))throw new Error('构建输入在读取期间发生变化，已停止输出');
}
export function buildOptions(args){
 let out,mode='release';
 for(let i=0;i<args.length;i++){
  if(args[i]==='--development')mode='development';
  else if(args[i]==='--out'&&args[i+1]&&!args[i+1].startsWith('--'))out=args[++i];
  else throw new Error('用法：构建器 [--out 目录] [--development]');
 }
 return {out,mode};
}
