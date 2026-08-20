#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const inputPath = process.argv[2] || '/home/ubuntu/extract_ale_switch_field_facts.json';
const outputPath = process.argv[3] || '/home/ubuntu/runs/ale-field-fact-extraction-2026-08-20/audited_field_facts.json';
const configPath = path.join(projectRoot, 'automation', 'bundled-profiles', 'ale_omniswitch.json');

const FIELD_CODES = [
  'form_factor', 'downlink_ports', 'downlink_speed', 'uplink_ports', 'uplink_speed',
  'poe_support', 'poe_budget', 'switching_capacity', 'forwarding_rate',
  'stacking_virtualization', 'max_stack_members', 'l3_routing', 'ospf_support',
  'vxlan_evpn_support', 'automation_api', 'management_platform', 'acl_security',
];
const VALID_STATUS = new Set(['verified', 'not_disclosed', 'needs_review']);
const OFFICIAL_HOST = /(^|\.)al-enterprise\.com$/i;
const ABSENCE_PATTERN = /not\s+(mentioned|supported|disclosed)|未提及|未披露|不支持/i;

function ensureDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function text(value) { return String(value ?? '').trim(); }
function officialUrl(url) {
  try { return OFFICIAL_HOST.test(new URL(url).hostname); } catch { return false; }
}
function parseOutput(result) {
  const raw = text(result?.output?.fields_json);
  if (!raw) return { facts: null, error: 'empty_fields_json' };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { facts: parsed, error: '' } : { facts: null, error: 'fields_json_not_array' };
  } catch (error) {
    return { facts: null, error: `invalid_json:${error.message}` };
  }
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const knownSources = new Map();
for (const item of config?.sources || []) {
  const key = text(item.series || item.name);
  if (!key) continue;
  knownSources.set(key, new Set([text(item.pdfUrl), text(item.productPageUrl), text(item.url), text(item.datasheetUrl)].filter(Boolean)));
}

const audit = {
  generatedAt: new Date().toISOString(),
  inputPath,
  configPath,
  policy: {
    acceptedVerified: '字段必须包含官方 ALE URL、非空引用摘录与明确定位；以“未提及/不支持”推导的结论不得标记为 verified。',
    notDisclosed: '当前受控官方资料未明确披露时保留 not_disclosed，不将缺失资料等同于不支持。',
    needsReview: 'JSON 结构损坏、未知字段、非官方 URL、来源不在受控资料配置或证据不完整时降级为 needs_review。',
  },
  series: [],
  totals: { series: 0, facts: 0, verified: 0, not_disclosed: 0, needs_review: 0, malformed_series: 0 },
};

for (const result of source.results || []) {
  const seriesName = text(result.input || result?.output?.series_name);
  const { facts, error } = parseOutput(result);
  const expectedSources = knownSources.get(seriesName) || new Set();
  const seen = new Set();
  const normalized = [];
  const issues = [];

  if (!facts) {
    audit.totals.malformed_series += 1;
    for (const fieldCode of FIELD_CODES) {
      normalized.push({
        seriesName,
        fieldCode,
        status: 'needs_review',
        rawValue: '',
        normalizedValue: '',
        unit: '',
        conditions: '并行抽取结果结构异常，必须重新按官方资料核对。',
        sourceUrl: '',
        sourceTitle: '',
        sourceLocator: '',
        evidenceQuote: '',
        auditReason: error,
      });
    }
    issues.push(error);
  } else {
    const byCode = new Map();
    for (const item of facts) {
      const code = text(item.field_code);
      if (!FIELD_CODES.includes(code)) { issues.push(`unknown_field:${code || 'empty'}`); continue; }
      if (byCode.has(code)) { issues.push(`duplicate_field:${code}`); continue; }
      byCode.set(code, item);
    }
    for (const fieldCode of FIELD_CODES) {
      const item = byCode.get(fieldCode);
      if (!item) {
        normalized.push({
          seriesName, fieldCode, status: 'needs_review', rawValue: '', normalizedValue: '', unit: '',
          conditions: '该字段未从抽取结果返回，必须重新核对官方资料。', sourceUrl: '', sourceTitle: '', sourceLocator: '', evidenceQuote: '', auditReason: 'missing_field',
        });
        issues.push(`missing_field:${fieldCode}`);
        continue;
      }
      const sourceUrl = text(item.source_url);
      const quote = text(item.evidence_quote);
      const locator = text(item.source_locator);
      let status = VALID_STATUS.has(text(item.status)) ? text(item.status) : 'needs_review';
      let auditReason = '';
      const absenceDerived = ABSENCE_PATTERN.test(`${text(item.raw_value)} ${quote}`);
      const sourceKnown = expectedSources.size === 0 || expectedSources.has(sourceUrl);
      if (!officialUrl(sourceUrl)) { status = 'needs_review'; auditReason = 'non_official_source_url'; }
      else if (!sourceKnown) { status = 'needs_review'; auditReason = 'source_not_in_controlled_ale_profile'; }
      else if (status === 'verified' && (!quote || !locator)) { status = 'needs_review'; auditReason = 'missing_explicit_quote_or_locator'; }
      else if (status === 'verified' && absenceDerived) { status = 'not_disclosed'; auditReason = 'absence_cannot_prove_not_supported'; }
      else if (status === 'not_disclosed' && !sourceUrl) { status = 'needs_review'; auditReason = 'not_disclosed_requires_controlled_source'; }

      normalized.push({
        seriesName,
        fieldCode,
        status,
        rawValue: text(item.raw_value),
        normalizedValue: text(item.normalized_value),
        unit: text(item.unit),
        conditions: text(item.conditions),
        sourceUrl,
        sourceTitle: text(item.source_title),
        sourceLocator: locator,
        evidenceQuote: quote,
        auditReason,
      });
      if (auditReason) issues.push(`${fieldCode}:${auditReason}`);
    }
  }

  const summary = { verified: 0, not_disclosed: 0, needs_review: 0 };
  for (const fact of normalized) { summary[fact.status] += 1; audit.totals[fact.status] += 1; audit.totals.facts += 1; }
  audit.totals.series += 1;
  audit.series.push({
    seriesName,
    fieldFacts: normalized,
    summary,
    issues,
    sourceGapSummary: text(result?.output?.source_gap_summary),
  });
}

ensureDir(outputPath);
fs.writeFileSync(outputPath, JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ outputPath, totals: audit.totals, series: audit.series.map((row) => ({ seriesName: row.seriesName, summary: row.summary, issues: row.issues })) }, null, 2));
