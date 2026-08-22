'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { ensureBundledProfiles } = require('../automation/collector-core');
const { createOnboardingTask, getOnboardingTask, queueDueOnboardingTasks } = require('../automation/onboarding-tasks');
const { createIntelligenceCore } = require('../intelligence-core');

function tempDataDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-onboarding-')); }

test('一次预约任务到期后只写入一次采集队列，完成前不会被 Worker 重复排队', () => {
  const dataDir = tempDataDir();
  const core = createIntelligenceCore(dataDir);
  try {
    ensureBundledProfiles(dataDir);
    const start = new Date('2026-08-22T00:00:00.000Z');
    const created = createOnboardingTask({
      dataDir,
      intelligence: core,
      clock: () => start,
      input: {
        title: 'ALE 一次预约任务',
        decisionQuestion: '验证一次预约采集任务的后台排队幂等性。',
        mode: 'vertical',
        profileIds: ['ale_omniswitch'],
        execution: { type: 'once', runAt: '2026-08-22T00:05:00.000Z' },
        analysis: { templateId: 'campus_switching_v1', selectedFieldCodes: ['downlink_ports', 'ospf_support'], rationale: '验证一次预约任务与关键字段范围的受控联动。' },
      },
    });
    assert.equal(created.status, 'scheduled');
    const due = queueDueOnboardingTasks(dataDir, () => new Date('2026-08-22T00:06:00.000Z'));
    assert.equal(due.length, 1);
    assert.equal(due[0].requestIds.length, 1);
    const repeated = queueDueOnboardingTasks(dataDir, () => new Date('2026-08-22T00:07:00.000Z'));
    assert.equal(repeated.length, 0);
    const detail = getOnboardingTask(dataDir, created.taskId, core);
    assert.equal(detail.status, 'queued');
    assert.equal(detail.requests.length, 1);
    assert.equal(detail.execution.nextRunAt, '');
  } finally {
    core.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
