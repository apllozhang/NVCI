#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createIntelligenceCore } = require('../intelligence-core');

const TASK_TITLE = 'ALE OmniSwitch 纵向产品线基线审阅';
const IMPORTER_NAME = 'ale-controlled-field-fact-importer';
const FIELD_CODES = [
  'form_factor', 'downlink_ports', 'downlink_speed', 'uplink_ports', 'uplink_speed',
  'poe_support', 'poe_budget', 'switching_capacity', 'forwarding_rate',
  'stacking_virtualization', 'max_stack_members', 'l3_routing', 'ospf_support',
  'vxlan_evpn_support', 'automation_api', 'management_platform', 'acl_security',
];
function now() { return new Date().toISOString(); }
function arg(argv, name, fallback = '') { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; }
function stableId(prefix, key) { return `${prefix}_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`; }
function text(value) { return String(value ?? '').trim(); }

function loadAudit(auditPath) {
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  if (!audit?.series?.length) throw new Error('审计基线为空，拒绝导入。');
  return audit;
}

function planImport({ dataDir, auditPath }) {
  const audit = loadAudit(auditPath);
  const core = createIntelligenceCore(dataDir);
  try {
    const task = core.listResearchTasks().find((row) => row.title === TASK_TITLE);
    if (!task) throw new Error('未找到 ALE 治理任务；请先初始化 P0-2 治理试点。');
    const metric = core.governanceMetrics();
    const activeFields = metric.fieldCoverage.technical.selectedFieldCodes || [];
    if (activeFields.length !== FIELD_CODES.length) throw new Error(`当前生效字段范围不完整：期望 ${FIELD_CODES.length} 项，实际 ${activeFields.length} 项。`);
    const seriesRows = core.listEntities({ vendorId: 'ale', entityType: 'series' });
    const seriesByName = new Map(seriesRows.map((row) => [row.canonical_name, row]));
    const counts = { verified: 0, not_disclosed: 0, needs_review: 0, rejected: 0 };
    const issues = [];
    for (const series of audit.series) {
      if (!seriesByName.has(series.seriesName)) { issues.push(`missing_series_entity:${series.seriesName}`); continue; }
      for (const fact of series.fieldFacts || []) {
        if (!activeFields.includes(fact.fieldCode)) { counts.rejected += 1; issues.push(`field_outside_active_scope:${series.seriesName}:${fact.fieldCode}`); continue; }
        if (!['verified', 'not_disclosed', 'needs_review'].includes(fact.status)) { counts.rejected += 1; issues.push(`invalid_status:${series.seriesName}:${fact.fieldCode}`); continue; }
        counts[fact.status] += 1;
      }
    }
    const total = counts.verified + counts.not_disclosed + counts.needs_review;
    if (total !== seriesRows.length * activeFields.length) throw new Error(`审计事实数量与生效范围不一致：${total} vs ${seriesRows.length * activeFields.length}。`);
    return {
      task,
      activeFields,
      seriesCount: seriesRows.length,
      counts,
      issues,
      audit,
      summary: {
        plannedFacts: total,
        series: seriesRows.length,
        fieldsPerSeries: activeFields.length,
        states: {
          evidence_verified: counts.verified,
          not_disclosed: counts.not_disclosed,
          needs_review: counts.needs_review,
        },
      },
    };
  } finally { core.close(); }
}

function executeImport({ dataDir, auditPath, actor = 'local-admin' }) {
  const plan = planImport({ dataDir, auditPath });
  const core = createIntelligenceCore(dataDir);
  const run = core.startImport({
    importerName: IMPORTER_NAME,
    mode: 'controlled_official_field_extraction',
    sourceDescriptor: { auditPath, auditGeneratedAt: plan.audit.generatedAt, taskId: plan.task.task_id, activeFieldPack: core.governanceMetrics().fieldCoverage.technical.fieldPack, activeFieldScopeVersion: core.governanceMetrics().fieldCoverage.technical.activeScopeVersion, actor },
  });
  const summary = { created: { evidence: 0, facts: 0, reviews: 0 }, reused: { evidence: 0, facts: 0, reviews: 0 }, states: { evidence_verified: 0, not_disclosed: 0, needs_review: 0 }, series: plan.seriesCount, fieldsPerSeries: plan.activeFields.length, auditIssues: plan.issues };
  try {
    core.transaction(() => {
      const entities = core.listEntities({ vendorId: 'ale', entityType: 'series' });
      const entityByName = new Map(entities.map((row) => [row.canonical_name, row]));
      const documentRows = core.listDocuments({ vendorId: 'ale' });
      const documentBySeries = new Map(documentRows.map((row) => [row.series_entity_id, row]));
      const revisionStmt = core.db.prepare('SELECT revision_id, sha256, official_file_name FROM document_revisions WHERE document_id = ? ORDER BY collected_at DESC LIMIT 1');
      for (const seriesAudit of plan.audit.series) {
        const entity = entityByName.get(seriesAudit.seriesName);
        if (!entity) throw new Error(`缺少系列实体：${seriesAudit.seriesName}`);
        const document = documentBySeries.get(entity.entity_id);
        if (!document) throw new Error(`缺少受控资料：${seriesAudit.seriesName}`);
        const revision = revisionStmt.get(document.document_id);
        if (!revision) throw new Error(`缺少资料修订：${seriesAudit.seriesName}`);
        for (const fact of seriesAudit.fieldFacts) {
          const publicationState = fact.status === 'verified' ? 'evidence_verified' : fact.status;
          const evidenceStatus = fact.status === 'verified' ? 'official_explicit' : fact.status === 'not_disclosed' ? 'official_not_disclosed' : 'needs_review';
          const evidence = core.upsertEvidence({
            revisionId: revision.revision_id,
            entityId: entity.entity_id,
            fieldCode: fact.fieldCode,
            sourceUrl: fact.sourceUrl || document.canonical_url,
            quoteText: fact.evidenceQuote || '该字段需要人工复核官方资料。',
            locator: fact.sourceLocator || 'P0-3 导入审计缺少精确定位',
            evidenceScope: 'series',
            evidenceStatus,
          });
          summary[evidence.existed ? 'reused' : 'created'].evidence += 1;
          const factRow = core.upsertFact({
            entityId: entity.entity_id,
            fieldCode: fact.fieldCode,
            value: { rawValue: fact.rawValue, normalizedValue: fact.normalizedValue, sourceTitle: fact.sourceTitle, extractionStatus: fact.status, auditReason: fact.auditReason || '' },
            unit: fact.unit,
            conditions: { description: fact.conditions, sourceLocator: fact.sourceLocator, documentId: document.document_id, revisionSha256: revision.sha256, extractionRun: run.import_run_id },
            evidenceId: evidence.evidence_id,
            publicationState,
          });
          summary[factRow.existed ? 'reused' : 'created'].facts += 1;
          summary.states[publicationState] += 1;
          core.recordImportItem({ importRunId: run.import_run_id, sourceKey: `${seriesAudit.seriesName}:${fact.fieldCode}`, targetType: 'fact', targetId: factRow.fact_id, action: factRow.existed ? 'reused' : 'created', detail: { status: fact.status, sourceUrl: fact.sourceUrl, sourceLocator: fact.sourceLocator, auditReason: fact.auditReason || '', revisionSha256: revision.sha256 } });
          if (fact.status === 'needs_review') {
            const review = core.upsertReviewItem({
              naturalKey: `ale-p03-field-review:${entity.entity_id}:${fact.fieldCode}:${revision.sha256}`,
              queueType: 'field_fact', objectType: 'fact', objectId: factRow.fact_id, taskId: plan.task.task_id,
              title: `复核 ${seriesAudit.seriesName}｜${fact.fieldCode} 的官方字段证据`,
              reason: fact.auditReason || '官方资料证据定位或适用范围不足，未进入已核验事实。', severity: 'medium', owner: actor,
              source: { series: seriesAudit.seriesName, fieldCode: fact.fieldCode, sourceUrl: fact.sourceUrl, sourceLocator: fact.sourceLocator, importRunId: run.import_run_id },
            });
            summary[review.existed ? 'reused' : 'created'].reviews += 1;
          }
        }
      }
      const before = core.db.prepare('SELECT * FROM research_tasks WHERE task_id = ?').get(plan.task.task_id);
      core.db.prepare('UPDATE research_tasks SET status = ?, updated_at = ? WHERE task_id = ?').run('fact_review', now(), plan.task.task_id);
      core.db.prepare(`INSERT INTO governance_audit(audit_id, actor, action, object_type, object_id, before_json, after_json, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          `gov_${crypto.randomUUID()}`, actor, 'controlled_field_fact_import', 'research_task', plan.task.task_id,
          JSON.stringify({ status: before.status }), JSON.stringify({ status: 'fact_review', importRunId: run.import_run_id, summary }),
          '按已批准字段范围导入 ALE 官方证据字段事实；不修改原始资料。', now(),
        );
    });
    core.finishImport(run.import_run_id, 'completed', summary);
    return { importRunId: run.import_run_id, summary, metrics: core.governanceMetrics(), overview: core.overview() };
  } catch (error) {
    core.finishImport(run.import_run_id, 'failed', summary, String(error.message || error));
    throw error;
  } finally { core.close(); }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dataDir = arg(argv, '--data-dir', process.env.NVCI_DATA_DIR || '/data');
  const auditPath = arg(argv, '--audit', path.join(__dirname, 'baselines', 'ale-field-facts-audit-2026-08-20.json'));
  const execute = argv.includes('--execute');
  try {
    const result = execute ? executeImport({ dataDir, auditPath }) : planImport({ dataDir, auditPath });
    process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry_run', ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { planImport, executeImport };
