'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNS = '/home/ubuntu/runs';
const OUT = path.join(ROOT, 'automation', 'bundled-profiles');
const REVISION = '2026-08-20-seven-vendor-controlled-v2';

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map((value) => value.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function chunks(items, size = 50) { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)); }
function slug(value) { return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'source'; }
function urlFileName(url, fallback) { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || fallback).replace(/[\\/\0]/g, '_'); } catch { return fallback; } }
function seriesTerms(value) {
  const text = String(value || '');
  const codes = text.match(/[A-Za-z]*\s*\d{3,5}[A-Za-z-]*/g) || [];
  return [...new Set([text, ...codes.map((code) => code.replace(/\s+/g, ''))].filter(Boolean))];
}
function repairMojibake(value) {
  const text = String(value || '');
  if (!/[\u00c0-\u00ff]/.test(text)) return text;
  try { return Buffer.from(text, 'latin1').toString('utf8'); } catch { return text; }
}
function hpeDocumentId(url) { try { return new URL(url).searchParams.get('id') || ''; } catch { return ''; } }
function profile({ profileId, vendorId, vendorName, displayName, domains, trustedRedirectDomains = [], productLine, libraryRoot, subseries, policy, sources }) {
  return {
    schemaVersion: '2.2', bundledRevision: REVISION, profileId, vendorId, vendorName, displayName,
    approvalStatus: 'draft', enabled: false, mode: 'public_official_pdf_incremental', officialDomains: domains, trustedRedirectDomains,
    sourcePolicy: policy, evidencePolicy: 'official_product_brochure_pdf',
    productLine: { id: slug(productLine), name: productLine, libraryRootName: libraryRoot },
    subseries: { id: slug(subseries), name: subseries }, productLinePath: [libraryRoot, productLine],
    collectionPolicy: { protocol: 'https:', headTimeoutMs: 15000, downloadHeaderTimeoutMs: 45000, downloadBodyIdleTimeoutMs: 120000, maxPdfBytes: 52428800, maxDocumentsPerRun: sources.length, userAgent: 'NVCI-Collector/0.4 (controlled public-document incremental audit)', sequentialRequests: true },
    schedule: { enabled: false, weekday: 1, hour: 2, minute: 15, timezone: 'local' },
    sources,
  };
}
function source({ id, series, modelNames, productPageUrl = '', materialPageUrl = '', pdfUrl, officialFileName, expectedSha256, evidencePolicy = 'official_product_brochure_pdf', matchTerms = [] }) {
  return { documentId: id, series, modelNames: modelNames?.length ? modelNames : [series], productPageUrl, materialPageUrl, pdfUrl, officialFileName, expectedSha256, matchTerms: matchTerms.length ? matchTerms : [series], evidencePolicy };
}
function writeProfiles(profiles) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const item of profiles) fs.writeFileSync(path.join(OUT, `${item.profileId}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8');
}

function buildHpe() {
  const tree = parseCsv(path.join(RUNS, 'vertical-hpe-aruba-cx-switches-2026-08-17-local-mirror/product_tree.csv'));
  const downloads = parseCsv(path.join(RUNS, 'vertical-hpe-aruba-cx-switches-2026-08-17-local-mirror/document_download_log.csv'));
  const urls = new Map(downloads.filter((row) => row.status === 'success' && row.document_type === 'datasheet').map((row) => [hpeDocumentId(row.official_url), row.official_url]));
  const sources = tree.filter((row) => row.collection_status === '本地资料镜像已完成' && urls.has(row.official_datasheet_id)).map((row, index) => source({
    id: `hpe_aruba_cx_${String(index + 1).padStart(2, '0')}`, series: row.series, modelNames: [row.series], productPageUrl: row.product_page_url, materialPageUrl: row.datasheet_page_url,
    pdfUrl: urls.get(row.official_datasheet_id), officialFileName: urlFileName(urls.get(row.official_datasheet_id), `${slug(row.series)}.pdf`), expectedSha256: row.datasheet_sha256,
    evidencePolicy: 'hpe_datasheet_then_specifications_then_quickspecs', matchTerms: [row.series],
  }));
  return [profile({ profileId: 'hpe_aruba_cx_switches', vendorId: 'hpe', vendorName: 'HPE Networking', displayName: 'HPE Aruba CX 交换机｜已验证官方 Data sheet', domains: ['www.hpe.com', 'hpe.com'], productLine: '01 Aruba CX 交换机', libraryRoot: 'HPE Networking彩页', subseries: 'Aruba CX 已验证 Data sheet', policy: '仅采集已验证的 HPE 官方 Data sheet；型号事实遵循 Data sheet → Specifications → QuickSpecs，商城只用于固定优先级补洞。', sources })];
}

function buildCisco() {
  const rows = parseCsv(path.join(RUNS, 'vertical-cisco-switches-2026-08-18-pdf-supplement-03-exact-mapping/document_download_log.csv')).filter((row) => row.status === 'downloaded' && row.http_status === '200');
  return chunks(rows).map((group, part) => profile({
    profileId: `cisco_switches_exact_mapping_${String(part + 1).padStart(2, '0')}`, vendorId: 'cisco', vendorName: 'Cisco', displayName: `Cisco 交换机｜精确 Data sheet-PDF 映射 ${part + 1}`, domains: ['www.cisco.com', 'cisco.com'], productLine: '01 交换机', libraryRoot: 'Cisco产品彩页', subseries: `Cisco 已验证精确映射 ${part + 1}`,
    policy: '每条来源必须保持官方 Data sheet 页面到同页明确对应原始 PDF 的一对一映射；无公开 PDF 才可保留官方 HTML 并明确标注。',
    sources: group.map((row, index) => source({ id: `cisco_switch_${part + 1}_${String(index + 1).padStart(2, '0')}`, series: row.series, modelNames: [row.series], productPageUrl: row.source_datasheet_url, materialPageUrl: row.source_datasheet_url, pdfUrl: row.official_pdf_url, officialFileName: urlFileName(row.final_url || row.official_pdf_url, `${slug(row.series)}.pdf`), expectedSha256: row.sha256, evidencePolicy: 'cisco_exact_datasheet_page_to_pdf_mapping', matchTerms: seriesTerms(row.series) })),
  }));
}

function buildH3c() {
  const rows = parseCsv(path.join(RUNS, 'vertical-h3c-switches-2026-08-18-local-mirror/document_registry.csv')).filter((row) => row.status === 'success' && row.official_pdf_url && row.source_product_pages && row.pdf_filename_hint);
  return chunks(rows).map((group, part) => profile({
    profileId: `h3c_switches_verified_${String(part + 1).padStart(2, '0')}`, vendorId: 'h3c', vendorName: '新华三 H3C', displayName: `H3C 交换机｜已验证下载 ID ${part + 1}`, domains: ['www.h3c.com', 'h3c.com', 'download.h3c.com'], trustedRedirectDomains: ['dlaz.h3c.com'], productLine: '01 交换机', libraryRoot: '新华三产品彩页', subseries: `H3C 交换机已验证资料 ${part + 1}`,
    policy: '只复用准确产品页发现的 download.h3c.com 下载 ID；保留官方中文文件名、产品页关联、SHA-256 与跨类别归档规则。',
    sources: group.map((row, index) => source({ id: `h3c_switch_${part + 1}_${String(index + 1).padStart(2, '0')}`, series: row.series || row.family || row.product_name, modelNames: [row.family || row.series || row.product_name], productPageUrl: row.source_product_pages.split(/[;；]/)[0], pdfUrl: row.official_pdf_url, officialFileName: repairMojibake(row.pdf_filename_hint), expectedSha256: row.sha256, evidencePolicy: 'h3c_product_page_to_download_id_pdf', matchTerms: [...seriesTerms(row.series), ...seriesTerms(row.family)] })),
  }));
}

function buildExtreme() {
  const manifestPath = path.join(RUNS, 'extreme-networks-2026-08-20', 'extreme_public_brochures_2026-08-20_v1', 'document_manifest.json');
  const documents = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).documents
    .filter((row) => row.retrievalStatus === 'official_pdf_verified' && row.sha256 && row.pdfUrl && row.productPageUrl);
  const domainMeta = {
    'Wired Access': { id: 'wired_access', name: '01 Wired Access', category: '交换机', policy: '仅采集 Extreme 官方产品目录发现、精确系列页明确关联的 Sitecore Content Hub Data Sheet；先验证产品页关联、PDF 可读性、系列适用范围与 SHA-256。' },
    'Wireless Access': { id: 'wireless_access', name: '02 Wireless Access', category: '无线接入点', policy: '仅采集 Extreme 官方产品目录发现、精确 AP 系列页明确关联的 Sitecore Content Hub Data Sheet；不猜测 Content Hub 文件名或版本参数。' },
    'Management': { id: 'management', name: '03 Management', category: '网络管理与分析', policy: '仅采集 Extreme 官方管理产品页明确关联的公开 Data Sheet；无公开 PDF 的产品保留 needs_route_validation，不进入队列。' },
  };
  return Object.entries(domainMeta).map(([domain, meta]) => {
    const rows = documents.filter((row) => row.productDomain === domain);
    return profile({
      profileId: `extreme_${meta.id}_datasheets`, vendorId: 'extreme', vendorName: 'Extreme Networks', displayName: `Extreme ${meta.name}｜已验证官方 Data Sheet`,
      domains: ['www.extremenetworks.com', 'extremenetworks.com', 'extr-p-001.sitecorecontenthub.cloud'], productLine: meta.name, libraryRoot: 'Extreme Networks产品彩页', subseries: `Extreme ${meta.category}已验证 Data Sheet`, policy: meta.policy,
      sources: rows.map((row, index) => source({
        id: `extreme_${meta.id}_${String(index + 1).padStart(2, '0')}`, series: row.series, modelNames: [row.series], productPageUrl: row.productPageUrl, materialPageUrl: row.materialPageUrl || row.productPageUrl,
        pdfUrl: row.pdfUrl, officialFileName: row.officialFileName, expectedSha256: row.sha256, evidencePolicy: 'extreme_product_page_to_sitecore_content_hub_datasheet', matchTerms: [...new Set([row.series, row.officialFileName.replace(/\\.pdf$/i, ''), row.pdfTitle].filter(Boolean))],
      })),
    });
  });
}

function buildRuijie() {
  const rows = parseCsv(path.join(RUNS, 'vertical-ruijie-public-pdf-preview-patch-2026-08-18/document_manifest.csv')).filter((row) => row.public_access_status === 'public_anonymous_pdf_preview' && row.mime_type === 'application/pdf' && row.retrieval_status === 'downloaded' && row.official_preview_url && row.sha256);
  return chunks(rows).map((group, part) => profile({
    profileId: `ruijie_public_preview_${String(part + 1).padStart(2, '0')}`, vendorId: 'ruijie', vendorName: '锐捷网络', displayName: `锐捷公开 PreviewFile｜已验证彩页 ${part + 1}`, domains: ['www.ruijie.com.cn', 'ruijie.com.cn', 'yx.ruijie.com.cn'], trustedRedirectDomains: ['zlkfile.oss-cn-beijing.aliyuncs.com'], productLine: '01 公开彩页', libraryRoot: '锐捷网络产品彩页', subseries: `锐捷公开 PreviewFile ${part + 1}`,
    policy: '仅使用准确产品页关联的公开匿名 PreviewFile；不得枚举资源 ID、猜测签名 URL或绕过登录。若 PreviewFile 路径失效，停止并转入路径复核。',
    sources: group.map((row, index) => source({ id: row.document_id || `ruijie_preview_${part + 1}_${String(index + 1).padStart(2, '0')}`, series: row.series_or_product, modelNames: [row.series_or_product], productPageUrl: row.product_page_url, materialPageUrl: row.resource_center_url, pdfUrl: row.official_preview_url, officialFileName: row.file_name, expectedSha256: row.sha256, evidencePolicy: 'ruijie_public_previewfile_from_product_resource_chain', matchTerms: [row.series_or_product, row.resource_id].filter(Boolean) })),
  }));
}

const profiles = [...buildHpe(), ...buildCisco(), ...buildH3c(), ...buildRuijie(), ...buildExtreme()];
writeProfiles(profiles);
console.log(JSON.stringify({ revision: REVISION, count: profiles.length, profiles: profiles.map((item) => ({ profileId: item.profileId, vendorId: item.vendorId, sourceCount: item.sources.length })) }, null, 2));
