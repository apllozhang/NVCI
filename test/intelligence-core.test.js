'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createIntelligenceCore } = require('../intelligence-core');
const { planAleReadOnlyImport, executeAleReadOnlyImport } = require('../intelligence/ale-readonly-importer');

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
      assert.deepEqual(overview.counts, { entities: 17, documents: 15, documentRevisions: 15, evidence: 75, facts: 75, importRuns: 1 });
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

test('重复 ALE 导入只新增导入审计，不重复创建产品、资料、证据或事实', () => {
  const dataDir = tempDataDir();
  try {
    executeAleReadOnlyImport({ dataDir });
    const second = executeAleReadOnlyImport({ dataDir });
    assert.deepEqual(second.summary.created, { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0 });
    assert.deepEqual(second.summary.reused, { entities: 17, documents: 15, revisions: 15, evidence: 75, facts: 75 });
    const core = createIntelligenceCore(dataDir);
    try {
      assert.deepEqual(core.overview().counts, { entities: 17, documents: 15, documentRevisions: 15, evidence: 75, facts: 75, importRuns: 2 });
      assert.equal(core.listImportRuns().length, 2);
    } finally { core.close(); }
  } finally { cleanup(dataDir); }
});
