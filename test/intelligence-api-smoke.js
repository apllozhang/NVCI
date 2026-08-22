'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dataDir = process.env.NVCI_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-intelligence-api-'));
const port = Number(process.env.NVCI_INTELLIGENCE_TEST_PORT || 8795);
const base = `http://127.0.0.1:${port}`;
const password = process.env.NVCI_ADMIN_PASSWORD || 'local-test-password';

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`${base}/health`); if (response.ok) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`NVCI 未在测试端口启动：${String(lastError || '')}`);
}

async function request(cookie, method, endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json();
  assert.ok(response.ok, `${method} ${endpoint} 失败：${JSON.stringify(payload)}`);
  return { response, payload };
}

async function run() {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), NVCI_DATA_DIR: dataDir, NVCI_ADMIN_PASSWORD: password, NVCI_SESSION_SECRET: 'intelligence-api-smoke-session-secret-0123456789' }, stdio: 'ignore' });
  try {
    await waitForHealth();
    const login = await request('', 'POST', '/api/login', { password });
    const cookie = String(login.response.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.includes('nvci_session='));

    const empty = await request(cookie, 'GET', '/api/intelligence/overview');
    assert.equal(empty.payload.counts.entities, 0);
    const preview = await request(cookie, 'POST', '/api/intelligence/imports/ale-readonly/preview', {});
    assert.equal(preview.payload.mode, 'dry_run');
    assert.equal(preview.payload.sourceCount, 15);
    assert.equal(fs.existsSync(path.join(dataDir, 'intelligence', 'intelligence.db')), true, '启动核心会创建空数据库');

    const imported = await request(cookie, 'POST', '/api/intelligence/imports/ale-readonly/execute', {});
    assert.equal(imported.payload.sourceCount, 15);
    assert.equal(imported.payload.overview.counts.documents, 15);
    assert.equal(fs.existsSync(path.join(dataDir, 'library', 'ALE产品彩页')), false, '只读导入不得向活动资料库写入资料');

    const entities = await request(cookie, 'GET', '/api/intelligence/entities?vendorId=ale&entityType=series');
    assert.equal(entities.payload.length, 15);
    const os6370 = entities.payload.find((item) => item.canonical_name === 'OmniSwitch 6370');
    assert.ok(os6370);
    const detail = await request(cookie, 'GET', `/api/intelligence/entities/${encodeURIComponent(os6370.entity_id)}`);
    assert.equal(detail.payload.facts.length, 5);
    const documents = await request(cookie, 'GET', '/api/intelligence/documents?vendorId=ale');
    assert.equal(documents.payload.length, 15);
    const initialized = await request(cookie, 'POST', '/api/intelligence/governance/ale-bootstrap', {});
    assert.equal(initialized.payload.created.tasks, 1);
    assert.equal(initialized.payload.created.reviews, 2);
    const metrics = await request(cookie, 'GET', '/api/intelligence/metrics');
    assert.equal(metrics.payload.fieldCoverage.provenance.percent, 100);
    assert.equal(metrics.payload.fieldCoverage.technical.percent, 0);
    assert.equal(metrics.payload.freshness.percent, 100);
    assert.equal(metrics.payload.reviewQueue.openTotal, 2);
    const tasks = await request(cookie, 'GET', '/api/intelligence/research-tasks');
    assert.equal(tasks.payload.length, 1);
    assert.equal(tasks.payload[0].status, 'evidence_review');
    const reviews = await request(cookie, 'GET', '/api/intelligence/review-items');
    assert.equal(reviews.payload.length, 2);
    const inReview = await request(cookie, 'PATCH', `/api/intelligence/review-items/${encodeURIComponent(reviews.payload[0].review_id)}`, { status: 'in_review' });
    assert.equal(inReview.payload.status, 'in_review');
    const templates = await request(cookie, 'GET', '/api/intelligence/field-templates');
    assert.equal(templates.payload.length, 4);
    assert.ok(templates.payload.some((template) => template.templateId === 'campus_switching_v1'));
    const selectedFieldCodes = ['downlink_ports', 'uplink_ports', 'poe_support', 'switching_capacity', 'forwarding_rate', 'stacking_virtualization', 'ospf_support'];
    const submittedScope = await request(cookie, 'POST', `/api/intelligence/research-tasks/${encodeURIComponent(tasks.payload[0].task_id)}/field-packs`, { templateId: 'campus_switching_v1', selectedFieldCodes, rationale: 'API 验证：首批字段用于 ALE 园区交换机定型与 Aruba CX 对标。' });
    assert.equal(submittedScope.payload.pending.packStatus, 'pending_approval');
    assert.equal(submittedScope.payload.pending.items.filter((item) => item.selected).length, selectedFieldCodes.length);
    const approvedScope = await request(cookie, 'POST', `/api/intelligence/field-packs/${encodeURIComponent(submittedScope.payload.createdPackId)}/approve`, { reason: 'API 验证：产品经理确认字段范围、官方资料证据门槛和优先级。' });
    assert.equal(approvedScope.payload.active.packStatus, 'active');
    const scopeMetrics = await request(cookie, 'GET', '/api/intelligence/metrics');
    assert.equal(scopeMetrics.payload.fieldCoverage.technical.expected, 15 * selectedFieldCodes.length);
    assert.equal(scopeMetrics.payload.fieldScope.active.taskFieldPackId, submittedScope.payload.createdPackId);
    const scopePacks = await request(cookie, 'GET', `/api/intelligence/research-tasks/${encodeURIComponent(tasks.payload[0].task_id)}/field-packs`);
    assert.equal(scopePacks.payload[0].packStatus, 'active');
    const imports = await request(cookie, 'GET', '/api/intelligence/import-runs');
    assert.equal(imports.payload.length, 1);
    const snapshot = await request(cookie, 'GET', '/api/intelligence/export');
    assert.equal(snapshot.payload.exportFormat, 'nvci_intelligence_snapshot_v1');
    assert.equal(snapshot.payload.entities.length, 17);
    assert.equal(snapshot.payload.documents.length, 15);
    assert.equal(snapshot.payload.evidence.length, 75);
    assert.equal(snapshot.payload.facts.length, 75);
    assert.equal(snapshot.payload.researchTasks.length, 1);
    assert.equal(snapshot.payload.reviewItems.length, 3);
    assert.equal(snapshot.payload.fieldTemplates.length, 4);
    assert.equal(snapshot.payload.taskFieldPacks.length, 1);
    assert.equal(snapshot.payload.taskFieldPackItems.filter((item) => item.selected).length, selectedFieldCodes.length);
    assert.ok(snapshot.payload.governanceAudit.length >= 4);

    const repeated = await request(cookie, 'POST', '/api/intelligence/imports/ale-readonly/execute', {});
    assert.equal(repeated.payload.summary.created.documents, 0);
    assert.equal(repeated.payload.summary.reused.documents, 15);
    process.stdout.write('intelligence-api-smoke: ok\n');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    if (!process.env.NVCI_DATA_DIR) fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
