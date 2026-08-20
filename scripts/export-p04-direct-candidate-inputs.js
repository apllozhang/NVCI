'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIntelligenceCore } = require('../intelligence-core');
const { executeImport } = require('../intelligence/import-p04-pilot-relations');

const outPath = process.argv[2] || path.join(process.cwd(), 'intelligence', 'baselines', 'p04-direct-candidate-inputs.json');
const auditPath = path.join(__dirname, '..', 'intelligence', 'baselines', 'p04-pilot-input-audit.json');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-p04-direct-'));

try {
  executeImport({ dataDir, auditPath, actor: 'p04-direct-input-export' });
  const core = createIntelligenceCore(dataDir);
  try {
    const relationships = core.listComparisonRelationships({ matchStatus: 'direct_candidate', limit: 200 })
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name) || a.counterpart_name.localeCompare(b.counterpart_name));
    const inputs = relationships.map((relationship, index) => {
      const detail = core.comparisonRelationshipDetail(relationship.relationship_id);
      return {
        review_id: String(index + 1).padStart(2, '0'),
        relationship_id: relationship.relationship_id,
        ale_model: relationship.subject_name,
        hpe_aruba_model: relationship.counterpart_name,
        relationship_status: relationship.match_status,
        review_status: relationship.review_state,
        key_deviations: relationship.key_deviations,
        procurement_questions: relationship.procurement_questions,
        hard_gates: detail.hardGates,
        evidence_count: detail.evidence.length,
      };
    });
    const payload = {
      generated_at: new Date().toISOString(),
      source_audit: path.basename(auditPath),
      input_count: inputs.length,
      review_policy: '仅形成审阅建议；不得自动批准、驳回或修改生产数据库中的对标关系。',
      inputs,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`${outPath}\n${inputs.length}\n`);
  } finally {
    core.close();
  }
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
