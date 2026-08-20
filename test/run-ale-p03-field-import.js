#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { executeAleReadOnlyImport } = require('../intelligence/ale-readonly-importer');
const { executeImport } = require('../intelligence/import-ale-field-facts');
const { createIntelligenceCore } = require('../intelligence-core');

const dataDir = process.env.NVCI_DATA_DIR || path.join(__dirname, '..', '.test-p03-field-import');
const auditPath = process.env.NVCI_ALE_FIELD_AUDIT || '/home/ubuntu/runs/ale-field-fact-extraction-2026-08-20/audited_field_facts.json';
const templateId = 'campus_switching_v1';
fs.rmSync(dataDir, { recursive: true, force: true });

const sourceImport = executeAleReadOnlyImport({ dataDir, actor: 'p03-test' });
const core = createIntelligenceCore(dataDir);
try {
  const boot = core.bootstrapAleGovernance('p03-test');
  const selected = core.getFieldTemplate(templateId).items.map((item) => item.fieldCode);
  const created = core.createTaskFieldPack({ taskId: boot.task.task_id, templateId, selectedFieldCodes: selected, rationale: 'P0-3 隔离测试：按 17 个已批准技术字段导入官方事实。', actor: 'p03-test' });
  const pending = created.pending;
  core.approveTaskFieldPack(pending.taskFieldPackId, { actor: 'p03-test', reason: 'P0-3 隔离测试批准字段范围。' });
} finally { core.close(); }

const first = executeImport({ dataDir, auditPath, actor: 'p03-test' });
const second = executeImport({ dataDir, auditPath, actor: 'p03-test' });
const check = createIntelligenceCore(dataDir);
try {
  const metrics = check.governanceMetrics();
  const reviews = check.listReviewItems({});
  const result = {
    sourceImport: sourceImport.summary,
    first: first.summary,
    second: second.summary,
    metrics,
    p03FactReviews: reviews.filter((item) => item.queue_type === 'field_fact'),
    task: check.listResearchTasks().find((item) => item.title === 'ALE OmniSwitch 纵向产品线基线审阅'),
  };
  const expected = 255;
  if (metrics.fieldCoverage.technical.expected !== expected) throw new Error(`expected technical facts should be ${expected}`);
  if (metrics.fieldCoverage.technical.completed !== expected) throw new Error(`technical facts should cover ${expected}`);
  if (metrics.fieldCoverage.technical.verified !== 223 || metrics.fieldCoverage.technical.notDisclosed !== 31 || metrics.fieldCoverage.technical.needsReview !== 1) throw new Error('audited status distribution mismatch');
  if (first.summary.created.facts !== expected || second.summary.created.facts !== 0 || second.summary.reused.facts !== expected) throw new Error('idempotency mismatch');
  if (result.task.status !== 'fact_review') throw new Error(`task should be fact_review, got ${result.task.status}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { check.close(); }
