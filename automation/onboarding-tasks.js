'use strict';

const crypto = require('crypto');
const path = require('path');
const { enqueueRun, listProfiles, profilePaths, readJson, readProfile, writeJsonAtomic } = require('./collector-core');

const TASKS_FILE = 'onboarding-tasks.json';
const VALID_MODES = new Set(['vertical', 'horizontal', 'collection_update']);
const VALID_EXECUTION_TYPES = new Set(['immediate', 'once', 'daily', 'weekly']);

function nowIso(clock = () => new Date()) { return clock().toISOString(); }
function taskFile(dataDir) { return path.join(dataDir, TASKS_FILE); }
function queueFile(dataDir) { return path.join(dataDir, 'automation', 'queue.json'); }
function readTasks(dataDir) { return readJson(taskFile(dataDir), []); }
function writeTasks(dataDir, tasks) { writeJsonAtomic(taskFile(dataDir), tasks.slice(0, 500)); }
function text(value, label, min = 1, max = 240) {
  const normalized = String(value || '').trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label}长度必须为 ${min}–${max} 个字符。`);
  return normalized;
}
function uniqueStrings(value, label, max = 100) {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`);
  const items = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  if (!items.length || items.length > max) throw new Error(`${label}必须包含 1–${max} 项。`);
  return items;
}
function localScheduleDate(hour, minute, base = new Date(), weekday = null) {
  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (weekday === null) {
    if (next <= base) next.setDate(next.getDate() + 1);
    return next;
  }
  let offset = (weekday - next.getDay() + 7) % 7;
  if (offset === 0 && next <= base) offset = 7;
  next.setDate(next.getDate() + offset);
  return next;
}
function normalizeExecution(raw = {}, clock = () => new Date()) {
  const type = VALID_EXECUTION_TYPES.has(String(raw.type)) ? String(raw.type) : 'immediate';
  if (type === 'immediate') return { type, timezone: 'local', nextRunAt: nowIso(clock) };
  if (type === 'once') {
    const runAt = new Date(String(raw.runAt || ''));
    if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= clock().getTime()) throw new Error('一次预约时间必须晚于当前时间。');
    return { type, timezone: 'local', runAt: runAt.toISOString(), nextRunAt: runAt.toISOString() };
  }
  const hour = Number(raw.hour);
  const minute = Number(raw.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('执行小时必须为 0–23。');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('执行分钟必须为 0–59。');
  if (type === 'daily') return { type, hour, minute, timezone: 'local', nextRunAt: localScheduleDate(hour, minute, clock()).toISOString() };
  const weekday = Number(raw.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('每周执行日必须为 0–6。');
  return { type, weekday, hour, minute, timezone: 'local', nextRunAt: localScheduleDate(hour, minute, clock(), weekday).toISOString() };
}
function nextRecurringRun(execution, base) {
  if (execution.type === 'daily') return localScheduleDate(execution.hour, execution.minute, base).toISOString();
  if (execution.type === 'weekly') return localScheduleDate(execution.hour, execution.minute, base, execution.weekday).toISOString();
  return '';
}
function readinessForProfiles(profiles) {
  const blocked = profiles.filter((profile) => profile.approvalStatus !== 'approved' || !profile.enabled);
  return { ready: blocked.length === 0, blockedProfileIds: blocked.map((profile) => profile.profileId) };
}
function taskStatus(task, dataDir) {
  if (task.status === 'paused') return 'paused';
  const profiles = listProfiles(dataDir).filter((profile) => task.profileIds.includes(profile.profileId));
  if (!readinessForProfiles(profiles).ready) return 'blocked';
  const queue = readJson(queueFile(dataDir), { items: [] }).items || [];
  const requests = queue.filter((item) => (task.requestIds || []).includes(item.id));
  if (requests.some((item) => item.status === 'claimed')) return 'collecting';
  if (requests.some((item) => item.status === 'queued')) return 'queued';
  if (requests.some((item) => item.status === 'failed')) return 'review_required';
  if (requests.length && requests.every((item) => item.status === 'completed')) return 'analysis_pending';
  if (['once', 'daily', 'weekly'].includes(task.execution?.type) && task.execution?.nextRunAt) return 'scheduled';
  return task.status || 'draft';
}
function productsForTask(task, dataDir) {
  return task.profileIds.flatMap((profileId) => {
    const profile = readProfile(dataDir, profileId);
    return (profile.sources || []).flatMap((source) => {
      const modelNames = Array.isArray(source.modelNames) && source.modelNames.length ? source.modelNames : [source.series];
      return modelNames.map((modelName) => ({
      vendorId: profile.vendorId,
      vendorName: profile.vendorName || profile.vendorId,
      productLine: profile.productLine?.name || profile.productLinePath?.[1] || '未分类',
      subseries: profile.subseries?.name || profile.displayName || '',
      series: source.series,
      modelName,
      productPageUrl: source.productPageUrl || '',
      materialPageUrl: source.materialPageUrl || '',
      pdfUrl: source.pdfUrl,
      officialFileName: source.officialFileName,
      evidencePolicy: source.evidencePolicy || profile.evidencePolicy || 'official_datasheet',
      }));
    });
  });
}
function taskDetail(task, dataDir, intelligence) {
  const profiles = listProfiles(dataDir).filter((profile) => task.profileIds.includes(profile.profileId));
  const queue = readJson(queueFile(dataDir), { items: [] }).items || [];
  const requests = queue.filter((item) => (task.requestIds || []).includes(item.id));
  const fieldScope = task.researchTaskId ? intelligence.fieldScopeSummary(task.researchTaskId) : { active: null, pending: null, versions: [] };
  return {
    ...task,
    status: taskStatus(task, dataDir),
    profiles,
    requests,
    readiness: readinessForProfiles(profiles),
    products: productsForTask(task, dataDir),
    fieldScope,
  };
}
function queueTaskProfiles(dataDir, task, requestedBy = 'local-admin') {
  const profiles = listProfiles(dataDir).filter((profile) => task.profileIds.includes(profile.profileId));
  const readiness = readinessForProfiles(profiles);
  if (!readiness.ready) throw new Error(`以下来源尚未批准或已禁用：${readiness.blockedProfileIds.join(', ')}`);
  const requests = profiles.map((profile) => enqueueRun(dataDir, profile.profileId, requestedBy, { onboardingTaskId: task.taskId }));
  task.requestIds = [...new Set([...(task.requestIds || []), ...requests.map((item) => item.id)])];
  task.lastTriggeredAt = new Date().toISOString();
  task.status = 'queued';
  return requests;
}
function createOnboardingTask({ dataDir, input, intelligence, actor = 'local-admin', clock = () => new Date() }) {
  const title = text(input.title, '任务名称', 2, 120);
  const decisionQuestion = text(input.decisionQuestion, '决策问题', 5, 1000);
  const mode = VALID_MODES.has(String(input.mode)) ? String(input.mode) : 'vertical';
  const profileIds = uniqueStrings(input.profileIds, '来源配置', 50);
  const available = listProfiles(dataDir);
  const profiles = available.filter((profile) => profileIds.includes(profile.profileId));
  if (profiles.length !== profileIds.length) throw new Error('部分来源配置不存在，请刷新后重新选择。');
  const vendorIds = [...new Set(profiles.map((profile) => profile.vendorId))];
  if (mode === 'horizontal' && vendorIds.length < 2) throw new Error('横向分析至少需要选择两个厂商。');
  const execution = normalizeExecution(input.execution, clock);
  const templateId = text(input.analysis?.templateId, '技术字段模板', 2, 128);
  const selectedFieldCodes = uniqueStrings(input.analysis?.selectedFieldCodes, '技术字段', 100);
  const rationale = text(input.analysis?.rationale || `围绕“${decisionQuestion}”建立本轮关键参数范围；缺失字段保留未披露或待复核。`, '字段范围说明', 3, 2000);
  const createdAt = nowIso(clock);
  const taskId = `onboarding_${crypto.randomUUID().slice(0, 8)}`;
  const researchTask = intelligence.upsertResearchTask({
    title,
    mode: mode === 'collection_update' ? 'vertical' : mode,
    decisionQuestion,
    scope: {
      source: 'onboarding_wizard', onboardingTaskId: taskId, vendorIds, profileIds,
      productLines: [...new Set(profiles.map((profile) => profile.productLine?.name || '未分类'))],
      evidencePolicy: 'official-first', uncertaintyPolicy: ['官方明确说明', '基于官方资料推导', '未披露', '待验证'],
    },
    owner: actor,
    status: 'draft',
    priority: String(input.priority || 'medium'),
    baselineDescriptor: { profileIds, createdFrom: 'onboarding_wizard' },
  });
  const fieldPack = intelligence.createTaskFieldPack({ taskId: researchTask.task_id, templateId, selectedFieldCodes, rationale, actor });
  const readiness = readinessForProfiles(profiles);
  const task = {
    schemaVersion: '1.0', taskId, title, decisionQuestion, mode, priority: String(input.priority || 'medium'),
    vendorIds, profileIds, execution, analysis: { templateId, selectedFieldCodes, rationale },
    status: readiness.ready ? (execution.type === 'immediate' ? 'queued' : 'scheduled') : 'blocked',
    blockedProfileIds: readiness.blockedProfileIds, requestIds: [], researchTaskId: researchTask.task_id,
    fieldPackId: fieldPack.createdPackId, createdBy: actor, createdAt, updatedAt: createdAt, lastTriggeredAt: '',
  };
  if (readiness.ready && execution.type === 'immediate') queueTaskProfiles(dataDir, task, actor);
  const tasks = readTasks(dataDir);
  tasks.unshift(task);
  writeTasks(dataDir, tasks);
  return taskDetail(task, dataDir, intelligence);
}
function listOnboardingTasks(dataDir, intelligence) {
  return readTasks(dataDir).map((task) => taskDetail(task, dataDir, intelligence));
}
function getOnboardingTask(dataDir, taskId, intelligence) {
  const task = readTasks(dataDir).find((item) => item.taskId === taskId);
  return task ? taskDetail(task, dataDir, intelligence) : null;
}
function runOnboardingTaskNow(dataDir, taskId, intelligence, actor = 'local-admin') {
  const tasks = readTasks(dataDir);
  const task = tasks.find((item) => item.taskId === taskId);
  if (!task) throw new Error('未找到新手任务。');
  const requests = queueTaskProfiles(dataDir, task, actor);
  task.updatedAt = new Date().toISOString();
  writeTasks(dataDir, tasks);
  return { task: taskDetail(task, dataDir, intelligence), requests };
}
function pauseOnboardingTask(dataDir, taskId, intelligence) {
  const tasks = readTasks(dataDir);
  const task = tasks.find((item) => item.taskId === taskId);
  if (!task) throw new Error('未找到新手任务。');
  task.status = task.status === 'paused' ? 'scheduled' : 'paused';
  task.updatedAt = new Date().toISOString();
  writeTasks(dataDir, tasks);
  return taskDetail(task, dataDir, intelligence);
}
function queueDueOnboardingTasks(dataDir, clock = () => new Date()) {
  const tasks = readTasks(dataDir);
  const now = clock();
  const queued = [];
  let changed = false;
  for (const task of tasks) {
    if (task.status === 'paused' || task.execution?.type === 'immediate' || !task.execution?.nextRunAt) continue;
    if (task.execution.type === 'once' && task.lastTriggeredAt) continue;
    const currentStatus = taskStatus(task, dataDir);
    if (currentStatus === 'queued' || currentStatus === 'collecting') continue;
    if (Date.parse(task.execution.nextRunAt) > now.getTime()) continue;
    const profiles = listProfiles(dataDir).filter((profile) => task.profileIds.includes(profile.profileId));
    const readiness = readinessForProfiles(profiles);
    if (!readiness.ready) {
      task.status = 'blocked'; task.blockedProfileIds = readiness.blockedProfileIds; task.updatedAt = now.toISOString(); changed = true; continue;
    }
    const requests = queueTaskProfiles(dataDir, task, 'scheduled-onboarding');
    queued.push({ taskId: task.taskId, requestIds: requests.map((item) => item.id) });
    task.execution.nextRunAt = task.execution.type === 'once' ? '' : nextRecurringRun(task.execution, now);
    task.updatedAt = now.toISOString();
    changed = true;
  }
  if (changed) writeTasks(dataDir, tasks);
  return queued;
}

module.exports = {
  createOnboardingTask, getOnboardingTask, listOnboardingTasks, pauseOnboardingTask,
  queueDueOnboardingTasks, runOnboardingTaskNow, taskStatus,
};
