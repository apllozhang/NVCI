'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snapshotDir = process.env.P04_SOURCE_SNAPSHOT || '/home/ubuntu/runs/horizontal-ale-aruba-ethernet-switches-full-2026-08-17-v3-switch-portfolio-order';
const outputPath = process.env.P04_AUDIT_OUTPUT || path.join(__dirname, '..', 'intelligence', 'baselines', 'p04-pilot-input-audit.json');

const targets = [
  { vendor: 'ale', series: 'OmniSwitch 6360', file: 'ale_switch_master_full.csv', evidenceFile: 'ale_model_identity_evidence.csv', pdfRelativePath: 'ale_official_docs/omniswitch-6360.pdf' },
  { vendor: 'ale', series: 'OmniSwitch 6370', file: 'ale_switch_master_full.csv', evidenceFile: 'ale_model_identity_evidence.csv', pdfRelativePath: 'ale_official_docs/omniswitch-6370.pdf' },
  { vendor: 'ale', series: 'OmniSwitch 6560/E', displaySeries: 'OmniSwitch 6560 / 6560E', file: 'ale_switch_master_full.csv', evidenceFile: 'ale_model_identity_evidence.csv', pdfRelativePath: 'ale_official_docs/omniswitch-6560.pdf' },
  { vendor: 'hpe_aruba', series: 'CX 6100', file: 'aruba_cx_switch_master_full.csv', evidenceFile: 'aruba_cx_model_evidence.csv', pdfRelativePath: 'hpe_cx_official_docs/cx_cx_6100.pdf' },
  { vendor: 'hpe_aruba', series: 'CX 6200', file: 'aruba_cx_switch_master_full.csv', evidenceFile: 'aruba_cx_model_evidence.csv', pdfRelativePath: 'hpe_cx_official_docs/cx_cx_6200.pdf' },
  { vendor: 'hpe_aruba', series: 'CX 6300', file: 'aruba_cx_switch_master_full.csv', evidenceFile: 'aruba_cx_model_evidence.csv', pdfRelativePath: 'hpe_cx_official_docs/cx_cx_6300.pdf' },
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell); cell = '';
    } else if (char === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() || []).map((value) => value.replace(/^\uFEFF/, '').trim());
  return rows.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function canonicalValue(value) {
  return String(value || '').trim();
}

function isCommercialVariant(row) {
  const candidate = canonicalValue(row.variant_candidate).toLowerCase();
  return candidate === 'true' || /\btaa\b|regional|region|bundle|power cord|电源线|区域/.test(canonicalValue(row.notes).toLowerCase());
}

function evidenceAnchor(rows) {
  const anchors = new Map();
  for (const row of rows) {
    const url = canonicalValue(row.datasheet_url);
    if (!url) continue;
    anchors.set(url, {
      url,
      title: canonicalValue(row.document_title),
      accessDate: canonicalValue(row.access_date),
      sourceScope: canonicalValue(row.source_evidence_scope),
    });
  }
  return [...anchors.values()];
}

function fieldCoverage(rows) {
  const fields = ['form_factor', 'environment', 'downlink_port_count', 'downlink_speed_band', 'uplink_port_count', 'uplink_speed_band', 'poe_support', 'poe_budget_w'];
  const result = {};
  for (const field of fields) {
    const disclosed = rows.filter((row) => {
      const value = canonicalValue(row[field]);
      return value && !/未披露|n\/a|unknown/i.test(value);
    }).length;
    result[field] = { disclosedModels: disclosed, totalModels: rows.length, status: disclosed === rows.length ? 'complete' : disclosed ? 'partial' : 'not_disclosed' };
  }
  return result;
}

function evidenceIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = canonicalValue(row.model).toLowerCase();
    if (!key) continue;
    const values = index.get(key) || [];
    values.push({
      field: canonicalValue(row.field), rawValue: canonicalValue(row.raw_value), normalizedValue: canonicalValue(row.normalized_value),
      sourceUrl: canonicalValue(row.source_url), sourceTitle: canonicalValue(row.source_title), sourceType: canonicalValue(row.source_type),
      accessDate: canonicalValue(row.access_date), quote: canonicalValue(row.evidence_quote), locator: canonicalValue(row.location_hint), status: canonicalValue(row.evidence_status),
    });
    index.set(key, values);
  }
  return index;
}

function compactModel(row, modelEvidence = []) {
  return {
    model: canonicalValue(row.model),
    sku: canonicalValue(row.sku),
    technicalModelId: canonicalValue(row.technical_model_id),
    formFactor: canonicalValue(row.form_factor),
    environment: canonicalValue(row.environment),
    downlinkPortCount: canonicalValue(row.downlink_port_count),
    downlinkPortCountNumeric: Number(row.port_count_numeric || row.downlink_port_count_order || 0) || 0,
    downlinkMediaGroup: canonicalValue(row.downlink_media_group),
    downlinkSpeedBand: canonicalValue(row.downlink_speed_band),
    uplinkPortCount: canonicalValue(row.uplink_port_count),
    uplinkSpeedBand: canonicalValue(row.uplink_speed_band),
    poeSupport: canonicalValue(row.poe_support),
    poeBudgetW: canonicalValue(row.poe_budget_w),
    datasheetUrl: canonicalValue(row.datasheet_url),
    evidenceScope: canonicalValue(row.source_evidence_scope),
    evidenceQuote: canonicalValue(row.datasheet_quote),
    evidence: modelEvidence,
  };
}

const manifestPath = path.join(snapshotDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sourceHashes = {};
const baseline = [];

for (const target of targets) {
  const csvPath = path.join(snapshotDir, target.file);
  if (!sourceHashes[target.file]) sourceHashes[target.file] = sha256(csvPath);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((row) => canonicalValue(row.series) === target.series);
  const evidencePath = path.join(snapshotDir, target.evidenceFile);
  if (!sourceHashes[target.evidenceFile]) sourceHashes[target.evidenceFile] = sha256(evidencePath);
  const evidenceRows = parseCsv(fs.readFileSync(evidencePath, 'utf8')).filter((row) => canonicalValue(row.series) === target.series);
  const evidenceByModel = evidenceIndex(evidenceRows);
  const technicalRows = rows.filter((row) => !isCommercialVariant(row));
  if (!technicalRows.length) throw new Error(`未找到 ${target.series} 的基础技术型号。`);
  const pdfPath = path.join(snapshotDir, target.pdfRelativePath);
  if (!fs.existsSync(pdfPath)) throw new Error(`缺少 ${target.series} 的本地官方 PDF：${target.pdfRelativePath}`);
  baseline.push({
    vendor: target.vendor,
    series: target.displaySeries || target.series,
    sourceSeriesKey: target.series,
    sourceFile: target.file,
    sourceFileSha256: sourceHashes[target.file],
    evidenceFile: target.evidenceFile,
    evidenceFileSha256: sourceHashes[target.evidenceFile],
    documentRevision: {
      relativePath: target.pdfRelativePath,
      sha256: sha256(pdfPath),
      bytes: fs.statSync(pdfPath).size,
    },
    totalRows: rows.length,
    technicalModelCount: technicalRows.length,
    commercialVariantRowsExcluded: rows.length - technicalRows.length,
    officialEvidenceAnchors: evidenceAnchor(technicalRows),
    hardGateCoverage: fieldCoverage(technicalRows),
    models: technicalRows.map((row) => compactModel(row, evidenceByModel.get(canonicalValue(row.model).toLowerCase()) || [])),
  });
}

const output = {
  auditType: 'p04_pilot_model_input_audit',
  generatedAt: new Date().toISOString(),
  sourceSnapshot: {
    snapshotId: manifest.snapshot_id,
    createdAt: manifest.created_at,
    status: manifest.status,
    sourcePolicy: manifest.official_source_policy,
    manifestSha256: sha256(manifestPath),
  },
  rules: {
    technicalModelKey: 'vendor|series|sku',
    commercialVariantsExcluded: true,
    allowedEvidence: ['official_datasheet', 'official_order_information'],
    hardGates: ['form_factor', 'environment', 'downlink_port_count', 'downlink_speed_band', 'poe_support'],
    softwareEvidenceRestriction: 'series_or_platform_only不得作为SKU级对标结论',
  },
  series: baseline,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, series: baseline.map((item) => ({ vendor: item.vendor, series: item.series, technicalModelCount: item.technicalModelCount, anchors: item.officialEvidenceAnchors.length })), sourceSnapshot: output.sourceSnapshot }, null, 2));
