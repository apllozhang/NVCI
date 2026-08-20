'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createIntelligenceCore } = require('../intelligence-core');

const IMPORTER_NAME = 'p04-controlled-model-relationship-importer';
const TASK_TITLE = 'ALE OmniSwitch 与 HPE Aruba CX 型号级对标试点';
const FIELD_DEFINITIONS = [
  { code: 'model_name', key: 'model', aliases: ['model_identity', 'model'] },
  { code: 'sku', key: 'sku', aliases: ['model_identity', 'sku'] },
  { code: 'form_factor', key: 'formFactor', aliases: ['form_factor', 'model_identity', 'model_description'] },
  { code: 'environment', key: 'environment', aliases: ['environment', 'model_identity', 'model_description'] },
  { code: 'downlink_media', key: 'downlinkMediaGroup', aliases: ['downlink_port_count', 'model_identity', 'model_description'] },
  { code: 'downlink_port_count', key: 'downlinkPortCount', aliases: ['downlink_port_count', 'model_identity', 'model_description'] },
  { code: 'downlink_speed_band', key: 'downlinkSpeedBand', aliases: ['downlink_speed_band', 'downlink_port_count', 'model_identity', 'model_description'] },
  { code: 'uplink_port_count', key: 'uplinkPortCount', aliases: ['uplink_port_count', 'model_identity', 'model_description'] },
  { code: 'uplink_speed_band', key: 'uplinkSpeedBand', aliases: ['uplink_speed_band', 'uplink_port_count', 'model_identity', 'model_description'] },
  { code: 'poe_support', key: 'poeSupport', aliases: ['poe_support', 'model_identity', 'model_description'] },
  { code: 'poe_budget_w', key: 'poeBudgetW', aliases: ['poe_budget_w', 'model_identity', 'model_description'] },
];
const HARD_GATE_CODES = ['form_factor', 'environment', 'downlink_media', 'downlink_port_count', 'downlink_speed_band', 'poe_support'];

function now() { return new Date().toISOString(); }
function arg(argv, name, fallback = '') { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback; }
function text(value) { return String(value ?? '').trim(); }
function stableId(prefix, value) { return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`; }
function parseJson(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }

function loadAudit(auditPath) {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  if (audit?.auditType !== 'p04_pilot_model_input_audit' || !Array.isArray(audit.series) || audit.series.length !== 6) {
    throw new Error('P0-4 审计基线无效或不是首批六个目标系列。');
  }
  return audit;
}

function valueFor(model, key) {
  if (key === 'downlinkMediaGroup') return text(model.downlinkMediaGroup);
  return text(model[key]);
}

function evidenceFor(model, definition) {
  const rows = Array.isArray(model.evidence) ? model.evidence : [];
  return rows.find((row) => text(row.field) === definition.code)
    || rows.find((row) => text(row.field) === definition.aliases[0])
    || rows.find((row) => definition.aliases.includes(text(row.field)))
    || null;
}

function quoteSupportsField(definition, rawValue, evidence) {
  const quote = text(evidence?.quote).toLowerCase();
  if (!quote || !rawValue) return false;
  if (definition.code === 'environment') return false;
  if (text(evidence.field) === definition.code || text(evidence.field) === definition.aliases[0]) return true;
  if (definition.code === 'model_name' || definition.code === 'sku') return true;
  if (text(evidence.field) !== 'model_identity') return false;
  if (definition.code === 'form_factor') return /fixed|1\s*ru|1u|rack|chassis/.test(quote);
  if (definition.code === 'downlink_media') return /rj[- ]?45|base[- ]?t|sfp|fiber|optical/.test(quote);
  if (definition.code === 'downlink_port_count') return /\b(8|10|12|16|24|32|46|48)\b/.test(quote);
  if (definition.code === 'downlink_speed_band' || definition.code === 'uplink_speed_band') return /10g|2\.5g|1g|1000|sfp\+|base[- ]?t/.test(quote);
  if (definition.code === 'uplink_port_count') return /uplink|sfp|sfp\+|qsfp/.test(quote);
  if (definition.code === 'poe_support') return /poe|802\.3af|802\.3at|802\.3bt|hpoe/.test(quote);
  if (definition.code === 'poe_budget_w') return /\b\d{2,4}\s*w\b/.test(quote);
  return false;
}

function sourceFor(model, definition) {
  const evidence = evidenceFor(model, definition);
  const rawValue = valueFor(model, definition.key);
  if (quoteSupportsField(definition, rawValue, evidence)) {
    return {
      status: 'evidence_verified', evidenceStatus: 'official_explicit', scope: 'sku', sourceUrl: evidence.sourceUrl || model.datasheetUrl,
      quote: evidence.quote, locator: evidence.locator || evidence.sourceType || 'P0-4 历史官方型号证据表', sourceTitle: evidence.sourceTitle || '', rawValue,
    };
  }
  if (definition.code === 'environment' && rawValue) {
    return {
      status: 'needs_review', evidenceStatus: 'series_or_platform_only', scope: 'series', sourceUrl: model.datasheetUrl,
      quote: '历史产品地图将该型号归为园区环境；当前基线未包含可重放的型号级环境原文。该信息只能作为系列边界使用。', locator: 'P0-4 输入审计：环境证据粒度不足', sourceTitle: '', rawValue,
    };
  }
  if (rawValue) {
    return {
      status: 'needs_review', evidenceStatus: 'needs_review', scope: 'sku', sourceUrl: model.datasheetUrl,
      quote: '历史受控型号主表包含该值，但缺少可重放的逐字段原文摘录；需复核官方 Data sheet。', locator: 'P0-4 输入审计：缺少字段级原文', sourceTitle: '', rawValue,
    };
  }
  return {
    status: 'not_disclosed', evidenceStatus: 'official_not_disclosed', scope: 'sku', sourceUrl: model.datasheetUrl,
    quote: '受控历史型号基线未发现该字段的官方披露；未披露不代表不支持。', locator: 'P0-4 输入审计：官方未披露', sourceTitle: '', rawValue: '',
  };
}

function canonicalForm(value) { return /fixed|1u|1ru|½ rack/i.test(value) ? 'fixed' : /modular|slot|frame/i.test(value) ? 'modular' : 'unknown'; }
function canonicalEnvironment(value) { return /industrial|rugged|hazard|outdoor|加固|工业|危险|室外/i.test(value) ? 'industrial' : /campus|branch|smb|园区|办公/i.test(value) ? 'campus' : 'unknown'; }
function canonicalMedia(value) {
  const copper = /rj[- ]?45|base[- ]?t|copper|铜缆|铜口|电口/i.test(value);
  const fiber = /sfp|fiber|optical|base[- ]?x|光口|光纤|全光/i.test(value);
  if (copper && fiber) return 'hybrid';
  if (copper) return 'copper';
  if (fiber) return 'fiber';
  return 'unknown';
}
function poeState(value) { return /non[- ]?poe|no poe|无\s*poe/i.test(value) ? 'no_poe' : /poe|802\.3af|802\.3at|802\.3bt|hpoe/i.test(value) ? 'poe' : 'unknown'; }
function speedSet(value) {
  const set = new Set();
  const source = text(value).toLowerCase();
  if (/400g/.test(source)) set.add('400G');
  if (/200g/.test(source)) set.add('200G');
  if (/100g/.test(source)) set.add('100G');
  if (/50g/.test(source)) set.add('50G');
  if (/40g/.test(source)) set.add('40G');
  if (/25g/.test(source)) set.add('25G');
  if (/10g|sfp\+/.test(source)) set.add('10G');
  if (/5g/.test(source)) set.add('5G');
  if (/2\.5g|2500/.test(source)) set.add('2.5G');
  if (/1g|1000/.test(source)) set.add('1G');
  if (/100m|100\//.test(source)) set.add('100M');
  return set;
}
function intersects(left, right) { return [...left].some((value) => right.has(value)); }
function isSuperset(left, right) { return [...right].every((value) => left.has(value)) && left.size > right.size; }
function compactGate(value, status, outcome, reason = '') { return { value, evidenceState: status, outcome, reason }; }

function modelEntityNaturalKey(seriesAudit, model) { return `${seriesAudit.sourceSeriesKey || seriesAudit.series}|${model.sku}`.toLowerCase(); }

function ensureSeriesAndDocument(core, seriesAudit, dataDir, summary) {
  const vendorId = seriesAudit.vendor;
  const vendorName = vendorId === 'ale' ? 'ALE' : 'HPE Aruba Networking';
  const productName = vendorId === 'ale' ? 'OmniSwitch' : 'Aruba CX';
  const vendor = core.upsertEntity({ entityType: 'vendor', vendorId, canonicalName: vendorName, naturalKey: vendorId, sourceState: 'verified', attributes: { sourcePolicy: vendorId === 'ale' ? 'official_datasheet_and_order_information' : 'official_hpe_datasheet_primary' } });
  summary[vendor.existed ? 'reused' : 'created'].entities += 1;
  const productLine = core.upsertEntity({ entityType: 'product_line', vendorId, parentEntityId: vendor.entity_id, canonicalName: productName, naturalKey: productName.toLowerCase(), sourceState: 'verified', attributes: { productDomain: 'wired_switching' } });
  summary[productLine.existed ? 'reused' : 'created'].entities += 1;
  const seriesNaturalKey = (seriesAudit.sourceSeriesKey || seriesAudit.series).toLowerCase();
  const series = core.upsertEntity({ entityType: 'series', vendorId, parentEntityId: productLine.entity_id, canonicalName: seriesAudit.sourceSeriesKey || seriesAudit.series, naturalKey: seriesNaturalKey, sourceState: 'verified', attributes: { displayName: seriesAudit.series, productDomain: 'wired_switching', p04Pilot: true, sourceSnapshotId: seriesAudit.sourceSnapshotId || '' } });
  summary[series.existed ? 'reused' : 'created'].entities += 1;
  const canonicalUrl = seriesAudit.officialEvidenceAnchors[0]?.url || seriesAudit.models[0]?.datasheetUrl;
  const existingDocument = core.db.prepare('SELECT * FROM documents WHERE vendor_id = ? AND series_entity_id = ? AND canonical_url = ? ORDER BY updated_at DESC LIMIT 1').get(vendorId, series.entity_id, canonicalUrl);
  const document = existingDocument ? { ...existingDocument, existed: true } : core.upsertDocument({
    vendorId, seriesEntityId: series.entity_id, documentType: 'datasheet', title: seriesAudit.officialEvidenceAnchors[0]?.title || `${seriesAudit.series} 官方 Data sheet`, canonicalUrl,
    logicalKey: `p04:${vendorId}:${seriesNaturalKey}:${seriesAudit.documentRevision.sha256.slice(0, 12)}`, sourceState: 'verified',
    attributes: { p04Pilot: true, sourceSnapshotId: seriesAudit.sourceSnapshotId || '', historicalRelativePath: seriesAudit.documentRevision.relativePath },
  });
  summary[document.existed ? 'reused' : 'created'].documents += 1;
  const revision = core.upsertRevision({
    documentId: document.document_id, sha256: seriesAudit.documentRevision.sha256, officialFileName: path.basename(seriesAudit.documentRevision.relativePath),
    localPath: `p04-reference:${seriesAudit.documentRevision.relativePath}`, sourceProfilePath: 'intelligence/baselines/p04-pilot-input-audit.json',
    snapshotId: `historical:${seriesAudit.sourceSnapshotId || 'p04-pilot'}`, revisionState: 'verified_reference', collectedAt: seriesAudit.auditGeneratedAt || now(),
    metadata: { p04Pilot: true, sourceBytes: seriesAudit.documentRevision.bytes, sourceFileSha256: seriesAudit.sourceFileSha256, evidenceFileSha256: seriesAudit.evidenceFileSha256, dataDir },
  });
  summary[revision.existed ? 'reused' : 'created'].revisions += 1;
  return { series, document, revision };
}

function importModel(core, seriesAudit, seriesContext, model, task, audit, summary, actor) {
  const entity = core.upsertEntity({
    entityType: 'model', vendorId: seriesAudit.vendor, parentEntityId: seriesContext.series.entity_id, canonicalName: model.model, naturalKey: modelEntityNaturalKey(seriesAudit, model), sourceState: 'verified',
    attributes: { sku: model.sku, technicalModelId: model.technicalModelId, series: seriesAudit.series, sourceSnapshotId: audit.sourceSnapshot.snapshotId, commercialVariantExcluded: true },
  });
  summary[entity.existed ? 'reused' : 'created'].entities += 1;
  const evidenceByField = {};
  const stateByField = {};
  for (const definition of FIELD_DEFINITIONS) {
    const source = sourceFor(model, definition);
    const evidence = core.upsertEvidence({ revisionId: seriesContext.revision.revision_id, entityId: entity.entity_id, fieldCode: definition.code, sourceUrl: source.sourceUrl || seriesContext.document.canonical_url, quoteText: source.quote, locator: source.locator, evidenceScope: source.scope, evidenceStatus: source.evidenceStatus });
    summary[evidence.existed ? 'reused' : 'created'].evidence += 1;
    const fact = core.upsertFact({
      entityId: entity.entity_id, fieldCode: definition.code,
      value: { rawValue: source.rawValue, normalizedValue: source.rawValue, sourceTitle: source.sourceTitle, extractionStatus: source.status },
      conditions: { evidenceScope: source.scope, sourceSnapshotId: audit.sourceSnapshot.snapshotId, sourceFileSha256: seriesAudit.sourceFileSha256, evidenceFileSha256: seriesAudit.evidenceFileSha256, revisionSha256: seriesContext.revision.sha256, importer: IMPORTER_NAME },
      evidenceId: evidence.evidence_id, publicationState: source.status,
    });
    summary[fact.existed ? 'reused' : 'created'].facts += 1;
    evidenceByField[definition.code] = evidence.evidence_id;
    stateByField[definition.code] = source.status;
    if (source.status === 'needs_review' && definition.code !== 'environment') {
      const review = core.upsertReviewItem({
        naturalKey: `p04-model-field:${entity.entity_id}:${definition.code}:${seriesContext.revision.sha256}`, queueType: 'field_fact', objectType: 'fact', objectId: fact.fact_id, taskId: task.task_id,
        title: `复核 ${model.sku}｜${definition.code} 的型号级官方证据`, reason: source.quote, severity: 'medium', owner: actor,
        source: { vendorId: seriesAudit.vendor, series: seriesAudit.series, sku: model.sku, fieldCode: definition.code, sourceUrl: source.sourceUrl, importRun: IMPORTER_NAME }, status: 'open',
      });
      summary[review.existed ? 'reused' : 'created'].reviews += 1;
    }
  }
  core.recordImportItem({ importRunId: task.importRunId, sourceKey: `${seriesAudit.vendor}:${seriesAudit.sourceSeriesKey}:${model.sku}`, targetType: 'model', targetId: entity.entity_id, action: entity.existed ? 'reused' : 'created', detail: { series: seriesAudit.series, sku: model.sku, documentRevision: seriesContext.revision.sha256 } });
  return { entity, model, evidenceByField, stateByField };
}

function evaluatePair(left, right) {
  const gates = {};
  const reasons = [];
  const leftForm = canonicalForm(left.model.formFactor); const rightForm = canonicalForm(right.model.formFactor);
  const leftEnvironment = canonicalEnvironment(left.model.environment); const rightEnvironment = canonicalEnvironment(right.model.environment);
  const leftMedia = canonicalMedia(left.model.downlinkMediaGroup || left.model.downlinkPortCount); const rightMedia = canonicalMedia(right.model.downlinkMediaGroup || right.model.downlinkPortCount);
  const leftCount = Number(left.model.downlinkPortCountNumeric || 0); const rightCount = Number(right.model.downlinkPortCountNumeric || 0);
  const leftSpeeds = speedSet(left.model.downlinkSpeedBand); const rightSpeeds = speedSet(right.model.downlinkSpeedBand);
  const leftPoe = poeState(left.model.poeSupport); const rightPoe = poeState(right.model.poeSupport);
  const gateState = (code) => left.stateByField[code] === 'evidence_verified' && right.stateByField[code] === 'evidence_verified';
  const addGate = (code, leftValue, rightValue, passed, reason) => { gates[code] = { subject: compactGate(leftValue, left.stateByField[code] || 'needs_review', passed ? 'pass' : 'fail', reason), counterpart: compactGate(rightValue, right.stateByField[code] || 'needs_review', passed ? 'pass' : 'fail', reason), verified: gateState(code) }; };

  const formPass = leftForm !== 'unknown' && leftForm === rightForm; addGate('form_factor', leftForm, rightForm, formPass, formPass ? '' : '固定/模块化形态不一致或未证实'); if (!formPass) reasons.push('form_factor');
  const environmentPass = leftEnvironment !== 'unknown' && leftEnvironment === rightEnvironment; addGate('environment', leftEnvironment, rightEnvironment, environmentPass, environmentPass ? '' : '部署环境不一致或未证实'); if (!environmentPass) reasons.push('environment');
  const mediaPass = leftMedia !== 'unknown' && leftMedia === rightMedia; addGate('downlink_media', leftMedia, rightMedia, mediaPass, mediaPass ? '' : '下行介质不一致或未证实'); if (!mediaPass) reasons.push('downlink_media');
  const portPass = leftCount > 0 && rightCount > 0 && (leftCount / rightCount) >= 0.5 && (leftCount / rightCount) <= 2; addGate('downlink_port_count', leftCount, rightCount, portPass, portPass ? '' : '下行端口数量未处于 0.5×–2.0× 可解释窗口'); if (!portPass) reasons.push('downlink_port_count');
  const speedPass = leftSpeeds.size && rightSpeeds.size && intersects(leftSpeeds, rightSpeeds); addGate('downlink_speed_band', [...leftSpeeds], [...rightSpeeds], speedPass, speedPass ? '' : '下行速率带不相交或未证实'); if (!speedPass) reasons.push('downlink_speed_band');
  const poePass = leftPoe !== 'unknown' && rightPoe !== 'unknown' && leftPoe === rightPoe; addGate('poe_support', leftPoe, rightPoe, poePass, poePass ? '' : 'PoE 需求不一致或未证实'); if (!poePass) reasons.push('poe_support');

  const allPass = !reasons.length;
  const hardwareGateCodes = HARD_GATE_CODES.filter((code) => code !== 'environment');
  const allHardwareGateEvidenceVerified = hardwareGateCodes.every((code) => gates[code].verified);
  const environmentEvidenceVerified = gates.environment.verified;
  const dimensions = {
    downlinkPorts: leftCount === rightCount ? 'matched' : allPass ? 'partial' : 'not_matched',
    downlinkSpeed: speedPass ? (JSON.stringify([...leftSpeeds]) === JSON.stringify([...rightSpeeds]) ? 'matched' : 'partial') : 'not_matched',
    uplink: left.stateByField.uplink_speed_band === 'evidence_verified' && right.stateByField.uplink_speed_band === 'evidence_verified' ? 'needs_validation' : 'needs_validation',
    poeBudget: left.stateByField.poe_budget_w === 'evidence_verified' && right.stateByField.poe_budget_w === 'evidence_verified' ? 'needs_validation' : 'not_disclosed',
    software: 'needs_validation',
  };
  const deviations = [];
  if (leftCount !== rightCount) deviations.push(`下行端口：${leftCount} ↔ ${rightCount}`);
  if (speedPass && JSON.stringify([...leftSpeeds]) !== JSON.stringify([...rightSpeeds])) deviations.push(`下行速率带：${[...leftSpeeds].join('/')} ↔ ${[...rightSpeeds].join('/')}`);
  if (left.model.uplinkSpeedBand !== right.model.uplinkSpeedBand) deviations.push(`上联：${left.model.uplinkSpeedBand || '未披露'} ↔ ${right.model.uplinkSpeedBand || '未披露'}`);
  if (left.model.poeBudgetW !== right.model.poeBudgetW) deviations.push(`PoE 预算：${left.model.poeBudgetW || '未披露'} ↔ ${right.model.poeBudgetW || '未披露'}`);

  let matchStatus = 'not_comparable';
  let reviewState = 'candidate';
  let rationale = `首层门槛：形态 ${leftForm}/${rightForm}；环境 ${leftEnvironment}/${rightEnvironment}；下行介质 ${leftMedia}/${rightMedia}；端口 ${leftCount}/${rightCount}；PoE ${leftPoe}/${rightPoe}。`;
  const decisiveFailureCodes = ['form_factor', 'downlink_media', 'downlink_port_count', 'downlink_speed_band', 'poe_support']
    .filter((code) => gates[code].subject.outcome === 'fail' && gates[code].verified);
  if (decisiveFailureCodes.length) {
    matchStatus = 'not_comparable';
    reviewState = 'candidate';
    rationale += ` 已核验硬门槛不通过：${decisiveFailureCodes.join(', ')}。`;
  } else if (!allPass) {
    matchStatus = 'insufficient_evidence';
    reviewState = 'review_required';
    rationale += ' 硬门槛存在未证实或未披露项，不能得出候选结论。';
  } else if (!allHardwareGateEvidenceVerified) {
    matchStatus = 'insufficient_evidence'; reviewState = 'review_required'; rationale += ' 硬件首层门槛逻辑通过，但至少一项缺少可审计型号级证据。';
  } else if (leftCount === rightCount && JSON.stringify([...leftSpeeds]) === JSON.stringify([...rightSpeeds])) {
    matchStatus = 'direct_candidate'; reviewState = environmentEvidenceVerified ? 'candidate' : 'review_required';
  } else if (isSuperset(leftSpeeds, rightSpeeds) || isSuperset(rightSpeeds, leftSpeeds) || Math.max(leftCount, rightCount) / Math.min(leftCount, rightCount) > 1.5) {
    matchStatus = 'adjacent_upgrade'; reviewState = environmentEvidenceVerified ? 'candidate' : 'review_required';
  } else {
    matchStatus = 'partial_candidate'; reviewState = environmentEvidenceVerified ? 'candidate' : 'review_required';
  }
  return {
    matchStatus, reviewState, hardGates: gates, dimensions, rationale, keyDeviations: deviations.join('；'), disqualificationReason: allPass ? '' : reasons.join(', '),
    validationQuestions: [
      `请确认双方在目标软件版本与许可下的 OSPFv2/v3、ECMP、堆叠/虚拟化与路由规模。`,
      `请确认 ${left.model.sku} 与 ${right.model.sku} 的上联光模块、PoE 预算、电源冗余和部署温度符合项目要求。`,
    ],
  };
}

function planImport({ dataDir, auditPath }) {
  const audit = loadAudit(auditPath);
  const ale = audit.series.filter((series) => series.vendor === 'ale');
  const aruba = audit.series.filter((series) => series.vendor === 'hpe_aruba');
  if (ale.length !== 3 || aruba.length !== 3) throw new Error('P0-4 试点必须恰好包含 3 个 ALE 与 3 个 HPE Aruba 系列。');
  const modelCount = audit.series.reduce((sum, series) => sum + series.models.length, 0);
  return {
    audit, modelCount, candidatePairs: ale.reduce((sum, left) => sum + left.models.length, 0) * aruba.reduce((sum, right) => sum + right.models.length, 0),
    sourceSnapshot: audit.sourceSnapshot, expectedSeries: audit.series.map((series) => ({ vendor: series.vendor, series: series.series, models: series.models.length })), dataDir,
  };
}

function executeImport({ dataDir, auditPath, actor = 'local-admin' }) {
  const plan = planImport({ dataDir, auditPath });
  const core = createIntelligenceCore(dataDir);
  const run = core.startImport({ importerName: IMPORTER_NAME, mode: 'controlled_model_relationship_import', sourceDescriptor: { auditPath, sourceSnapshot: plan.sourceSnapshot, modelCount: plan.modelCount, candidatePairs: plan.candidatePairs, actor } });
  const summary = { created: { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0, relationships: 0, relationEvidence: 0, reviews: 0 }, reused: { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0, relationships: 0, relationEvidence: 0, reviews: 0 }, models: plan.modelCount, candidatePairs: plan.candidatePairs, relationshipStates: {} };
  try {
    core.transaction(() => {
      const task = core.upsertResearchTask({ title: TASK_TITLE, mode: 'horizontal', decisionQuestion: '基于型号级官方资料，识别 ALE OmniSwitch 6360/6370/6560 与 HPE Aruba CX 6100/6200/6300 的直接、部分、相邻升级、不可比和证据不足关系，服务产品定型与采购验证。', scope: { vendorIds: ['ale', 'hpe_aruba'], productDomain: 'wired_switching', subjectSeries: ['OmniSwitch 6360', 'OmniSwitch 6370', 'OmniSwitch 6560/E'], counterpartSeries: ['CX 6100', 'CX 6200', 'CX 6300'], relationType: 'model_to_model', modelCount: plan.modelCount }, priority: 'high', status: 'relation_review', baselineDescriptor: { auditPath, sourceSnapshot: plan.sourceSnapshot, evidenceRule: 'official_datasheet_and_order_information_only', createdBy: IMPORTER_NAME }, owner: actor });
      const imported = [];
      for (const seriesAudit of plan.audit.series) {
        seriesAudit.sourceSnapshotId = plan.sourceSnapshot.snapshotId; seriesAudit.auditGeneratedAt = plan.audit.generatedAt;
        const seriesContext = ensureSeriesAndDocument(core, seriesAudit, dataDir, summary);
        for (const model of seriesAudit.models) imported.push({ vendor: seriesAudit.vendor, seriesAudit, ...importModel(core, seriesAudit, seriesContext, model, { ...task, importRunId: run.import_run_id }, plan.audit, summary, actor) });
      }
      const subjects = imported.filter((item) => item.vendor === 'ale');
      const counterparts = imported.filter((item) => item.vendor === 'hpe_aruba');
      const perSubject = new Map();
      for (const subject of subjects) {
        const relationships = [];
        for (const counterpart of counterparts) {
          const evaluation = evaluatePair(subject, counterpart);
          relationships.push({ counterpart, evaluation });
        }
        relationships.sort((left, right) => {
          const order = { direct_candidate: 0, partial_candidate: 1, adjacent_upgrade: 2, insufficient_evidence: 3, not_comparable: 4 };
          return order[left.evaluation.matchStatus] - order[right.evaluation.matchStatus] || left.counterpart.model.sku.localeCompare(right.counterpart.model.sku);
        });
        perSubject.set(subject.entity.entity_id, relationships);
      }
      for (const subject of subjects) {
        const relationships = perSubject.get(subject.entity.entity_id);
        relationships.forEach(({ counterpart, evaluation }, index) => {
          const relationship = core.upsertComparisonRelationship({
            naturalKey: `p04-pilot|${subject.entity.entity_id}|${counterpart.entity.entity_id}`, taskId: task.task_id, subjectEntityId: subject.entity.entity_id, counterpartEntityId: counterpart.entity.entity_id,
            matchStatus: evaluation.matchStatus, reviewState: evaluation.reviewState, candidateRank: index + 1, hardGates: evaluation.hardGates, dimensions: evaluation.dimensions,
            rationale: evaluation.rationale, keyDeviations: evaluation.keyDeviations, disqualificationReason: evaluation.disqualificationReason, validationQuestions: evaluation.validationQuestions,
            sourceSnapshot: { snapshotId: plan.sourceSnapshot.snapshotId, manifestSha256: plan.sourceSnapshot.manifestSha256, auditPath: path.basename(auditPath), auditGeneratedAt: plan.audit.generatedAt },
          });
          summary[relationship.existed ? 'reused' : 'created'].relationships += 1;
          summary.relationshipStates[evaluation.matchStatus] = (summary.relationshipStates[evaluation.matchStatus] || 0) + 1;
          for (const fieldCode of HARD_GATE_CODES) {
            for (const [side, item] of [['subject', subject], ['counterpart', counterpart]]) {
              const evidenceId = item.evidenceByField[fieldCode];
              if (!evidenceId) continue;
              const link = core.linkComparisonRelationshipEvidence({ relationshipId: relationship.relationship_id, evidenceId, participantSide: side, fieldCode, evidenceRole: 'hard_gate' });
              summary[link.existed ? 'reused' : 'created'].relationEvidence += 1;
            }
          }
          core.recordImportItem({ importRunId: run.import_run_id, sourceKey: relationship.natural_key, targetType: 'comparison_relationship', targetId: relationship.relationship_id, action: relationship.existed ? 'reused' : 'created', detail: { matchStatus: evaluation.matchStatus, reviewState: evaluation.reviewState, subjectSku: subject.model.sku, counterpartSku: counterpart.model.sku } });
        });
      }
      core.db.prepare('UPDATE research_tasks SET status = ?, updated_at = ? WHERE task_id = ?').run('relation_review', now(), task.task_id);
      core.db.prepare(`INSERT INTO governance_audit(audit_id, actor, action, object_type, object_id, before_json, after_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`gov_${crypto.randomUUID()}`, actor, 'controlled_model_relationship_import', 'research_task', task.task_id, '{}', JSON.stringify({ importRunId: run.import_run_id, summary }), '按 P0-4 审计基线导入型号实体、字段证据及多对多候选关系；未将缺少型号级证据的关系标记为可批准。', now());
    });
    core.finishImport(run.import_run_id, 'completed', summary);
    return { importRunId: run.import_run_id, summary, relationshipMetrics: core.comparisonRelationshipMetrics(), overview: core.overview(), task: core.listResearchTasks().find((row) => row.title === TASK_TITLE) };
  } catch (error) {
    core.finishImport(run.import_run_id, 'failed', summary, String(error.message || error));
    throw error;
  } finally { core.close(); }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dataDir = arg(argv, '--data-dir', process.env.NVCI_DATA_DIR || '/data');
  const auditPath = arg(argv, '--audit', path.join(__dirname, 'baselines', 'p04-pilot-input-audit.json'));
  const execute = argv.includes('--execute');
  try {
    const result = execute ? executeImport({ dataDir, auditPath }) : planImport({ dataDir, auditPath });
    process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry_run', ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { planImport, executeImport, evaluatePair };
