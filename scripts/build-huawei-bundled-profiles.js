'use strict';

/**
 * Build Huawei Enterprise bundled profiles only from local rows that already
 * passed official PDF/signature/hash verification. The source log is an audit
 * input, not a discovery mechanism.
 */
const fs = require('fs');
const path = require('path');

const RUN = '/home/ubuntu/runs/huawei-enterprise-network-remaining-2026-08-19';
const INPUT = path.join(RUN, 'document_download_log.csv');
const SUPPLEMENT = path.join(RUN, 'supplement_download_log.json');
const OUT = path.join(__dirname, '..', 'automation', 'bundled-profiles');
const REVISION = '2026-08-19-huawei-verified-v1';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.filter((values) => values.length === header.length).map((values) => Object.fromEntries(header.map((name, i) => [name.replace(/^\uFEFF/, ''), values[i]])));
}
function id(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}
function models(value) {
  return String(value || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
}
function isIndustrial(series) {
  return /S1731I|S5735I/.test(series);
}
function categoryFor(row) {
  const pathText = row.category_path || '';
  if (pathText.startsWith('01 园区交换机')) return isIndustrial(row.series) ? '03 工业交换机' : '02 接入交换机';
  return pathText.split('/')[0] || '99 待分类';
}
const categoryMeta = {
  '02 接入交换机': { id: 'campus_access', line: '01 园区交换机/02 接入交换机', name: '华为园区接入交换机' },
  '03 工业交换机': { id: 'campus_industrial', line: '01 园区交换机/03 工业交换机', name: '华为园区工业交换机' },
  '02 数据中心交换机': { id: 'datacenter_switches', line: '02 数据中心交换机', name: '华为数据中心交换机' },
  '03 无线局域网': { id: 'wlan', line: '03 无线局域网', name: '华为无线局域网' },
  '04 路由器': { id: 'routers', line: '04 路由器', name: '华为路由器' },
  '05 网络安全产品': { id: 'security', line: '05 网络安全产品', name: '华为网络安全产品' },
  '06 网络管控与分析软件': { id: 'network_management', line: '06 网络管控与分析软件', name: '华为网络管控与分析软件' },
};

const initialRows = parseCsv(fs.readFileSync(INPUT, 'utf8')).filter((row) => ['downloaded', 'official_pdf_verified', 'official_pdf_reused'].includes(row.archive_status) && row.pdf_signature_valid === 'True' && row.sha256 && (row.document_url_candidate || row.effective_url)).map((row) => ({
  ...row,
  sourceUrl: row.document_url_candidate || row.effective_url,
  officialFileName: row.official_filename,
}));
const supplementRows = JSON.parse(fs.readFileSync(SUPPLEMENT, 'utf8')).filter((row) => ['official_pdf_verified', 'official_pdf_reused'].includes(row.archive_status) && row.sha256 && row.document_url).map((row) => ({
  ...row,
  sourceUrl: row.document_url,
  officialFileName: row.file_name,
  models_as_stated: row.series,
  product_page_url: '',
}));
const seen = new Set();
const rows = [...initialRows, ...supplementRows].filter((row) => {
  const key = `${row.sha256}|${row.series}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const groups = new Map();
for (const row of rows) {
  const category = categoryFor(row);
  if (!categoryMeta[category]) continue;
  if (!groups.has(category)) groups.set(category, []);
  groups.get(category).push(row);
}
fs.mkdirSync(OUT, { recursive: true });
const written = [];
for (const [category, records] of groups) {
  const meta = categoryMeta[category];
  const profileId = `huawei_${meta.id}`;
  const sources = records.sort((a, b) => a.series.localeCompare(b.series, 'zh-CN')).map((row, index) => ({
    documentId: `${profileId}_${String(index + 1).padStart(2, '0')}`,
    series: row.series,
    modelNames: models(row.models_as_stated || row.series),
    productPageUrl: row.product_page_url || '',
    materialPageUrl: row.material_page_url || '',
    // Use the verified start URL to preserve the official e.huawei→e-file redirect chain.
    pdfUrl: row.sourceUrl,
    officialFileName: row.officialFileName,
    evidencePolicy: 'official_product_brochure_pdf',
    expectedSha256: row.sha256,
  }));
  const profile = {
    schemaVersion: '2.1', bundledRevision: REVISION,
    profileId, vendorId: 'huawei', vendorName: '华为',
    displayName: `${meta.name}｜已验证官方彩页`, approvalStatus: 'draft', enabled: false,
    mode: 'public_official_pdf_incremental',
    officialDomains: ['e.huawei.com', 'e-file.huawei.com'],
    sourcePolicy: '仅采集已在 2026-08-19 本地镜像中通过官方资料链、PDF 签名、SHA-256 和系列/文件名匹配门禁的华为企业网络公开彩页。',
    evidencePolicy: 'official_product_brochure_pdf',
    productLine: { id: meta.id, name: meta.line, libraryRootName: '华为产品彩页' },
    subseries: { id: 'verified_public_brochures', name: '已验证公开彩页' },
    productLinePath: ['华为产品彩页', meta.line],
    collectionPolicy: { protocol: 'https:', headTimeoutMs: 15000, downloadHeaderTimeoutMs: 45000, downloadBodyIdleTimeoutMs: 120000, maxPdfBytes: 52428800, maxDocumentsPerRun: sources.length, userAgent: '', sequentialRequests: true },
    schedule: { enabled: false, weekday: 1, hour: 2, minute: 15, timezone: 'local' },
    sources,
  };
  const file = path.join(OUT, `${profileId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  written.push({ profileId, category, count: sources.length, file });
}
console.log(JSON.stringify({ inputRows: rows.length, profiles: written }, null, 2));
