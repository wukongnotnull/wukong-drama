// The reviewed storyboard owns new shot prompts. Legacy prompts retain their task identity.
import fs from 'node:fs';
import path from 'node:path';

export const promptColumns={first_frame_prompt:'首帧提示词',transition_prompt:'过渡提示词',last_frame_prompt:'尾帧提示词'};
const filled=value=>typeof value==='string'&&value.trim()&&!['—','-'].includes(value.trim());
export function storyboardCells(line){
  const result=[];let cell='',escaped=false;
  for(const char of line.trim().replace(/^\||\|$/g,'')){
    if(escaped){cell+=char==='|'||char==='\\'?char:'\\'+char;escaped=false;}
    else if(char==='\\')escaped=true;
    else if(char==='|'){result.push(cell.trim());cell='';}
    else cell+=char;
  }
  result.push((cell+(escaped?'\\':'')).trim());
  return result.map(value=>value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/&(?:amp|lt|gt|quot|apos|#39|#124|vert);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#124;':'|','&vert;':'|'}[s])));
}
function tables(source){
  const result=[];let current=null,section='';
  for(const line of source.split(/\r?\n/)){
    if(/^#{2,3}\s/.test(line)){section=line;current=null;}
    if(!line.trim().startsWith('|')){current=null;continue;}
    if(/^\|[\s:|-]+\|$/.test(line.trim()))continue;
    const cells=storyboardCells(line);
    if(!current){current={header:cells,rows:[],sourceRows:[],section};result.push(current);}else {current.rows.push(cells);current.sourceRows.push(line);}
  }
  return result;
}
function shotRow(table,id,problems){
  const rows=table.rows.filter(row=>row[0]===id);
  if(rows.length!==1){problems.push(`${id} 分镜表必须有且只有一行`);return {};}
  if(rows[0].length!==table.header.length)problems.push(`${id} 分镜列数不符；单元格换行用 <br>，竖线写 \\|`);
  return Object.fromEntries(table.header.map((name,i)=>[name,rows[0][i]||'']));
}
export function storyboardPrompts(job,shot){
  if(job.imageStage)return null;
  const file=path.join(job.filmDir,'storyboard.md');
  if(!fs.existsSync(file))return null;
  const all=tables(fs.readFileSync(file,'utf8'));
  const main=all.find(table=>table.header[0]==='镜'&&!/副版重排/.test(table.section));
  if(!main||!Object.values(promptColumns).some(name=>main.header.includes(name)))return null;
  const problems=[];
  if(new Set(main.header).size!==main.header.length)problems.push('分镜表有重复栏目');
  const row=shotRow(main,shot.id,problems),fields={};
  for(const [key,name] of Object.entries(promptColumns)){
    fields[key]=row[name]||'';
    if(!filled(fields[key]))problems.push(`${shot.id} 请补齐${name}，静止镜头也要说明保持状态`);
  }
  let first=fields.first_frame_prompt,last=fields.last_frame_prompt;
  if(job.variant?.isMain===false){
    const aspect=job.variant.aspect.replace(':','\\s*[:：]\\s*');
    const variant=all.find(table=>table.header[0]==='镜'&&new RegExp(`副版重排.*${aspect}(?!\\d)`).test(table.section));
    const override=variant?shotRow(variant,shot.id,problems):{};
    for(const name of ['首帧提示词','尾帧提示词'])if(!filled(override[name]))problems.push(`${shot.id} 请在副版重排（${job.variant.aspect}）补齐${name}`);
    if(filled(override['过渡提示词'])&&override['过渡提示词']!==fields.transition_prompt)problems.push(`${shot.id} 副版须沿用主版过渡提示词`);
    first=override['首帧提示词']||first;last=override['尾帧提示词']||last;
  }
  const duration=/^(\d+(?:\.\d+)?)\s*(?:s|秒)$/i.exec(row['时长']||'');
  if(!duration)problems.push(`${shot.id} 时长须写成秒数，如 2s`);
  else if(Math.abs(Number(duration[1])-shot.duration)>1e-6)problems.push(`${shot.id} 分镜时长与 film.json 不一致`);
  const voice=filled(row['人声'])?row['人声']:'无人声，不加对白或旁白';
  const effects=filled(row['音效'])?row['音效']:'无额外动作音效';
  const start=shot.start??(job.film.shots||job.shots||[]).slice(0,(job.film.shots||job.shots||[]).findIndex(s=>s.id===shot.id)).reduce((sum,s)=>sum+s.duration,0);
  const seconds=value=>Math.round(value*1e6)/1e6;
  const localEffects=effects.replace(/(\d+(?:\.\d+)?)\s*(?:s|秒)/g,(_,value)=>`${seconds(Number(value)-start)}秒`);
  const soundTables=all.filter(table=>table.header[0]==='时间'&&table.header.includes('类别'));
  const bed=soundTables.flatMap(table=>table.rows.map(cells=>{
    const item=Object.fromEntries(table.header.map((name,i)=>[name,cells[i]||'']));
    const range=item['时间'].match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[–—~-]\s*(\d+(?:\.\d+)?)/);
    if(!filled(item['内容 / 情绪'])&&!filled(item['动作']))return null;
    if(range&&(Number(range[2])<=start||Number(range[1])>=start+shot.duration))return null;
    const description=cells.map((value,i)=>i===0&&range?`${seconds(Math.max(0,Number(range[1])-start))}–${seconds(Math.min(shot.duration,Number(range[2])-start))}秒`:value).join('；');
    return /BGM|配乐/i.test(item['类别'])&&/^(?:统一后期|后期统一)/.test(item['动作'])?'无背景音乐；配乐统一后期处理':description;
  }).filter(Boolean));
  const video=[`首帧：${first}`,`镜内过渡：${fields.transition_prompt}`,`尾帧目标：${last}`,
    `计划剪入${duration?.[1]||shot.duration}秒；动作在此镜时长内完成，余下源视频保持结束状态。尾帧为文字目标，剪辑后核对实际起止状态。`,
    `人声：${voice}`,`动作音效（镜内时间）：${localEffects}`,...bed.map(value=>'声音铺底：'+value),
    '保持已确认角色、服装、道具和空间关系稳定；只生成本镜，不自行切镜。'].join('\n');
  return {fields:{...fields,first_frame_prompt:first,last_frame_prompt:last},image:filled(first)?first:'',video,problems,soundRows:soundTables.flatMap(table=>table.sourceRows)};
}
export function requireStoryboardPrompts(job,shot,definition){
  if(job.imageStage)return;
  const prompts=storyboardPrompts(job,shot);
  if(!prompts)throw new Error(`${shot.id} 新生成前请补齐分镜三栏：首帧提示词、过渡提示词、尾帧提示词；旧素材和已提交任务可继续复用`);
  const problems=[...prompts.problems];
  if(definition.promptConflicts?.length)problems.push(`${shot.id} 旧 ${definition.promptConflicts.join('/')} 与分镜三栏不一致；请将要求写入分镜并移除旧重复提示词`);
  for(const [key,name] of Object.entries(promptColumns))if(definition[key]!==undefined&&definition[key]!==prompts.fields[key])problems.push(`${shot.id} ${name}（${key}）与已审分镜不一致，请同步或移除重复字段`);
  if(problems.length)throw new Error(problems.join('；'));
}
