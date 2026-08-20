'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createIntelligenceCore } = require('../intelligence-core');
const { planImport, executeImport } = require('../intelligence/import-p04-pilot-relations');

const dataDir = process.env.NVCI_P04_TEST_DIR || path.join(__dirname, '..', '.test-p04-relations');
const auditPath = path.join(__dirname, '..', 'intelligence', 'baselines', 'p04-pilot-input-audit.json');
fs.rmSync(dataDir, { recursive: true, force: true });

const plan = planImport({ dataDir, auditPath });
assert.equal(plan.modelCount, 81, '首批基础技术型号应为 81 个');
assert.equal(plan.candidatePairs, 1610, '首批多对多候选对数量应为 1,610');

const first = executeImport({ dataDir, auditPath, actor: 'p04-test' });
assert.equal(first.relationshipMetrics.total, 1610, '关系总数应为 1,610');
assert.equal(first.overview.counts.comparisonRelationshipEvidence, 19320, '每个关系应关联两侧六项硬门槛证据');
assert.equal(first.task.status, 'relation_review', '任务应进入关系审阅阶段');

const core = createIntelligenceCore(dataDir);
const relations = core.listComparisonRelationships({ limit: 500 });
assert.equal(relations.length, 500, '关系列表应支持分页上限');
const one = core.comparisonRelationshipDetail(relations[0].relationship_id);
assert.ok(one.evidence.length >= 12, '单条关系至少应回链两侧六项硬门槛证据');
assert.ok(one.hardGates.form_factor, '关系详情应呈现形态门槛');
assert.ok(one.hardGates.poe_support, '关系详情应呈现 PoE 门槛');
core.close();

const second = executeImport({ dataDir, auditPath, actor: 'p04-test' });
assert.equal(second.summary.created.relationships, 0, '重复导入不得创建重复关系');
assert.equal(second.relationshipMetrics.total, 1610, '重复导入后关系总数必须保持不变');

const result = {
  plan: { models: plan.modelCount, candidatePairs: plan.candidatePairs },
  first: { relationshipMetrics: first.relationshipMetrics, summary: first.summary },
  second: { relationshipMetrics: second.relationshipMetrics, summary: second.summary },
  firstRelationshipDiagnostic: {
    subject: one.subjectName,
    counterpart: one.counterpartName,
    matchStatus: one.match_status,
    reviewState: one.review_state,
    hardGates: one.hardGates,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
