// Normalize persistent model videos into the existing editing timeline.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureImage, ensureVideo, generationEvidence, nativeAudioPath } from '../../generation/generation.mjs';
import { run, hasFfmpeg } from '../../core/ffmpeg.mjs';
import { fileDigest, atomicJson } from '../../core/evidence.mjs';
import { strictJson } from '../../generation/generation-budget.mjs';

export async function check() {
  const missing = [];
  if (!hasFfmpeg()) missing.push('ffmpeg');
  if (spawnSync('ffprobe',['-version'],{stdio:'ignore'}).status !== 0) missing.push('ffprobe');
  return {ok:missing.length === 0,missing,hint:'模型生成需要本机环境变量与批次授权；导入已有素材只需 ffmpeg/ffprobe。'};
}
function probe(file) {
  const result = spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',maxBuffer:4*1024*1024});
  if (result.status !== 0) throw new Error('无法读取模型源素材，请检查下载是否完整');
  try { return JSON.parse(result.stdout); } catch { throw new Error('ffprobe 返回了无效素材信息'); }
}
function frameFilter(job) {
  if (![job.W,job.H,job.fps].every(n => Number.isFinite(n) && n > 0)) throw new Error('输出画幅和帧率必须为正数');
  return `scale=${job.W}:${job.H}:force_original_aspect_ratio=decrease,pad=${job.W}:${job.H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}
function sourceProfile(info) {
  const video = info.streams.find(s => s.codec_type === 'video');
  if (!video || !video.width || !video.height) throw new Error('源文件没有可用视频画面');
  const [numerator,denominator = 1] = String(video.avg_frame_rate || video.r_frame_rate || '0').split('/').map(Number);
  const fps = numerator/denominator;
  return {width:video.width,height:video.height,duration:Number(video.duration || info.format?.duration),fps:Number.isFinite(fps) && fps > 0 ? fps : null,audio:info.streams.some(s => s.codec_type === 'audio'),codec:video.codec_name || null};
}
export function validateSourceVideo(job, shot, source, {generated = false, info = probe(source)} = {}) {
  const profile = sourceProfile(info);
  const wanted = shot.frames/job.fps;
  if (!Number.isFinite(profile.duration) || profile.duration < wanted - 0.5/job.fps) throw new Error(`${shot.id} 源视频时长不足（需要 ${wanted.toFixed(3)} 秒），请调整剪辑时长或另行授权重新生成`);
  const resolution = job.film.generation?.video?.resolution || '720p';
  const minimum = resolution === '4k' ? 2160 : Number(resolution.replace(/p$/,''));
  if (generated && Number.isFinite(minimum) && Math.min(profile.width,profile.height) < minimum) throw new Error(`${shot.id} 模型源视频未达到约定原生 ${resolution}（实际 ${profile.width}×${profile.height}），保留源素材等待审阅，不会放大冒充或自动重生`);
  return profile;
}
async function preserveAudio(job, shot, source, info) {
  if (job.film.generation?.video?.generate_audio === false) return;
  if (!info.streams.some(s => s.codec_type === 'audio')) throw new Error(`${shot.id} 要求模型原生声音，但源视频没有音轨`);
  const output = nativeAudioPath(job,shot,source), record = output + '.json';
  let old;
  try { old = strictJson(record); } catch { /* Derived audio evidence can be rebuilt from the immutable source. */ }
  if (old?.source === fileDigest(source) && fs.existsSync(output) && old.output === fileDigest(output)) return;
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const part = output + '.part.wav';
  try {
    // Preserve the full source audio. The mixer trims each placement to its shot duration.
    await run(['-i',source,'-map','0:a:0','-vn','-c:a','pcm_s16le','-ar','48000','-ac','2',part]);
    fs.renameSync(part,output);
    atomicJson(record,{version:1,source:fileDigest(source),output:fileDigest(output)});
  } finally { fs.rmSync(part,{force:true}); }
}
export async function renderShots(job, todo, {onDone} = {}) {
  const resize = frameFilter(job);
  for (const item of todo) {
    const {shot,out} = item;
    if (!Number.isInteger(shot.frames) || shot.frames < 1) throw new Error('镜头必须有正整数目标帧数');
    const source = await ensureVideo(job,shot), info = probe(source);
    const generated = !generationEvidence(job,shot).imported.video;
    if (generated) atomicJson(source+'.technical.json',{version:1,source:fileDigest(source),...sourceProfile(info),requestedResolution:job.film.generation.video.resolution || '720p'});
    validateSourceVideo(job,shot,source,{generated,info});
    fs.mkdirSync(path.dirname(out),{recursive:true});
    const part = out + '.part.mp4';
    try {
      await run(['-i',source,'-map','0:v:0','-an','-vf',`${resize},fps=${job.fps},trim=end_frame=${shot.frames},setpts=PTS-STARTPTS`,'-frames:v',String(shot.frames),'-c:v','libx264','-preset','fast','-crf',job.proxy ? '23' : '16','-pix_fmt','yuv420p','-r',String(job.fps),'-movflags','+faststart',part]);
      await preserveAudio(job,shot,source,info);
      fs.renameSync(part,out);
      await onDone?.(item);
      job.log?.(`  ${shot.id} 已从持久模型素材转码；原始图片、视频与任务记录保留`);
    } finally { fs.rmSync(part,{force:true}); }
  }
}
export async function renderStills(job, points, outDir) {
  const resize = frameFilter(job), files = [];
  const selectedIds=new Set(points.map(p=>p.shot));
  const selectedJob={...job,generationShots:job.shots.filter(s=>selectedIds.has(s.id))};
  fs.mkdirSync(outDir,{recursive:true});
  for (const point of points) {
    const shot = job.shots.find(s => s.id === point.shot);
    if (!shot) throw new Error(`没有镜头 ${point.shot}`);
    if (!Number.isFinite(point.t) || point.t < 0) throw new Error('静帧时间必须为非负数');
    const selected = generationEvidence(job,shot);
    const video = selected.video?.file;
    const source = video ? await ensureVideo(selectedJob,shot) : await ensureImage(selectedJob,shot);
    const t = Math.min(point.t,Math.max(0,shot.duration-1/job.fps));
    const output = path.join(outDir,`${shot.id}-${t.toFixed(2)}s.png`), part = output + '.part.png';
    try {
      await run([...(video ? ['-ss',String(t)] : []),'-i',source,'-vf',resize,'-frames:v','1',part]);
      if (!fs.existsSync(part) || !fs.statSync(part).size) throw new Error('源素材没有所请求的静帧');
      fs.renameSync(part,output); files.push(output);
    } finally { fs.rmSync(part,{force:true}); }
  }
  return files;
}
