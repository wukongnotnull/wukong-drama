// Durable approval and conservative reservations. This controls submissions, not provider billing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { atomicJson } from '../core/evidence.mjs';

export function strictJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error(`生成记录损坏，已停止自动调用：${file}`); }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
export function generationLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomUUID(), guard = file + '.recover';
  const acquire = () => {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), token })); }
    finally { fs.closeSync(fd); }
  };
  if (fs.existsSync(guard)) throw new Error('生成任务锁正在恢复，请稍后再试');
  try { acquire(); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { fs.mkdirSync(guard); } catch { throw new Error('生成任务锁正在恢复，请稍后再试'); }
    try {
      const old = strictJson(file);
      if (!old?.token || old.host !== os.hostname() || !Number.isInteger(old.pid) || old.pid <= 0 || alive(old.pid)) throw new Error('生成任务正在执行，或锁所有者无法核实');
      fs.rmSync(file); acquire();
    } finally { fs.rmdirSync(guard); }
  }
  return () => { if (strictJson(file)?.token === token) fs.rmSync(file, { force: true }); };
}

const ledgerFile = dir => path.join(dir, '.wkd/generation-ledger.json');
const approvalsFile = dir => path.join(dir, '.wkd/generation-approvals.json');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function reservations(dir) {
  const data = strictJson(ledgerFile(dir), { version: 1, entries: {} });
  if (data.version !== 1 || !object(data.entries) || Object.values(data.entries).some(x => !['image','video'].includes(x.kind) || !Number.isFinite(x.estimatedCost) || x.estimatedCost < 0)) throw new Error('生成预算记录无效，已停止自动调用');
  return data;
}
function approvals(dir) {
  const data = strictJson(approvalsFile(dir), { version: 1, batches: {} });
  if (data.version !== 1 || !object(data.batches)) throw new Error('生成授权记录无效');
  return data;
}
export function budgetSummary(job, kind, items) {
  const entries = Object.values(reservations(job.filmDir).entries).filter(x => x.kind === kind);
  const budget = job.film.generation?.budget || {};
  const currency = kind === 'image' ? 'USD' : 'CNY';
  const limit = budget[kind === 'image' ? 'image_usd' : 'video_cny'];
  const maxTasks = budget[kind === 'image' ? 'max_image_tasks' : 'max_video_tasks'];
  const pending = items.filter(x => x.status === 'new');
  const reservedCost = entries.reduce((sum, x) => sum + x.estimatedCost, 0);
  const problems = [];
  if (pending.length && (!Number.isFinite(limit) || limit < 0)) problems.push(`${currency} 预算未设置`);
  if (pending.length && (!Number.isInteger(maxTasks) || maxTasks < 0)) problems.push(`${kind} 任务上限未设置`);
  if (pending.some(x => !Number.isFinite(x.estimatedCost) || x.estimatedCost < 0)) problems.push('缺少已核实的每请求费用估算上界');
  const estimatedCost = pending.reduce((sum, x) => sum + (Number.isFinite(x.estimatedCost) ? x.estimatedCost : 0), 0);
  if (pending.length && reservedCost + estimatedCost > limit + 1e-9) problems.push(`${currency} 累计估算超过预算`);
  if (pending.length && entries.length + pending.length > maxTasks) problems.push(`${kind} 累计任务上限已达到`);
  return { currency, estimatedCost, reservedCost, limit: limit ?? null, maxTasks: maxTasks ?? null, reservedTasks: entries.length, newTasks: pending.length, problems };
}
export function saveApproval(job, plan, source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('生成授权需要用户明确同意的来源 --source');
  if (!plan.allowed) throw new Error(plan.problems.join('；'));
  const unlock = generationLock(path.join(job.filmDir, '.wkd/generation-ledger.lock'));
  try {
    const data = approvals(job.filmDir);
    const approval = { signature: plan.signature, kind: plan.kind, source: source.trim(), approvedAt: new Date().toISOString(), items: plan.items.map(x => ({ shot: x.shot, signature: x.signature })), budget: plan.budget };
    data.batches[plan.signature] = approval;
    atomicJson(approvalsFile(job.filmDir), data);
    return approval;
  } finally { unlock(); }
}
export function requireGenerationApproval(job,plan,item) {
  const approved=approvals(job.filmDir).batches[plan.signature];
  if(!approved?.source||!approved.items?.some(x=>x.signature===item.signature))throw new Error('缺少与当前输入一致的生成授权；请先选择并批准本批生图方式');
  return approved;
}
export function reserveRequest(job, plan, item) {
  const unlock = generationLock(path.join(job.filmDir, '.wkd/generation-ledger.lock'));
  try {
    const data = reservations(job.filmDir);
    if (data.entries[item.signature]) throw new Error('本请求已占用生成额度但缺少可恢复状态；请核对任务记录，不要自动重复提交');
    const current = budgetSummary(job, plan.kind, plan.items);
    if (current.problems.length) throw new Error(current.problems.join('；'));
    const approved = approvals(job.filmDir).batches[plan.signature];
    if (!approved?.source || !approved.items?.some(x => x.signature === item.signature)) throw new Error('缺少与当前输入一致的生成授权；先查看 generation-plan，再记录 generation-approve');
    data.entries[item.signature] = { kind: plan.kind, estimatedCost: item.estimatedCost, currency: current.currency, shot: item.shot, aspect: plan.aspect, approval: plan.signature, reservedAt: new Date().toISOString(), status: 'reserved' };
    atomicJson(ledgerFile(job.filmDir), data);
  } finally { unlock(); }
}
export function finishReservation(dir, signature, status, usage) {
  const unlock = generationLock(path.join(dir, '.wkd/generation-ledger.lock'));
  try {
    const data = reservations(dir), item = data.entries[signature];
    if (item) { item.status = status; if (usage) item.usage = usage; atomicJson(ledgerFile(dir), data); }
  } finally { unlock(); }
}
