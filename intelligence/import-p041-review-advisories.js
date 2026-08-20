'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createIntelligenceCore } = require('../intelligence-core');

const IMPORTER_NAME = 'p041-controlled-direct-review-advisory-importer';
const TASK_TITLE = 'ALE OmniSwitch 与 HPE Aruba CX 型号级对标试点';

function now() { return new Date().toISOString(); }
function arg(argv, name, fallback = '') { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback; }
function loadBaseline(filePath) {
  const baseline = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (baseline?.baseline_id !== 'p041-direct-candidate-advisory-2026-08-20' || !Array.isArray(baseline.advisories) || baseline.advisories.length !== 36) {
    throw new Error('P0-4.1 审阅建议基线无效：必须是包含 36 条直接候选的固定建议包。');
  }
  const keys = new Set();
  for (const item of baseline.advisories) {
    if (!item.advisory_key || !item.relationship_id || !item.advisory_recommendation || !item.priority) throw new Error('P0-4.1 建议基线缺少关系标识、建议或优先级。');
    if (keys.has(item.advisory_key)) throw new Error(`P0-4.1 建议基线存在重复键：${item.advisory_key}`);
    keys.add(item.advisory_key);
  }
  return baseline;
}

function planImport({ dataDir, baselinePath }) {
  const baseline = loadBaseline(baselinePath);
  const core = createIntelligenceCore(dataDir);
  try {
    const task = core.listResearchTasks().find((row) => row.mode === 'horizontal' && row.title === TASK_TITLE);
    if (!task) throw new Error('未找到 P0-4 横向对标任务；请先完成 P0-4 受控关系导入。');
    const present = baseline.advisories.filter((item) => core.comparisonRelationshipDetail(item.relationship_id));
    if (present.length !== baseline.advisories.length) throw new Error(`P0-4.1 审阅建议无法绑定：仅找到 ${present.length}/${baseline.advisories.length} 条生产关系。`);
    const byRecommendation = {};
    const byPriority = {};
    for (const item of baseline.advisories) {
      byRecommendation[item.advisory_recommendation] = (byRecommendation[item.advisory_recommendation] || 0) + 1;
      byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
    }
    return { baseline, task, sourceDescriptor: { baselineId: baseline.baseline_id, generatedAt: baseline.generated_at, baselineFile: path.basename(baselinePath), advisoryCount: baseline.advisories.length, byRecommendation, byPriority }, existingMetrics: core.comparisonRelationshipMetrics(task.task_id) };
  } finally { core.close(); }
}

function executeImport({ dataDir, baselinePath, actor = 'local-admin' }) {
  const plan = planImport({ dataDir, baselinePath });
  const core = createIntelligenceCore(dataDir);
  const run = core.startImport({ importerName: IMPORTER_NAME, mode: 'controlled_relationship_review_advisory_import', sourceDescriptor: { ...plan.sourceDescriptor, actor } });
  const summary = { created: { advisories: 0, reviews: 0 }, reused: { advisories: 0, reviews: 0 }, unchangedProductionRelationships: 0, byRecommendation: {}, byPriority: {} };
  try {
    core.transaction(() => {
      for (const item of plan.baseline.advisories) {
        const advisory = core.upsertComparisonRelationshipAdvisory({
          naturalKey: item.advisory_key, relationshipId: item.relationship_id, taskId: plan.task.task_id,
          advisoryType: 'p041_direct_candidate_review', recommendation: item.advisory_recommendation, priority: item.priority, advisoryState: 'active',
          advisory: {
            reviewId: item.review_id, aleModel: item.ale_model, hpeArubaModel: item.hpe_aruba_model,
            productionMatchStatus: item.production_match_status, productionReviewState: item.production_review_state,
            advisoryReason: item.advisory_reason, evidenceNotes: item.evidence_notes, primaryValidationFocus: item.primary_validation_focus,
            procurementValidationQuestions: item.procurement_validation_questions, approvalGate: item.approval_gate,
          },
          sourceDescriptor: { baselineId: plan.baseline.baseline_id, baselineFile: path.basename(baselinePath), sourceSet: item.source_set, officialSourcePolicy: plan.baseline.official_source_policy }, actor,
        });
        summary[advisory.existed ? 'reused' : 'created'].advisories += 1;
        summary.unchangedProductionRelationships += 1;
        summary.byRecommendation[item.advisory_recommendation] = (summary.byRecommendation[item.advisory_recommendation] || 0) + 1;
        summary.byPriority[item.priority] = (summary.byPriority[item.priority] || 0) + 1;
        core.recordImportItem({ importRunId: run.import_run_id, sourceKey: item.advisory_key, targetType: 'comparison_relationship_advisory', targetId: advisory.advisory_id, action: advisory.existed ? 'reused' : 'created', detail: { relationshipId: item.relationship_id, recommendation: item.advisory_recommendation, priority: item.priority, productionRelationshipUnchanged: true } });
        if (item.priority === 'P1' || item.priority === 'P2') {
          const review = core.upsertReviewItem({
            naturalKey: `p041-advisory:${item.relationship_id}`, queueType: 'relationship_advisory', objectType: 'comparison_relationship_advisory', objectId: advisory.advisory_id, taskId: plan.task.task_id,
            title: `P0-4.1 ${item.priority}｜${item.ale_model} ↔ ${item.hpe_aruba_model}`,
            reason: item.advisory_reason,
            severity: item.priority === 'P1' ? 'high' : 'medium', owner: actor, status: 'open',
            source: { relationshipId: item.relationship_id, advisoryId: advisory.advisory_id, recommendation: item.advisory_recommendation, priority: item.priority, validationFocus: item.primary_validation_focus, baselineId: plan.baseline.baseline_id },
          });
          summary[review.existed ? 'reused' : 'created'].reviews += 1;
        }
      }
      core.db.prepare('UPDATE research_tasks SET status = ?, updated_at = ? WHERE task_id = ?').run('relation_review', now(), plan.task.task_id);
      core.db.prepare(`INSERT INTO governance_audit(audit_id, actor, action, object_type, object_id, before_json, after_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`gov_${crypto.randomUUID()}`, actor, 'controlled_relationship_review_advisory_import', 'research_task', plan.task.task_id, '{}', JSON.stringify({ importRunId: run.import_run_id, summary }), '写入 P0-4.1 审阅建议与高优先级验证问题；没有更改 comparison_relationships 的 match_status 或 review_state。', now());
    });
    core.finishImport(run.import_run_id, 'completed', summary);
    return { importRunId: run.import_run_id, summary, relationshipMetrics: core.comparisonRelationshipMetrics(plan.task.task_id), advisories: core.listComparisonRelationshipAdvisories({ taskId: plan.task.task_id }), overview: core.overview() };
  } catch (error) {
    core.finishImport(run.import_run_id, 'failed', summary, String(error.message || error));
    throw error;
  } finally { core.close(); }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dataDir = arg(argv, '--data-dir', process.env.NVCI_DATA_DIR || '/data');
  const baselinePath = arg(argv, '--baseline', path.join(__dirname, 'baselines', 'p041-direct-candidate-advisories.json'));
  const execute = argv.includes('--execute');
  try {
    const result = execute ? executeImport({ dataDir, baselinePath }) : planImport({ dataDir, baselinePath });
    process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry_run', ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { planImport, executeImport, loadBaseline };
