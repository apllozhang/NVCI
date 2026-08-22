#!/usr/bin/env node
'use strict';

/*
 * Deterministic NVCI public-document collector.
 * It only executes pre-approved source profiles; it never discovers URLs,
 * calls an LLM, or turns missing metadata into inferred product facts.
 */
const fs = require('fs');
const path = require('path');
const { ensureBundledProfiles, enqueueRun, executeProfile, listProfiles, readJson } = require('./collector-core');

function usage(exitCode = 0) {
  const text = `
NVCI 无模型公开资料采集器

用法：
  node automation/collection-cli.js --data-dir <目录> [选择器] (--dry-run | --queue | --run) [选项]

选择器（至少指定一项）：
  --profile <profileId>       可重复，精确选择已批准来源配置
  --vendor <vendorId>         可重复，按厂商选择来源配置
  --product-line <名称或ID>    可重复，按产品线选择来源配置
  --subseries <名称或ID>       可重复，按子系列选择来源配置
  --all-approved              选择所有已批准且启用的来源配置
  --task-file <任务JSON>       读取 { profileIds: [], force?: boolean }，用于脱离 UI 的任务复用

执行方式（四选一）：
  --dry-run                   只输出可执行范围和资料资产预览，不发起网络请求
  --queue                     将来源写入 NAS 后台采集队列，浏览器关闭后仍可执行
  --run                       在当前进程按顺序执行增量采集
  --force                     仅与 --run 配合，忽略 HTTP 元数据复用并重新验证下载

输出：
  每次运行输出 JSON：范围、请求/快照 ID、PDF 数、SHA-256、manifest、五列表、更新摘要、失败原因。
  --format text               以便于终端阅读的摘要输出；默认 JSON。
`;
  process[exitCode ? 'stderr' : 'stdout'].write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = { profiles: [], vendors: [], productLines: [], subseries: [], format: 'json', dryRun: false, queue: false, run: false, allApproved: false, force: false, taskFile: '', dataDir: process.env.NVCI_DATA_DIR || '/data' };
  const valueFlags = new Map([
    ['--data-dir', 'dataDir'], ['--profile', 'profiles'], ['--vendor', 'vendors'], ['--product-line', 'productLines'],
    ['--subseries', 'subseries'], ['--task-file', 'taskFile'], ['--format', 'format'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') usage();
    if (token === '--dry-run') { options.dryRun = true; continue; }
    if (token === '--queue') { options.queue = true; continue; }
    if (token === '--run') { options.run = true; continue; }
    if (token === '--all-approved') { options.allApproved = true; continue; }
    if (token === '--force') { options.force = true; continue; }
    const key = valueFlags.get(token);
    if (!key) throw new Error(`未知参数：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} 需要一个值。`);
    index += 1;
    if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = value;
  }
  if (!['json', 'text'].includes(options.format)) throw new Error('--format 仅支持 json 或 text。');
  const methods = [options.dryRun, options.queue, options.run].filter(Boolean).length;
  if (methods !== 1) throw new Error('必须且只能选择 --dry-run、--queue 或 --run 之一。');
  if (options.force && !options.run) throw new Error('--force 只能与 --run 同时使用。');
  return options;
}

function taskSelectors(options) {
  if (!options.taskFile) return options;
  const absolute = path.resolve(options.taskFile);
  const task = readJson(absolute, null);
  if (!task || !Array.isArray(task.profileIds)) throw new Error('--task-file 必须是包含 profileIds 数组的 JSON 文件。');
  return { ...options, profiles: [...new Set([...options.profiles, ...task.profileIds])], force: options.force || Boolean(task.force) };
}

function matchOne(profile, options) {
  const equalAny = (values, candidates) => !values.length || values.some((value) => candidates.includes(String(value).trim().toLowerCase()));
  const product = profile.productLine || {};
  const series = profile.subseries || {};
  const byProfile = !options.profiles.length || options.profiles.includes(profile.profileId);
  const byVendor = equalAny(options.vendors, [profile.vendorId]);
  const byLine = equalAny(options.productLines, [product.id, product.name]);
  const bySeries = equalAny(options.subseries, [series.id, series.name, profile.displayName]);
  return byProfile && byVendor && byLine && bySeries;
}

function selectProfiles(dataDir, options) {
  ensureBundledProfiles(dataDir);
  const profiles = listProfiles(dataDir).filter((profile) => profile.approvalStatus === 'approved' && profile.enabled);
  const hasSelector = options.allApproved || options.profiles.length || options.vendors.length || options.productLines.length || options.subseries.length;
  if (!hasSelector) throw new Error('请至少提供一个来源选择器，避免无意执行全部采集。');
  const selected = options.allApproved ? profiles : profiles.filter((profile) => matchOne(profile, options));
  if (!selected.length) throw new Error('没有匹配到已批准且启用的来源配置。请检查 profileId、厂商、产品线或子系列。');
  const missing = options.profiles.filter((profileId) => !selected.some((profile) => profile.profileId === profileId));
  if (missing.length) throw new Error(`以下来源配置不存在、未批准或已禁用：${missing.join(', ')}`);
  return selected;
}

function preview(profile) {
  return {
    profileId: profile.profileId,
    vendorId: profile.vendorId,
    vendorName: profile.vendorName,
    productLine: profile.productLine,
    subseries: profile.subseries,
    sourceCount: profile.sourceCount,
    modelCount: profile.modelCount,
    lastOutcome: profile.lastOutcome,
    lastCompletedAt: profile.lastCompletedAt,
    outputContract: ['PDF', 'document_manifest.csv', 'path_health_log.csv', 'change_log.csv', 'update_summary.csv', 'run.json', 'manifest.json'],
  };
}

function emit(payload, format) {
  if (format === 'json') return process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  const lines = [`模式：${payload.mode}`, `数据目录：${payload.dataDir}`, `来源配置：${payload.profiles.length}`];
  for (const profile of payload.profiles) lines.push(`- ${profile.profileId} · ${profile.vendorName} · ${profile.productLine?.name || ''} · ${profile.subseries?.name || ''} · ${profile.sourceCount} 份资料 / ${profile.modelCount} 个型号`);
  for (const result of payload.results || []) lines.push(`结果：${result.profileId} · ${result.outcome || result.status} · 快照 ${result.snapshotId || '—'} · 变化 ${result.changed ?? 0} · 失败 ${result.failures?.length ?? 0}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const parsed = taskSelectors(parseArgs(process.argv.slice(2)));
  const profiles = selectProfiles(parsed.dataDir, parsed);
  const payload = { collector: 'nvci-deterministic-public-collector', mode: parsed.dryRun ? 'dry_run' : parsed.queue ? 'queue' : 'run', dataDir: parsed.dataDir, generatedAt: new Date().toISOString(), profiles: profiles.map(preview), results: [] };
  if (parsed.dryRun) return emit(payload, parsed.format);
  if (parsed.queue) {
    payload.results = profiles.map((profile) => {
      const request = enqueueRun(parsed.dataDir, profile.profileId, 'deterministic-cli', { source: 'collection-cli' });
      return { profileId: profile.profileId, requestId: request.id, status: request.status };
    });
    return emit(payload, parsed.format);
  }
  for (const profile of profiles) {
    const result = await executeProfile({ dataDir: parsed.dataDir, profileId: profile.profileId, force: parsed.force });
    payload.results.push({ ...result, failures: result.failures || [] });
  }
  emit(payload, parsed.format);
}

main().catch((error) => {
  const payload = { ok: false, collector: 'nvci-deterministic-public-collector', error: String(error.message || error) };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exit(2);
});
