'use strict';

const path = require('path');

const DEFAULT_POLICY = {
  protocol: 'https:', requestTimeoutMs: 15000, headTimeoutMs: 15000,
  downloadHeaderTimeoutMs: 45000, downloadBodyIdleTimeoutMs: 120000,
  maxPdfBytes: 52428800, maxDocumentsPerRun: 50,
  userAgent: 'NVCI-Collector/0.3 (local public-document incremental audit)', sequentialRequests: true,
};

function text(value, label, min = 1, max = 120) {
  const normalized = String(value || '').trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${label}长度必须为 ${min}–${max} 个字符。`);
  return normalized;
}
function safeId(value, label = '标识') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) throw new Error(`${label}只能使用 2–64 位小写字母、数字、下划线或连字符。`);
  return normalized;
}
function safeFileName(value, fallback) {
  const raw = String(value || fallback || '').trim().replace(/[\\/\0]/g, '_');
  if (!raw || raw === '.' || raw === '..') throw new Error('官方文件名无效。');
  return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;
}
function stringArray(value, label, max = 50) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,;；]/);
  const normalized = [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];
  if (!normalized.length || normalized.length > max) throw new Error(`${label}必须包含 1–${max} 项。`);
  return normalized;
}
function normalizeDomains(value) {
  const domains = stringArray(value, '官方域名', 20).map(domain => String(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  for (const domain of domains) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..')) throw new Error(`官方域名无效：${domain}`);
  }
  return [...new Set(domains)];
}
function assertOfficialHttps(urlValue, domains, label) {
  let url;
  try { url = new URL(String(urlValue || '')); } catch { throw new Error(`${label}不是有效 URL。`); }
  if (url.protocol !== 'https:') throw new Error(`${label}必须使用 HTTPS。`);
  if (!domains.includes(url.hostname.toLowerCase())) throw new Error(`${label}主机名不在官方域名白名单：${url.hostname}`);
  return url.toString();
}
function slugFrom(value, fallback) {
  const ascii = String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return safeId(ascii || fallback, '配置标识');
}
function sourceFrom(raw, index, profileId, domains, subseriesName) {
  const modelNames = stringArray(raw.modelNames, `第 ${index + 1} 条资料的型号`, 100);
  const series = text(raw.series || subseriesName, `第 ${index + 1} 条资料的子系列`, 1, 120);
  const pdfUrl = assertOfficialHttps(raw.pdfUrl, domains, `第 ${index + 1} 条资料 PDF URL`);
  const productPageUrl = raw.productPageUrl ? assertOfficialHttps(raw.productPageUrl, domains, `第 ${index + 1} 条资料产品页 URL`) : '';
  const officialFileName = safeFileName(raw.officialFileName, `${slugFrom(series, `series_${index + 1}`)}.pdf`);
  return {
    documentId: safeId(raw.documentId || `${profileId}_${index + 1}`, '资料条目标识'),
    series,
    modelNames,
    productPageUrl,
    pdfUrl,
    officialFileName,
    evidencePolicy: text(raw.evidencePolicy || 'official_datasheet', `第 ${index + 1} 条资料证据规则`, 3, 160),
    expectedSha256: '',
  };
}
function normalizeProfileDraft(raw, existing = null) {
  const vendorId = safeId(raw.vendorId || existing?.vendorId, '厂商品牌标识');
  const vendorName = text(raw.vendorName || existing?.vendorName || vendorId, '品牌名称', 1, 80);
  const productLine = {
    id: safeId(raw.productLine?.id || existing?.productLine?.id || slugFrom(raw.productLine?.name || existing?.productLine?.name, 'product_line'), '产品线标识'),
    name: text(raw.productLine?.name || existing?.productLine?.name, '产品线名称', 1, 80),
    libraryRootName: text(raw.productLine?.libraryRootName || existing?.productLine?.libraryRootName || `${vendorName}产品彩页`, '资料库品牌根目录', 1, 120),
  };
  const subseries = {
    id: safeId(raw.subseries?.id || existing?.subseries?.id || slugFrom(raw.subseries?.name || existing?.subseries?.name, 'subseries'), '子系列标识'),
    name: text(raw.subseries?.name || existing?.subseries?.name, '子系列名称', 1, 120),
  };
  const profileId = safeId(raw.profileId || existing?.profileId || `${vendorId}_${productLine.id}_${subseries.id}`, '来源配置标识');
  const domains = normalizeDomains(raw.officialDomains || existing?.officialDomains);
  const sourceInput = raw.sources === undefined && existing ? existing.sources : raw.sources;
  if (!Array.isArray(sourceInput) || !sourceInput.length || sourceInput.length > 50) throw new Error('资料条目必须为 1–50 条。');
  const sources = sourceInput.map((source, index) => sourceFrom(source, index, profileId, domains, subseries.name));
  const now = new Date().toISOString();
  return {
    schemaVersion: '2.0', profileId, vendorId, vendorName,
    displayName: text(raw.displayName || existing?.displayName || `${vendorName} ${subseries.name} 官方资料`, '配置显示名称', 1, 160),
    approvalStatus: 'draft', sampleCheck: null, enabled: false,
    mode: 'public_official_pdf_incremental', officialDomains: domains,
    sourcePolicy: text(raw.sourcePolicy || existing?.sourcePolicy || '仅采集已登记的公开官方 PDF；产品页用于发现，资料事实以声明的证据规则为准。', '来源策略', 3, 500),
    evidencePolicy: text(raw.evidencePolicy || existing?.evidencePolicy || 'official_datasheet', '默认证据规则', 3, 160),
    productLine, subseries,
    productLinePath: [productLine.libraryRootName, productLine.name],
    collectionPolicy: { ...DEFAULT_POLICY, ...(existing?.collectionPolicy || {}) , maxDocumentsPerRun: sources.length },
    schedule: { enabled: false, weekday: 1, hour: 2, minute: 15, timezone: 'local' },
    sources,
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
}
function profileDetail(profile, state = {}) {
  return {
    profileId: profile.profileId, displayName: profile.displayName, vendorId: profile.vendorId, vendorName: profile.vendorName || profile.vendorId,
    approvalStatus: profile.approvalStatus || 'approved', enabled: Boolean(profile.enabled), officialDomains: profile.officialDomains || [],
    productLine: profile.productLine || { id: 'legacy', name: profile.productLinePath?.[1] || '未分类', libraryRootName: profile.productLinePath?.[0] || '' },
    subseries: profile.subseries || { id: 'legacy', name: profile.displayName }, sourcePolicy: profile.sourcePolicy || '', evidencePolicy: profile.evidencePolicy || '',
    sourceCount: profile.sources?.length || 0, modelCount: new Set((profile.sources || []).flatMap(source => source.modelNames || [])).size,
    schedule: profile.schedule || {}, bootstrapComplete: Boolean(state.bootstrapComplete), lastCompletedAt: state.lastCompletedAt || '', lastOutcome: state.lastOutcome || 'not_started',
    sampleCheck: profile.sampleCheck || null, createdAt: profile.createdAt || '', updatedAt: profile.updatedAt || '',
    sources: (profile.sources || []).map(source => ({ ...source, modelNames: source.modelNames || [] })),
  };
}
function libraryPathForSource(profile, source) {
  return path.join(...profile.productLinePath, '01 官方彩页', source.series, source.officialFileName);
}

module.exports = { assertOfficialHttps, libraryPathForSource, normalizeProfileDraft, profileDetail, safeId };
