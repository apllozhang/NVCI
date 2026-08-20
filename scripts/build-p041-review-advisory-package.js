'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const inputsPath = path.join(root, 'intelligence', 'baselines', 'p04-direct-candidate-inputs.json');
const firstPassPath = '/home/ubuntu/review_p04_direct_candidates.json';
const os6560PassPath = '/home/ubuntu/reassess_p041_os6560_candidates.json';
const outDir = path.join(root, 'intelligence', 'baselines');

const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8')).inputs;
const firstPass = new Map(JSON.parse(fs.readFileSync(firstPassPath, 'utf8')).results.map((row) => [row.output.review_id, row.output]));
const os6560Pass = new Map(JSON.parse(fs.readFileSync(os6560PassPath, 'utf8')).results.map((row) => [row.output.review_id, row.output]));

const fourSfpIds = new Set(['02', '07', '12', '13', '20', '25', '30', '31', '33']);
const os6560Ids = new Set(['24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36']);
const retainedOs6360Ids = new Set(['01', '03', '04', '05', '06', '08', '09', '10', '11', '14', '15', '16', '17', '18', '19', '21', '22', '23']);

function advisoryFor(input) {
  const base = firstPass.get(input.review_id);
  const revised = os6560Pass.get(input.review_id);
  if (!base) throw new Error(`缺少首轮审阅：${input.review_id}`);
  const isFourSfp = fourSfpIds.has(input.review_id);
  const isOs6560 = os6560Ids.has(input.review_id);
  let recommendation = 'retain_direct_candidate_for_human_approval';
  let priority = 'P3';
  let advisoryReason = '双方型号处于同一固定园区接入形态；差异须在采购验证中确认，但未发现已核验的决定性能力降档。';
  let primaryGap = '环境、PoE 负载与上行模块配置需作为最终批准前的验证条件。';
  let evidenceNotes = base.evidence_integrity;
  let questions = base.procurement_validation_questions;

  if (isFourSfp) {
    recommendation = 'propose_partial_candidate';
    priority = 'P1';
    advisoryReason = 'HPE 官方 QuickSpecs 将该商业 SKU 定义为 4x 100M/1G SFP；ALE 侧候选具有 1G/10G SFP+ 上行或堆叠能力。上行速率能力已出现可核验的降档，不应保持无条件直接候选。';
    primaryGap = '需以项目上行带宽和光模块速率确认是否可接受 100M/1G SFP；若要求 10G，上述关系不得批准为直接映射。';
    evidenceNotes = 'HPE 4SFP 商业 SKU 的身份和 100M/1G 上行能力已由官方 QuickSpecs 核验；该项不是资料缺失，而是已验证的能力偏离。';
  } else if (isOs6560) {
    recommendation = 'propose_partial_candidate';
    priority = 'P2';
    advisoryReason = 'ALE OS6560 的 2x1G SFP + 4x1G/10G SFP+ 上行/堆叠结构及单/双 PSU 条件化 PoE 预算，与对方四端口上行和固定/模块化供电架构不完全等效。';
    primaryGap = '必须确认项目所需上行端口数量、10G 端口数、堆叠拓扑、PoE 总负载和电源冗余；不得将 OS6560 的双 PSU 最大预算当作基础型号的无条件预算。';
    evidenceNotes = revised?.evidence_change || 'OS6560 型号级官方 Data sheet 已补齐；关系差异转为可审计的配置条件，而非未披露。';
    questions = revised?.procurement_validation_questions || questions;
  } else if (!retainedOs6360Ids.has(input.review_id)) {
    recommendation = base.recommendation === 'move_to_insufficient_evidence' ? 'propose_partial_candidate' : 'propose_partial_candidate';
    priority = 'P2';
    advisoryReason = '首轮审阅发现上行或 PoE 差异，需要在采购约束下确认，故不建议直接批准。';
    primaryGap = base.key_deviation_assessment;
  }

  return {
    advisory_key: `p041-direct-review|${input.relationship_id}`,
    review_id: input.review_id,
    relationship_id: input.relationship_id,
    ale_model: input.ale_model,
    hpe_aruba_model: input.hpe_aruba_model,
    production_match_status: 'direct_candidate',
    production_review_state: 'review_required',
    advisory_recommendation: recommendation,
    priority,
    advisory_reason: advisoryReason,
    evidence_notes: evidenceNotes,
    primary_validation_focus: primaryGap,
    procurement_validation_questions: questions,
    source_set: [
      'p04-direct-candidate-inputs.json',
      'p041-direct-candidate-review-register.json',
      'P041_SUPPLEMENTAL_OFFICIAL_EVIDENCE.md',
    ],
    approval_gate: '仅产品经理可在 NVCI 关系详情中批准、驳回或继续保持待复核；本建议包不修改 comparison_relationships 的 match_status 或 review_state。',
  };
}

const advisories = inputs.map(advisoryFor);
const summary = advisories.reduce((acc, item) => {
  acc.total += 1;
  acc.byRecommendation[item.advisory_recommendation] = (acc.byRecommendation[item.advisory_recommendation] || 0) + 1;
  acc.byPriority[item.priority] = (acc.byPriority[item.priority] || 0) + 1;
  return acc;
}, { total: 0, byRecommendation: {}, byPriority: {} });

const payload = {
  baseline_id: 'p041-direct-candidate-advisory-2026-08-20',
  generated_at: new Date().toISOString(),
  scope: '仅审阅 P0-4 首批 36 条 direct_candidate 关系；不自动改变生产关系状态。',
  summary,
  official_source_policy: '仅官方 Data sheet、官方 Specifications、官方 QuickSpecs、官方商城产品页和随版本发布的不可变资料快照。',
  advisories,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'p041-direct-candidate-advisories.json'), `${JSON.stringify(payload, null, 2)}\n`);
const headers = ['review_id', 'relationship_id', 'ale_model', 'hpe_aruba_model', 'production_match_status', 'production_review_state', 'advisory_recommendation', 'priority', 'advisory_reason', 'evidence_notes', 'primary_validation_focus', 'procurement_validation_questions'];
const esc = (value) => `"${String(value || '').replaceAll('"', '""')}"`;
fs.writeFileSync(path.join(outDir, 'p041-direct-candidate-advisories.csv'), `${headers.join(',')}\n${advisories.map((item) => headers.map((key) => esc(item[key])).join(',')).join('\n')}\n`);
const md = [
  '# P0-4.1 直接候选关系审阅建议包',
  '',
  '本建议包不改变 P0-4 生产关系的 `match_status` 或 `review_state`。每一条关系仍须由产品经理在 NVCI 中明确批准、驳回或继续保持待复核。',
  '',
  '## 建议汇总',
  '',
  '| 建议 | 数量 | 审阅含义 |',
  '|---|---:|---|',
  `| 保持直接候选，进入人工批准 | ${summary.byRecommendation.retain_direct_candidate_for_human_approval || 0} | 决定性能力没有已核验的降档；仍需核实项目上行、PoE 与部署条件。 |`,
  `| 建议降级为部分候选 | ${summary.byRecommendation.propose_partial_candidate || 0} | 已存在上行、端口数、供电预算或电源冗余的结构性差异。 |`,
  '',
  '## 优先级',
  '',
  '| 优先级 | 数量 | 优先处理事项 |',
  '|---|---:|---|',
  `| P1 | ${summary.byPriority.P1 || 0} | HPE CX 6200F 4SFP 商业变体的 100M/1G 上行能力与 ALE 10G 上行存在已核验差异。 |`,
  `| P2 | ${summary.byPriority.P2 || 0} | OS6560 的单/双 PSU 条件化 PoE、六端口上行/堆叠结构及对端供电架构需按项目确认。 |`,
  `| P3 | ${summary.byPriority.P3 || 0} | 可进入产品经理人工审核，但不能自动批准。 |`,
  '',
  '## 关键治理结论',
  '',
  'HPE 官方 QuickSpecs 已确认 CX 6200F 的 `4SFP`（S0M82A、S0M84A、S0M85A）是 100M/1G SFP 上行商业变体，而 `4SFP+` 是不同的型号身份。前者不得再被当作 1G/10G 上行的直接候选。',
  '',
  'ALE OS6560-P24X4 与 OS6560-P48X4 的 PoE 预算并非“未披露”：它们取决于所装电源数量。任何对标、评分或采购结论都必须分别核验单 PSU 与双 PSU 的实际配置和供电负载。',
  '',
  '## 官方资料',
  '',
  '1. [ALE OmniSwitch 6360 Data sheet](https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6360-datasheet-en.pdf)',
  '2. [ALE OmniSwitch 6560/6560E Data sheet](https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-6560-6560e-datasheet-en.pdf)',
  '3. [HPE Aruba CX 6200F Specifications](https://support.hpe.com/hpesc/public/docDisplay?docId=a00099581en_us&docLocale=en_US)',
  '4. [HPE Aruba CX 6200 QuickSpecs](https://www.hpe.com/psnow/doc/a00059762enw.html)',
  '5. [HPE Aruba CX 6100 Data sheet](https://www.hpe.com/psnow/doc/PSN1013114991WWEN.pdf?jumpid=in_pdp-psnow-dds)',
  '',
];
fs.writeFileSync(path.join(root, 'P041_DIRECT_CANDIDATE_ADVISORY_PACKAGE.md'), `${md.join('\n')}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
