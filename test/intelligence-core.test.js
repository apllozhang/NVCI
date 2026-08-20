'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createIntelligenceCore } = require('../intelligence-core');
const { planAleReadOnlyImport, executeAleReadOnlyImport } = require('../intelligence/ale-readonly-importer');
const { planImport: planAleFieldFactImport, executeImport: executeAleFieldFactImport } = require('../intelligence/import-ale-field-facts');
const ALE_FIELD_FACT_AUDIT = path.join(__dirname, '..', 'intelligence', 'baselines', 'ale-field-facts-audit-2026-08-20.json');

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-intelligence-'));
}

function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

test('ALE 只读导入预览读取受控来源但不创建 SQLite 或资料目录', () => {
  const dataDir = tempDataDir();
  try {
    const plan = planAleReadOnlyImport({ dataDir });
    assert.equal(plan.profileId, 'ale_omniswitch');
    assert.equal(plan.sourceCount, 15);
    assert.equal(plan.invalid.length, 0);
    assert.equal(fs.existsSync(path.join(dataDir, 'intelligence', 'intelligence.db')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'library', 'ALE产品彩页')), false);
  } finally { cleanup(dataDir); }
});

test('ALE 只读导入创建独立情报核心并保持原始资料库未写入', () => {
  const dataDir = tempDataDir();
  try {
    const result = executeAleReadOnlyImport({ dataDir });
    assert.equal(result.summary.created.entities, 17);
    assert.equal(result.summary.created.documents, 15);
    assert.equal(result.summary.created.revisions, 15);
    assert.equal(result.summary.created.evidence, 75);
    assert.equal(result.summary.created.facts, 75);
    assert.equal(fs.existsSync(path.join(dataDir, 'intelligence', 'intelligence.db')), true);
    assert.equal(fs.existsSync(path.join(dataDir, 'library', 'ALE产品彩页')), false);
    const core = createIntelligenceCore(dataDir);
    try {
      const overview = core.overview();
      assert.deepEqual(overview.counts, { entities: 17, documents: 15, documentRevisions: 15, evidence: 75, facts: 75, importRuns: 1, researchTasks: 0, reviewItems: 0, fieldTemplates: 1, taskFieldPacks: 0 });
      const series = core.listEntities({ vendorId: 'ale', entityType: 'series' });
      assert.equal(series.length, 15);
      const os6370 = series.find((item) => item.canonical_name === 'OmniSwitch 6370');
      assert.ok(os6370);
      const detail = core.entityDetail(os6370.entity_id);
      assert.equal(detail.facts.length, 5);
      assert.ok(detail.facts.some((fact) => fact.field_code === 'datasheet_sha256' && fact.value.length === 64));
    } finally { core.close(); }
  } finally { cleanup(dataDir); }
});

test('P0-2 ALE 治理试点创建可审计任务、审核队列与质量指标，且重复初始化不会产生重复项', () => {
  const dataDir = tempDataDir();
  try {
    executeAleReadOnlyImport({ dataDir });
    const core = createIntelligenceCore(dataDir);
    try {
      const first = core.bootstrapAleGovernance();
      assert.equal(first.created.tasks, 1);
      assert.equal(first.created.reviews, 2);
      assert.equal(first.metrics.fieldCoverage.provenance.percent, 100);
      assert.equal(first.metrics.fieldCoverage.technical.percent, 0);
      assert.equal(first.metrics.freshness.percent, 100);
      assert.equal(first.metrics.reviewQueue.bySeverity.high, 1);
      assert.equal(first.metrics.reviewQueue.bySeverity.medium, 1);
      const task = core.listResearchTasks();
      assert.equal(task.length, 1);
      assert.equal(task[0].status, 'evidence_review');
      const reviews = core.listReviewItems();
      assert.equal(reviews.length, 2);
      const started = core.updateReviewItem(reviews[0].review_id, { status: 'in_review', actor: 'local-admin' });
      assert.equal(started.status, 'in_review');
      assert.throws(() => core.updateReviewItem(reviews[0].review_id, { status: 'resolved', actor: 'local-admin' }), /必须说明理由/);
      const second = core.bootstrapAleGovernance();
      assert.equal(second.created.reusedTasks, 1);
      assert.equal(second.created.reusedReviews, 2);
      assert.equal(core.listResearchTasks().length, 1);
      assert.equal(core.listReviewItems().length, 2);
      const snapshot = core.exportSnapshot();
      assert.equal(snapshot.researchTasks.length, 1);
      assert.equal(snapshot.reviewItems.length, 2);
      assert.ok(snapshot.governanceAudit.length >= 2);
    } finally { core.close(); }
  } finally { cleanup(dataDir); }
});

test('产品经理可通过字段模板提交并批准 ALE 技术字段范围，审批后指标按已选字段计算且保留审计', () => {
  const dataDir = tempDataDir();
  try {
    executeAleReadOnlyImport({ dataDir });
    const core = createIntelligenceCore(dataDir);
    try {
      core.bootstrapAleGovernance();
      const task = core.listResearchTasks()[0];
      const templates = core.listFieldTemplates();
      assert.equal(templates.length, 1);
      assert.equal(templates[0].templateId, 'campus_switching_v1');
      assert.ok(templates[0].items.some((item) => item.fieldCode === 'ospf_support'));
      const selected = ['downlink_ports', 'uplink_ports', 'poe_support', 'poe_budget', 'switching_capacity', 'forwarding_rate', 'stacking_virtualization', 'ospf_support'];
      const submitted = core.createTaskFieldPack({ taskId: task.task_id, templateId: 'campus_switching_v1', selectedFieldCodes: selected, rationale: '首批字段用于 ALE 园区接入与汇聚产品定型、组合覆盖和 Aruba CX 横向对标。', actor: 'local-admin' });
      assert.equal(submitted.pending.packStatus, 'pending_approval');
      assert.equal(submitted.pending.items.filter((item) => item.selected).length, selected.length);
      assert.throws(() => core.approveTaskFieldPack(submitted.createdPackId, { actor: 'local-admin' }), /必须说明决策依据/);
      const approved = core.approveTaskFieldPack(submitted.createdPackId, { actor: 'local-admin', reason: '字段来自产品定型关键指标，并已定义官方 Data sheet/Order information/配置指南证据门槛。' });
      assert.equal(approved.active.packStatus, 'active');
      assert.equal(approved.active.items.filter((item) => item.selected).length, selected.length);
      const metrics = core.governanceMetrics();
      assert.equal(metrics.fieldCoverage.technical.expected, 15 * selected.length);
      assert.equal(metrics.fieldCoverage.technical.percent, 0);
      assert.equal(metrics.fieldCoverage.technical.status, 'review_required');
      assert.equal(metrics.fieldScope.active.taskFieldPackId, submitted.createdPackId);
      assert.equal(core.listResearchTasks()[0].status, 'field_scope_ready');
      const reviews = core.listReviewItems();
      assert.equal(reviews.filter((item) => item.status === 'resolved').length, 2);
      assert.equal(metrics.reviewQueue.openTotal, 1);
      const snapshot = core.exportSnapshot();
      assert.equal(snapshot.fieldTemplates.length, 1);
      assert.equal(snapshot.taskFieldPacks.length, 1);
      assert.equal(snapshot.taskFieldPackItems.filter((item) => item.selected).length, selected.length);
      assert.ok(snapshot.governanceAudit.some((item) => item.action === 'task_field_pack_approved'));
    } finally { core.close(); }
  } finally { cleanup(dataDir); }
});

test('重复 ALE 导入只新增导入审计，不重复创建产品、资料、证据或事实', () => {
  const dataDir = tempDataDir();
  try {
    executeAleReadOnlyImport({ dataDir });
    const second = executeAleReadOnlyImport({ dataDir });
    assert.deepEqual(second.summary.created, { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0 });
    assert.deepEqual(second.summary.reused, { entities: 17, documents: 15, revisions: 15, evidence: 75, facts: 75 });
    const core = createIntelligenceCore(dataDir);
    try {
      assert.deepEqual(core.overview().counts, { entities: 17, documents: 15, documentRevisions: 15, evidence: 75, facts: 75, importRuns: 2, researchTasks: 0, reviewItems: 0, fieldTemplates: 1, taskFieldPacks: 0 });
      assert.equal(core.listImportRuns().length, 2);
    } finally { core.close(); }
  } finally { cleanup(dataDir); }
});

test('P0-3 受控字段事实导入遵守已批准范围，保留三态覆盖率并确保幂等', () => {
  const dataDir = tempDataDir();
  try {
    executeAleReadOnlyImport({ dataDir });
    const core = createIntelligenceCore(dataDir);
    try {
      const governance = core.bootstrapAleGovernance('p03-test');
      const fieldCodes = core.getFieldTemplate('campus_switching_v1').items.map((item) => item.fieldCode);
      const submitted = core.createTaskFieldPack({ taskId: governance.task.task_id, templateId: 'campus_switching_v1', selectedFieldCodes: fieldCodes, rationale: 'P0-3 回归测试范围。', actor: 'p03-test' });
      core.approveTaskFieldPack(submitted.createdPackId, { actor: 'p03-test', reason: 'P0-3 回归测试批准范围。' });
    } finally { core.close(); }
    const plan = planAleFieldFactImport({ dataDir, auditPath: ALE_FIELD_FACT_AUDIT });
    assert.equal(plan.summary.plannedFacts, 255);
    assert.deepEqual(plan.summary.states, { evidence_verified: 223, not_disclosed: 31, needs_review: 1 });
    const first = executeAleFieldFactImport({ dataDir, auditPath: ALE_FIELD_FACT_AUDIT, actor: 'p03-test' });
    assert.equal(first.summary.created.facts, 255);
    assert.equal(first.summary.created.reviews, 1);
    const second = executeAleFieldFactImport({ dataDir, auditPath: ALE_FIELD_FACT_AUDIT, actor: 'p03-test' });
    assert.equal(second.summary.created.facts, 0);
    assert.equal(second.summary.reused.facts, 255);
    const result = createIntelligenceCore(dataDir);
    try {
      const technical = result.governanceMetrics().fieldCoverage.technical;
      assert.equal(technical.completed, 255);
      assert.equal(technical.expected, 255);
      assert.equal(technical.verified, 223);
      assert.equal(technical.notDisclosed, 31);
      assert.equal(technical.needsReview, 1);
      assert.equal(result.listResearchTasks()[0].status, 'fact_review');
      assert.equal(result.listReviewItems().filter((item) => item.queue_type === 'field_fact' && item.status === 'open').length, 1);
    } finally { result.close(); }
  } finally { cleanup(dataDir); }
});
