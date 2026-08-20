'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const inputPath = path.join(projectRoot, 'intelligence', 'baselines', 'p04-direct-candidate-inputs.json');
const reviewPath = '/home/ubuntu/review_p04_direct_candidates.json';
const outputDir = path.join(projectRoot, 'intelligence', 'baselines');

function csv(value) {
  const raw = String(value ?? '');
  return `"${raw.replaceAll('"', '""')}"`;
}

function getGate(record, key) {
  return record.hard_gates?.[key] || {};
}

function gateState(gate) {
  const left = gate.subject?.evidenceState || 'unknown';
  const right = gate.counterpart?.evidenceState || 'unknown';
  if (left === 'evidence_verified' && right === 'evidence_verified') return '双方已核验';
  if (left === 'not_disclosed' || right === 'not_disclosed') return '至少一方未披露';
  if (left === 'needs_review' || right === 'needs_review') return '至少一方待复核';
  return '证据状态未知';
}

const inputs = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const reviews = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const byReviewId = new Map(reviews.results.map((item) => [item.output.review_id, item.output]));
const rows = inputs.inputs.map((item) => {
  const review = byReviewId.get(item.review_id);
  if (!review) throw new Error(`缺少审阅结果：${item.review_id}`);
  const evidence = {
    form_factor: gateState(getGate(item, 'form_factor')),
    environment: gateState(getGate(item, 'environment')),
    downlink_media: gateState(getGate(item, 'downlink_media')),
    downlink_port_count: gateState(getGate(item, 'downlink_port_count')),
    downlink_speed_band: gateState(getGate(item, 'downlink_speed_band')),
    poe_support: gateState(getGate(item, 'poe_support')),
  };
  const priority = review.recommendation === 'move_to_insufficient_evidence'
    ? 'P1：先补证'
    : review.recommendation === 'downgrade_to_partial'
      ? 'P2：先验证偏离项'
      : 'P3：可进入人工审核';
  return {
    review_id: item.review_id,
    relationship_id: item.relationship_id,
    ale_model: item.ale_model,
    hpe_aruba_model: item.hpe_aruba_model,
    recommendation: review.recommendation,
    priority,
    evidence_integrity: review.evidence_integrity,
    environment_evidence: evidence.environment,
    poe_evidence: evidence.poe_support,
    key_deviation_assessment: review.key_deviation_assessment,
    procurement_validation_questions: review.procurement_validation_questions,
    rationale: review.rationale,
  };
});

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc.byRecommendation[row.recommendation] = (acc.byRecommendation[row.recommendation] || 0) + 1;
  acc.byPriority[row.priority] = (acc.byPriority[row.priority] || 0) + 1;
  const family = row.ale_model.startsWith('OS6560') ? 'ALE OmniSwitch 6560/6560E' : 'ALE OmniSwitch 6360';
  acc.byAleFamily[family] = (acc.byAleFamily[family] || 0) + 1;
  return acc;
}, { total: 0, byRecommendation: {}, byPriority: {}, byAleFamily: {} });

const payload = {
  generated_at: new Date().toISOString(),
  source: {
    candidate_inputs: path.basename(inputPath),
    parallel_review: path.basename(reviewPath),
  },
  policy: '审阅登记册只提供建议，不自动批准、驳回或改写生产数据库中的关系审核状态。',
  summary,
  rows,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'p041-direct-candidate-review-register.json'), `${JSON.stringify(payload, null, 2)}\n`);
const headers = ['review_id', 'relationship_id', 'ale_model', 'hpe_aruba_model', 'recommendation', 'priority', 'evidence_integrity', 'environment_evidence', 'poe_evidence', 'key_deviation_assessment', 'procurement_validation_questions', 'rationale'];
fs.writeFileSync(path.join(outputDir, 'p041-direct-candidate-review-register.csv'), `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csv(row[header])).join(',')).join('\n')}\n`);
const markdown = [
  '# P0-4.1 直接候选审阅登记册',
  '',
  `审阅范围：${summary.total} 条 P0-4 直接候选。该登记册只提供审阅建议；不自动改变生产关系的审核状态。`,
  '',
  '## 建议分布',
  '',
  '| 建议 | 数量 | 处理方式 |',
  '|---|---:|---|',
  `| 保留直接候选 | ${summary.byRecommendation.keep_direct_candidate || 0} | 进入产品经理人工审核；批准前不得作为正式结论。 |`,
  `| 降级为部分候选 | ${summary.byRecommendation.downgrade_to_partial || 0} | 核验上行、PoE 或端口偏离后，再决定是否调整关系。 |`,
  `| 移至证据不足 | ${summary.byRecommendation.move_to_insufficient_evidence || 0} | 优先补齐官方型号级资料后重审。 |`,
  '',
  '## 处理优先级',
  '',
  '| 优先级 | 数量 | 含义 |',
  '|---|---:|---|',
  `| P1：先补证 | ${summary.byPriority['P1：先补证'] || 0} | 决定性字段存在未披露或待复核，不能支持直接关系。 |`,
  `| P2：先验证偏离项 | ${summary.byPriority['P2：先验证偏离项'] || 0} | 需要针对上行速率、PoE 预算或端口形态做采购验证。 |`,
  `| P3：可进入人工审核 | ${summary.byPriority['P3：可进入人工审核'] || 0} | 保持候选；仍须人工审核后才能批准。 |`,
  '',
  '## 审阅边界',
  '',
  '所有记录均保留环境字段的待复核提示。环境字段目前来自系列级归类，应在最终批准前由型号级官方资料或实际部署条件确认；它不能被当作已核验的型号事实。',
  '',
];
fs.writeFileSync(path.join(projectRoot, 'P041_DIRECT_CANDIDATE_REVIEW_REGISTER.md'), `${markdown.join('\n')}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
