'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR_NAME = 'automation/source-profiles';
const BUNDLED_PROFILE_DIR = path.join(__dirname, 'bundled-profiles');
const AUTOMATION_DIR_NAME = 'automation';
const SNAPSHOT_DIR_NAME = 'snapshots';
const LIBRARY_DIR_NAME = 'library';
const MAX_REDIRECTS = 3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const STALE_CLAIM_MS = 5 * 60 * 1000;

function nowIso(now = new Date()) { return now.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(filePath, fallback) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}
function writeTextAtomic(filePath, content) {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, filePath);
}
function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function hashFile(filePath) { return hashBuffer(fs.readFileSync(filePath)); }
function listFilesRecursively(root, relative = '') {
  const absolute = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursively(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
function safeName(value) { return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed'; }
function safePathSegment(value) {
  const normalized = String(value || '').trim().replace(/[\\/\0]/g, '_').replace(/[<>:"|?*]/g, '_').replace(/\s+/g, '_');
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : '未命名';
}
function requestHeaders(profile) {
  const userAgent = String(profile?.collectionPolicy?.userAgent || '').trim();
  return userAgent ? { 'User-Agent': userAgent } : {};
}
function escapeCsv(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function writeCsv(filePath, columns, rows) {
  const lines = [columns.map(escapeCsv).join(',')];
  for (const row of rows) lines.push(columns.map((column) => escapeCsv(row[column])).join(','));
  writeTextAtomic(filePath, `\uFEFF${lines.join('\n')}\n`);
}
function copyFileAtomic(source, destination) {
  ensureDir(path.dirname(destination));
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, destination);
}
function writeBufferAtomic(destination, buffer) {
  ensureDir(path.dirname(destination));
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, destination);
}
function sameMetadata(previous, current) {
  if (!previous) return false;
  return previous.etag === current.etag
    && previous.lastModified === current.lastModified
    && previous.contentLength === current.contentLength
    && previous.contentType === current.contentType
    && previous.status === current.status;
}
class GateError extends Error {
  constructor(decision, message) { super(message); this.decision = decision; }
}

const GATE_SCHEMA_VERSION = '2';

function assertAllowedUrl(rawUrl, profile, allowTrustedRedirect = false) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new GateError('needs_route_validation', `仅允许 HTTPS 来源：${rawUrl}`);
  const official = profile.officialDomains || [];
  const trustedRedirects = profile.trustedRedirectDomains || [];
  const allowed = official.includes(url.hostname) || (allowTrustedRedirect && trustedRedirects.includes(url.hostname));
  if (!allowed) throw new GateError('needs_route_validation', `来源域名不在官方域名或受控重定向白名单：${url.hostname}`);
  return url;
}

function compactMatchText(value) {
  return String(value || '').normalize('NFKD').toLocaleLowerCase('zh-CN').replace(/[\s_./\\\\()（）\[\]{}-]+/gu, '');
}

function sourceMatchTerms(source) {
  const rawTerms = Array.isArray(source.matchTerms) && source.matchTerms.length
    ? source.matchTerms
    : [source.series, ...(source.modelNames || [])];
  return [...new Set(rawTerms.flatMap((term) => String(term || '').split(/[\\/|,，;；]+/)).map(compactMatchText).filter((term) => term.length >= 3))];
}

function inspectPdf(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new GateError('non_pdf_response', '下载内容未通过 PDF 文件签名检查');
  const tail = buffer.subarray(Math.max(0, buffer.length - 4096)).toString('latin1');
  if (!tail.includes('%%EOF')) throw new GateError('parse_failed', 'PDF 缺少结束标记，无法通过基础可读性检查');
  const text = buffer.toString('latin1');
  const pageObjects = (text.match(/\/Type\s*\/Page\b/g) || []).length;
  const pageTreeCount = Number((text.match(/\/Count\s+(\d+)/) || [])[1] || 0);
  const pageCount = pageObjects || pageTreeCount;
  if (pageCount < 1) throw new GateError('parse_failed', 'PDF 未识别到页面对象或页树计数，无法通过基础可读性检查');
  const title = (text.match(/\/Title\s*\(([^)]{1,240})\)/) || [])[1] || '';
  return { pageCount, title };
}

function assertSourceApplicability(source, inspection) {
  const terms = sourceMatchTerms(source);
  if (!terms.length) throw new GateError('applicability_needs_review', '来源未声明可用于匹配的系列或型号');
  const candidate = [source.officialFileName, source.pdfUrl, source.materialPageUrl, inspection.title].map(compactMatchText).join(' ');
  const matchTerm = terms.find((term) => candidate.includes(term));
  if (!matchTerm) throw new GateError('source_series_mismatch', `官方文件名、资料链或 PDF 标题未匹配声明系列/型号：${source.series}`);
  return { matchTerm };
}
function boundedTimeout(value, fallback, maximum = 300000) {
  const configured = Number(value || fallback);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1000), maximum) : fallback;
}
function requestTimeoutMs(profile) {
  return boundedTimeout(profile?.collectionPolicy?.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 60000);
}
function headTimeoutMs(profile) {
  return boundedTimeout(profile?.collectionPolicy?.headTimeoutMs, requestTimeoutMs(profile), 60000);
}
function downloadHeaderTimeoutMs(profile) {
  return boundedTimeout(profile?.collectionPolicy?.downloadHeaderTimeoutMs, requestTimeoutMs(profile), 120000);
}
function downloadBodyIdleTimeoutMs(profile) {
  return boundedTimeout(profile?.collectionPolicy?.downloadBodyIdleTimeoutMs, requestTimeoutMs(profile), 300000);
}
async function safeFetch(rawUrl, options, profile, fetchImpl = fetch, timeoutMs = requestTimeoutMs(profile)) {
  let current = assertAllowedUrl(rawUrl, profile).toString();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = options.signal;
    const signal = upstreamSignal ? AbortSignal.any([controller.signal, upstreamSignal]) : controller.signal;
    let response;
    try {
      response = await fetchImpl(current, { ...options, signal, redirect: 'manual' });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`请求头超时（${timeoutMs}ms）：${current}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current, redirectCount };
    const location = response.headers.get('location');
    if (!location) throw new Error(`重定向缺少 Location：${current}`);
    current = assertAllowedUrl(new URL(location, current).toString(), profile, true).toString();
  }
  throw new Error(`重定向次数超过限制：${rawUrl}`);
}
async function readResponseBuffer(response, profile, timeoutMs = downloadBodyIdleTimeoutMs(profile)) {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      let timer;
      const next = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`响应体读取超时（${timeoutMs}ms）`)), timeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.length;
      if (total > profile.collectionPolicy.maxPdfBytes) throw new Error(`下载内容超过限制：${total} bytes`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort cancellation */ }
    throw error;
  }
}
function headerMetadata(response) {
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
    contentLength: Number(response.headers.get('content-length') || 0),
  };
}
function profilePaths(dataDir, profileId) {
  const automationRoot = path.join(dataDir, AUTOMATION_DIR_NAME);
  return {
    automationRoot,
    profilesRoot: path.join(automationRoot, 'source-profiles'),
    profileFile: path.join(automationRoot, 'source-profiles', `${profileId}.json`),
    stateFile: path.join(automationRoot, 'profiles', profileId, 'state.json'),
    statusFile: path.join(automationRoot, 'status.json'),
    runRoot: path.join(automationRoot, 'runs'),
    snapshotRoot: path.join(dataDir, SNAPSHOT_DIR_NAME, profileId),
    libraryRoot: path.join(dataDir, LIBRARY_DIR_NAME),
  };
}
function ensureBundledProfiles(dataDir) {
  const profilesRoot = path.join(dataDir, PROFILE_DIR_NAME);
  ensureDir(profilesRoot);
  if (!fs.existsSync(BUNDLED_PROFILE_DIR)) return [];
  const copied = [];
  for (const name of fs.readdirSync(BUNDLED_PROFILE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const source = path.join(BUNDLED_PROFILE_DIR, name);
    const destination = path.join(profilesRoot, name);
    const bundled = readJson(source, null);
    const current = readJson(destination, null);
    if (!current) { fs.copyFileSync(source, destination); copied.push(name); continue; }
    const state = bundled ? readJson(profilePaths(dataDir, bundled.profileId).stateFile, {}) : {};
    const needsBootstrapSafeRefresh = bundled && bundled.bundledRevision && bundled.bundledRevision !== current.bundledRevision && !state.bootstrapComplete;
    if (needsBootstrapSafeRefresh) {
      const refreshed = { ...bundled, enabled: current.enabled !== false, schedule: { ...(bundled.schedule || {}), ...(current.schedule || {}) } };
      writeJsonAtomic(destination, refreshed);
      copied.push(`${name}:refreshed`);
    }
  }
  return copied;
}
function readProfile(dataDir, profileId) {
  const profile = readJson(profilePaths(dataDir, profileId).profileFile, null);
  if (!profile) throw new Error(`未找到自动采集来源配置：${profileId}`);
  return profile;
}
function loadProfile(dataDir, profileId) {
  const profile = readProfile(dataDir, profileId);
  if (profile.approvalStatus && profile.approvalStatus !== 'approved') throw new Error(`来源配置尚未批准：${profileId}`);
  if (!profile.enabled) throw new Error(`来源配置已禁用：${profileId}`);
  if (!Array.isArray(profile.sources) || !profile.sources.length) throw new Error(`来源配置没有资料条目：${profileId}`);
  return profile;
}
function listProfiles(dataDir) {
  ensureBundledProfiles(dataDir);
  const root = path.join(dataDir, PROFILE_DIR_NAME);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.endsWith('.json')).map((name) => {
    const profile = readJson(path.join(root, name), null);
    if (!profile) return null;
    const state = readJson(profilePaths(dataDir, profile.profileId).stateFile, {});
    return {
      profileId: profile.profileId,
      displayName: profile.displayName,
      vendorId: profile.vendorId,
      vendorName: profile.vendorName || profile.vendorId,
      approvalStatus: profile.approvalStatus || 'approved',
      productLine: profile.productLine || { id: 'legacy', name: profile.productLinePath?.[1] || '未分类', libraryRootName: profile.productLinePath?.[0] || '' },
      subseries: profile.subseries || { id: 'legacy', name: profile.displayName },
      enabled: profile.enabled,
      sourceCount: profile.sources.length,
      modelCount: new Set(profile.sources.flatMap((source) => source.modelNames || [])).size,
      schedule: profile.schedule,
      bootstrapComplete: Boolean(state.bootstrapComplete),
      lastCompletedAt: state.lastCompletedAt || '',
      lastOutcome: state.lastOutcome || 'not_started',
      lastRunId: state.lastRunId || '',
    };
  }).filter(Boolean);
}
function runId(profileId, now) { return `${safeName(profileId)}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`; }
function activePdfPath(libraryRoot, profile, source) {
  return path.join(libraryRoot, ...profile.productLinePath, '01 官方彩页', safePathSegment(source.series), source.officialFileName);
}
function activeAuditDir(libraryRoot, profile, startedAt, runIdentifier) {
  const day = startedAt.toISOString().slice(0, 10);
  return path.join(libraryRoot, ...profile.productLinePath, '08 更新与缺口记录', `${day}_${safeName(runIdentifier)}`);
}
function createStatus(dataDir, patch) {
  const file = profilePaths(dataDir, 'unused').statusFile;
  const previous = readJson(file, { profiles: {}, updatedAt: '' });
  const profileStatus = { ...(previous.profiles || {}), ...(patch.profiles || {}) };
  const next = { ...previous, ...patch, profiles: profileStatus, updatedAt: nowIso() };
  writeJsonAtomic(file, next);
  return next;
}

async function executeProfile({ dataDir, profileId, force = false, fetchImpl = fetch, clock = () => new Date() }) {
  ensureBundledProfiles(dataDir);
  const profile = loadProfile(dataDir, profileId);
  const startedAt = clock();
  const startedAtIso = nowIso(startedAt);
  const identifier = runId(profileId, startedAt);
  const paths = profilePaths(dataDir, profileId);
  const snapshotDir = path.join(paths.snapshotRoot, identifier);
  const sourcePdfDir = path.join(snapshotDir, 'official_materials');
  const runLogDir = path.join(paths.runRoot, profileId);
  ensureDir(snapshotDir); ensureDir(sourcePdfDir); ensureDir(runLogDir);
  const state = readJson(paths.stateFile, { profileId, bootstrapComplete: false, sources: {}, publishedSnapshots: [] });
  const sourceState = state.sources || {};
  const results = [];
  const manifestDocuments = [];
  const changed = [];
  const failures = [];
  let bytesDownloaded = 0;
  createStatus(dataDir, { profiles: { [profileId]: { state: 'running', runId: identifier, startedAt: startedAtIso, displayName: profile.displayName } } });
  writeJsonAtomic(path.join(snapshotDir, 'scope.json'), {
    snapshotId: identifier, profileId, startedAt: startedAtIso, mode: profile.mode, sourcePolicy: profile.sourcePolicy,
    officialDomains: profile.officialDomains, trustedRedirectDomains: profile.trustedRedirectDomains || [], sourceCount: profile.sources.length, bootstrap: !state.bootstrapComplete, force,
  });

  for (const source of profile.sources.slice(0, profile.collectionPolicy.maxDocumentsPerRun)) {
          const row = { documentId: source.documentId, series: source.series, productPageUrl: source.productPageUrl, materialPageUrl: source.materialPageUrl || '', sourceUrl: source.pdfUrl, startedAt: nowIso(clock()), gateSchemaVersion: GATE_SCHEMA_VERSION };

    try {
      assertAllowedUrl(source.pdfUrl, profile);
      const head = await safeFetch(source.pdfUrl, { method: 'HEAD', headers: requestHeaders(profile) }, profile, fetchImpl, headTimeoutMs(profile));
      const metadata = headerMetadata(head.response);
      row.finalUrl = head.finalUrl; Object.assign(row, metadata);
      if (metadata.status < 200 || metadata.status >= 400) throw new GateError('source_unavailable', `HTTP 状态异常：${metadata.status}`);
      const declaredType = metadata.contentType.toLowerCase();
      if (declaredType && !declaredType.includes('pdf') && !declaredType.includes('octet-stream')) throw new GateError('non_pdf_response', `Content-Type 不是 PDF：${metadata.contentType}`);
      if (metadata.contentLength > profile.collectionPolicy.maxPdfBytes) throw new GateError('restricted_excluded', `文件超过限制：${metadata.contentLength} bytes`);
      const previous = sourceState[source.documentId];
      const needsDownload = force || !sameMetadata(previous, metadata) || previous?.gateSchemaVersion !== GATE_SCHEMA_VERSION;
      row.decision = needsDownload ? 'download_candidate' : 'reuse_unchanged';
      let sha256 = previous && previous.sha256 ? previous.sha256 : source.expectedSha256;
      let localRelativePath = previous && previous.localRelativePath ? previous.localRelativePath : '';
      if (needsDownload) {
        const get = await safeFetch(source.pdfUrl, { method: 'GET', headers: requestHeaders(profile) }, profile, fetchImpl, downloadHeaderTimeoutMs(profile));
        if (!get.response.ok) throw new Error(`下载 HTTP 状态异常：${get.response.status}`);
        const buffer = await readResponseBuffer(get.response, profile, downloadBodyIdleTimeoutMs(profile));
        const inspection = inspectPdf(buffer);
        const applicability = assertSourceApplicability(source, inspection);
        row.pdfPageCount = inspection.pageCount; row.pdfTitle = inspection.title; row.matchTerm = applicability.matchTerm;
        sha256 = hashBuffer(buffer); bytesDownloaded += buffer.length;
        const hashChanged = Boolean(previous && previous.sha256 && previous.sha256 !== sha256);
        const baselineChanged = Boolean(source.expectedSha256 && source.expectedSha256 !== sha256);
        const immutablePath = path.join(sourcePdfDir, safePathSegment(source.series), source.officialFileName);
        writeBufferAtomic(immutablePath, buffer);
        localRelativePath = path.relative(snapshotDir, immutablePath);
        const activePath = activePdfPath(paths.libraryRoot, profile, source);
        writeBufferAtomic(activePath, buffer);
        row.sha256 = sha256; row.bytesDownloaded = buffer.length; row.localRelativePath = localRelativePath;
        row.activeLibraryPath = path.relative(paths.libraryRoot, activePath); row.contentDisposition = hashChanged || baselineChanged ? 'changed_or_new' : 'verified_unchanged_bootstrap';
        if (hashChanged || baselineChanged) changed.push({ documentId: source.documentId, series: source.series, previousSha256: previous ? previous.sha256 || '' : source.expectedSha256 || '', currentSha256: sha256, activeLibraryPath: row.activeLibraryPath });
      } else {
        row.sha256 = sha256; row.contentDisposition = 'reused_unchanged'; row.localRelativePath = localRelativePath;
      }
      row.status = 'completed'; row.completedAt = nowIso(clock());
      sourceState[source.documentId] = { ...metadata, sha256, localRelativePath, verifiedAt: row.completedAt, sourceUrl: source.pdfUrl, series: source.series, gateSchemaVersion: GATE_SCHEMA_VERSION, pdfPageCount: row.pdfPageCount || previous?.pdfPageCount || 0, pdfTitle: row.pdfTitle || previous?.pdfTitle || '', matchTerm: row.matchTerm || previous?.matchTerm || '' };
      manifestDocuments.push({ ...source, sha256, localRelativePath, decision: row.decision, status: row.status, pdfPageCount: row.pdfPageCount || previous?.pdfPageCount || 0, pdfTitle: row.pdfTitle || previous?.pdfTitle || '', matchTerm: row.matchTerm || previous?.matchTerm || '', gateSchemaVersion: GATE_SCHEMA_VERSION });
    } catch (error) {
      row.status = 'failed'; row.decision = error?.decision || 'needs_route_validation'; row.error = String(error.message || error); row.completedAt = nowIso(clock());
      failures.push({ documentId: source.documentId, series: source.series, sourceUrl: source.pdfUrl, decision: row.decision, error: row.error });
    }
    results.push(row);
  }

  const completed = results.filter((row) => row.status === 'completed');
  const bootstrapPublished = !state.bootstrapComplete && failures.length === 0 && completed.length === profile.sources.length;
  const outcome = failures.length ? 'attention' : (bootstrapPublished ? 'initial_mirror_published' : (changed.length ? 'changes_published' : 'no_change'));
  const auditDir = activeAuditDir(paths.libraryRoot, profile, startedAt, identifier);
  ensureDir(auditDir);
  writeCsv(path.join(snapshotDir, 'path_health_log.csv'), ['document_id', 'series', 'source_url', 'status', 'content_type', 'etag', 'last_modified', 'content_length', 'decision', 'pdf_page_count', 'match_term', 'error', 'checked_at'], results.map((row) => ({ document_id: row.documentId, series: row.series, source_url: row.sourceUrl, status: row.status, content_type: row.contentType || '', etag: row.etag || '', last_modified: row.lastModified || '', content_length: row.contentLength || '', decision: row.decision, pdf_page_count: row.pdfPageCount || '', match_term: row.matchTerm || '', error: row.error || '', checked_at: row.completedAt || '' })));
  writeCsv(path.join(snapshotDir, 'document_manifest.csv'), ['document_id', 'series', 'official_url', 'product_page_url', 'sha256', 'decision', 'status', 'snapshot_relative_path'], manifestDocuments.map((row) => ({ document_id: row.documentId, series: row.series, official_url: row.pdfUrl, product_page_url: row.productPageUrl, sha256: row.sha256, decision: row.decision, status: row.status, snapshot_relative_path: row.localRelativePath || '' })));
  writeCsv(path.join(snapshotDir, 'change_log.csv'), ['document_id', 'series', 'previous_sha256', 'current_sha256', 'active_library_path', 'detected_at'], changed.map((row) => ({ document_id: row.documentId, series: row.series, previous_sha256: row.previousSha256, current_sha256: row.currentSha256, active_library_path: row.activeLibraryPath, detected_at: nowIso(clock()) })));
  const fiveColumnFile = `${safePathSegment(profile.vendorName)}_${safeName(profile.productLine?.id || profile.profileId)}_彩页记录.csv`;
  writeCsv(path.join(snapshotDir, fiveColumnFile), ['序号', '型号（系列）', '彩页文件名', '下载链接URL', '下载时间'], manifestDocuments.map((row, index) => ({ '序号': index + 1, '型号（系列）': row.series, '彩页文件名': row.officialFileName, '下载链接URL': row.pdfUrl, '下载时间': nowIso(clock()).slice(0, 10) })));
  writeCsv(path.join(snapshotDir, 'update_summary.csv'), ['snapshot_id', 'profile_id', 'outcome', 'total_sources', 'completed', 'changed', 'unchanged', 'failed', 'bytes_downloaded', 'started_at', 'completed_at'], [{ snapshot_id: identifier, profile_id: profileId, outcome, total_sources: profile.sources.length, completed: completed.length, changed: changed.length, unchanged: completed.filter((r) => r.contentDisposition === 'reused_unchanged').length, failed: failures.length, bytes_downloaded: bytesDownloaded, started_at: startedAtIso, completed_at: nowIso(clock()) }]);
  writeJsonAtomic(path.join(snapshotDir, 'run.json'), { snapshotId: identifier, profileId, startedAt: startedAtIso, completedAt: nowIso(clock()), outcome, bootstrap: !state.bootstrapComplete, force, totalSources: profile.sources.length, completed: completed.length, changed: changed.length, failures, bytesDownloaded, results });

  const artifactPaths = listFilesRecursively(snapshotDir).filter((name) => name !== 'manifest.json');
  const manifest = { manifestSchemaVersion: '1.0', snapshotId: identifier, profileId, sourcePolicy: profile.sourcePolicy, startedAt: startedAtIso, publishedAt: nowIso(clock()), outcome, bootstrap: !state.bootstrapComplete, recordCounts: { totalSources: profile.sources.length, completed: completed.length, changed: changed.length, failures: failures.length, bytesDownloaded }, artifactHashes: artifactPaths.map((name) => ({ path: name, bytes: fs.statSync(path.join(snapshotDir, name)).size, sha256: hashFile(path.join(snapshotDir, name)) })), documents: manifestDocuments };
  writeJsonAtomic(path.join(snapshotDir, 'manifest.json'), manifest);
  for (const name of ['path_health_log.csv', 'document_manifest.csv', 'change_log.csv', fiveColumnFile, 'update_summary.csv', 'run.json', 'manifest.json']) copyFileAtomic(path.join(snapshotDir, name), path.join(auditDir, name));

  const stateNext = { ...state, profileId, bootstrapComplete: failures.length === 0 && completed.length === profile.sources.length, sources: sourceState, lastRunId: identifier, lastCompletedAt: nowIso(clock()), lastOutcome: outcome, publishedSnapshots: [...(state.publishedSnapshots || []), { snapshotId: identifier, outcome, completedAt: nowIso(clock()), changed: changed.length, failures: failures.length, bootstrapPublished }].slice(-100) };
  writeJsonAtomic(paths.stateFile, stateNext);
  writeJsonAtomic(path.join(runLogDir, `${identifier}.json`), { snapshotId: identifier, outcome, completedAt: nowIso(clock()), changed: changed.length, failures: failures.length, bytesDownloaded, snapshotDir, auditDir });
  createStatus(dataDir, { profiles: { [profileId]: { state: failures.length ? 'attention' : 'idle', runId: identifier, startedAt: startedAtIso, completedAt: nowIso(clock()), outcome, changed: changed.length, failures: failures.length, bytesDownloaded, bootstrapComplete: stateNext.bootstrapComplete, snapshotDir: path.relative(dataDir, snapshotDir), auditDir: path.relative(dataDir, auditDir), nextEligibleAt: '' } } });
  return { snapshotId: identifier, profileId, outcome, completed: completed.length, changed: changed.length, failures, bytesDownloaded, snapshotDir, auditDir, bootstrapComplete: stateNext.bootstrapComplete };
}

function enqueueRun(dataDir, profileId, requestedBy = 'local-admin') {
  ensureBundledProfiles(dataDir);
  loadProfile(dataDir, profileId);
  const queueFile = path.join(dataDir, AUTOMATION_DIR_NAME, 'queue.json');
  const queue = readJson(queueFile, { items: [] });
  const existing = queue.items.find((item) => item.profileId === profileId && item.status === 'queued');
  if (existing) return existing;
  const item = { id: `request-${crypto.randomUUID().slice(0, 8)}`, profileId, requestedBy, requestedAt: nowIso(), status: 'queued' };
  queue.items.push(item); writeJsonAtomic(queueFile, queue); return item;
}
function recoverStaleClaims(dataDir, staleAfterMs = STALE_CLAIM_MS) {
  const queueFile = path.join(dataDir, AUTOMATION_DIR_NAME, 'queue.json');
  const queue = readJson(queueFile, { items: [] });
  const now = Date.now();
  let recovered = 0;
  for (const item of queue.items) {
    if (item.status !== 'claimed' || !item.claimedAt) continue;
    const claimedAt = Date.parse(item.claimedAt);
    if (Number.isNaN(claimedAt) || now - claimedAt <= staleAfterMs) continue;
    item.status = 'failed'; item.completedAt = nowIso(); item.outcome = 'interrupted'; item.error = '后台采集器重启或请求超时后自动回收的未完成任务'; recovered += 1;
  }
  if (recovered) { queue.items = queue.items.slice(-100); writeJsonAtomic(queueFile, queue); }
  return recovered;
}
function claimNextRun(dataDir) {
  const queueFile = path.join(dataDir, AUTOMATION_DIR_NAME, 'queue.json');
  const queue = readJson(queueFile, { items: [] });
  const item = queue.items.find((candidate) => candidate.status === 'queued');
  if (!item) return null;
  item.status = 'claimed'; item.claimedAt = nowIso(); writeJsonAtomic(queueFile, queue); return item;
}
function finishQueuedRun(dataDir, requestId, outcome, error = '') {
  const queueFile = path.join(dataDir, AUTOMATION_DIR_NAME, 'queue.json');
  const queue = readJson(queueFile, { items: [] });
  const item = queue.items.find((candidate) => candidate.id === requestId);
  if (item) { item.status = error ? 'failed' : 'completed'; item.completedAt = nowIso(); item.outcome = outcome || ''; item.error = error; }
  queue.items = queue.items.slice(-100); writeJsonAtomic(queueFile, queue);
}

module.exports = { activeAuditDir, assertAllowedUrl, boundedTimeout, claimNextRun, createStatus, downloadBodyIdleTimeoutMs, downloadHeaderTimeoutMs, enqueueRun, ensureBundledProfiles, executeProfile, finishQueuedRun, headTimeoutMs, listProfiles, loadProfile, nowIso, profilePaths, readJson, readProfile, readResponseBuffer, recoverStaleClaims, requestTimeoutMs, safeFetch, safeName, sameMetadata, writeJsonAtomic, STALE_CLAIM_MS };
