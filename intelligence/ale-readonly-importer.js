'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createIntelligenceCore } = require('../intelligence-core');

function sha256Text(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function now() { return new Date().toISOString(); }
function safeSegment(value) { return String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_'); }
function argValue(argv, name, fallback = '') { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback; }
function profileDefault(dataDir) {
  const runtime = path.join(dataDir, 'automation', 'source-profiles', 'ale_omniswitch.json');
  if (fs.existsSync(runtime)) return runtime;
  return path.join(__dirname, '..', 'automation', 'bundled-profiles', 'ale_omniswitch.json');
}

function planAleReadOnlyImport({ dataDir, profilePath }) {
  const resolvedProfilePath = profilePath || profileDefault(dataDir);
  const rawProfile = fs.readFileSync(resolvedProfilePath, 'utf8');
  const profile = JSON.parse(rawProfile);
  if (profile.vendorId !== 'ale' || profile.profileId !== 'ale_omniswitch') throw new Error('只读导入器仅接受 ALE OmniSwitch 受控来源配置。');
  const profileHash = sha256Text(rawProfile);
  const sourceRows = (profile.sources || []).map((source) => ({
    sourceKey: source.documentId,
    series: source.series,
    documentId: source.documentId,
    productPageUrl: source.productPageUrl,
    pdfUrl: source.pdfUrl,
    expectedSha256: source.expectedSha256,
    officialFileName: source.officialFileName,
    evidencePolicy: source.evidencePolicy || profile.sourcePolicy,
    localPath: path.join(dataDir, 'library', ...(profile.productLinePath || []), safeSegment(source.series), source.officialFileName || ''),
  }));
  const invalid = sourceRows.filter((item) => !item.series || !item.pdfUrl || !/^[a-f0-9]{64}$/i.test(String(item.expectedSha256 || '')));
  return {
    profileId: profile.profileId,
    profilePath: resolvedProfilePath,
    profileHash,
    sourceCount: sourceRows.length,
    sources: sourceRows,
    invalid,
    productLinePath: profile.productLinePath || [],
    importedAt: now(),
  };
}

function executeAleReadOnlyImport({ dataDir, profilePath, actor = 'local-admin' }) {
  const plan = planAleReadOnlyImport({ dataDir, profilePath });
  if (plan.invalid.length) throw new Error(`存在 ${plan.invalid.length} 条不完整受控来源，已拒绝导入。`);
  const core = createIntelligenceCore(dataDir);
  const run = core.startImport({
    importerName: 'ale-readonly-importer',
    mode: 'read_only_source_profile',
    sourceDescriptor: { profileId: plan.profileId, profilePath: plan.profilePath, profileHash: plan.profileHash, sourceCount: plan.sourceCount, actor },
  });
  const summary = { created: { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0 }, reused: { entities: 0, documents: 0, revisions: 0, evidence: 0, facts: 0 }, sourceCount: plan.sourceCount, profileHash: plan.profileHash };
  try {
    core.transaction(() => {
      const vendor = core.upsertEntity({ entityType: 'vendor', vendorId: 'ale', canonicalName: 'ALE', naturalKey: 'ale', sourceState: 'verified', attributes: { officialDomains: ['al-enterprise.com'], primaryEvidence: 'official_datasheet_and_embedded_order_information' } });
      summary[vendor.existed ? 'reused' : 'created'].entities += 1;
      core.recordImportItem({ importRunId: run.import_run_id, sourceKey: 'vendor:ale', targetType: 'entity', targetId: vendor.entity_id, action: vendor.existed ? 'reused' : 'created', detail: { entityType: 'vendor' } });
      const productLine = core.upsertEntity({ entityType: 'product_line', vendorId: 'ale', parentEntityId: vendor.entity_id, canonicalName: 'OmniSwitch', naturalKey: 'omniswitch', sourceState: 'verified', attributes: { productDomain: 'switches', officialCollectionProfile: plan.profileId } });
      summary[productLine.existed ? 'reused' : 'created'].entities += 1;
      core.recordImportItem({ importRunId: run.import_run_id, sourceKey: 'product-line:ale:omniswitch', targetType: 'entity', targetId: productLine.entity_id, action: productLine.existed ? 'reused' : 'created', detail: { entityType: 'product_line' } });

      for (const source of plan.sources) {
        const series = core.upsertEntity({ entityType: 'series', vendorId: 'ale', parentEntityId: productLine.entity_id, canonicalName: source.series, naturalKey: source.series.toLowerCase(), sourceState: 'verified', attributes: { productDomain: 'switches', sourceDocumentId: source.documentId, evidencePolicy: source.evidencePolicy } });
        summary[series.existed ? 'reused' : 'created'].entities += 1;
        const document = core.upsertDocument({ vendorId: 'ale', seriesEntityId: series.entity_id, documentType: 'datasheet', title: `${source.series} 官方 Data sheet`, canonicalUrl: source.pdfUrl, productPageUrl: source.productPageUrl, logicalKey: source.documentId, sourceState: 'verified', attributes: { profileId: plan.profileId, officialFileName: source.officialFileName, expectedSha256: source.expectedSha256, evidencePolicy: source.evidencePolicy } });
        summary[document.existed ? 'reused' : 'created'].documents += 1;
        const revision = core.upsertRevision({ documentId: document.document_id, sha256: source.expectedSha256, officialFileName: source.officialFileName, localPath: source.localPath, sourceProfilePath: plan.profilePath, snapshotId: `source-profile:${plan.profileId}:${plan.profileHash.slice(0, 12)}`, revisionState: 'verified_baseline', collectedAt: plan.importedAt, metadata: { profileId: plan.profileId, sourceDocumentId: source.documentId, baselineKind: 'controlled_source_profile' } });
        summary[revision.existed ? 'reused' : 'created'].revisions += 1;
        const evidenceRows = [
          { fieldCode: 'official_product_page_url', sourceUrl: source.productPageUrl, quoteText: '官方产品页为资料发现入口；型号事实以官方 Data sheet 与其中 Order information 为主。', locator: '受控来源配置 productPageUrl', value: source.productPageUrl, conditions: { role: 'discovery' } },
          { fieldCode: 'official_datasheet_url', sourceUrl: source.pdfUrl, quoteText: '官方公开 Data sheet，已作为受控增量来源基线登记。', locator: '受控来源配置 pdfUrl', value: source.pdfUrl, conditions: { role: 'primary_evidence' } },
          { fieldCode: 'datasheet_sha256', sourceUrl: source.pdfUrl, quoteText: `已验证 SHA-256：${source.expectedSha256}`, locator: '受控来源配置 expectedSha256', value: source.expectedSha256, conditions: { hashAlgorithm: 'sha256', baselineKind: 'controlled_source_profile' } },
          { fieldCode: 'evidence_policy', sourceUrl: source.pdfUrl, quoteText: source.evidencePolicy, locator: '受控来源配置 evidencePolicy', value: source.evidencePolicy, conditions: { appliesTo: 'series' } },
          { fieldCode: 'official_file_name', sourceUrl: source.pdfUrl, quoteText: source.officialFileName, locator: '受控来源配置 officialFileName', value: source.officialFileName, conditions: { encoding: 'utf-8' } },
        ];
        for (const row of evidenceRows) {
          const evidence = core.upsertEvidence({ revisionId: revision.revision_id, entityId: series.entity_id, fieldCode: row.fieldCode, sourceUrl: row.sourceUrl, quoteText: row.quoteText, locator: row.locator, evidenceScope: 'series', evidenceStatus: 'official_explicit' });
          summary[evidence.existed ? 'reused' : 'created'].evidence += 1;
          const fact = core.upsertFact({ entityId: series.entity_id, fieldCode: row.fieldCode, value: row.value, conditions: row.conditions, evidenceId: evidence.evidence_id, publicationState: 'draft' });
          summary[fact.existed ? 'reused' : 'created'].facts += 1;
        }
        core.recordImportItem({ importRunId: run.import_run_id, sourceKey: source.sourceKey, targetType: 'series', targetId: series.entity_id, action: series.existed ? 'reused' : 'created', detail: { documentId: document.document_id, revisionId: revision.revision_id, sha256: source.expectedSha256, localPath: source.localPath } });
      }
    });
    core.finishImport(run.import_run_id, 'completed', summary);
    return { ...plan, importRunId: run.import_run_id, summary, overview: core.overview() };
  } catch (error) {
    core.finishImport(run.import_run_id, 'failed', summary, String(error.message || error));
    throw error;
  } finally {
    core.close();
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dataDir = argValue(argv, '--data-dir', process.env.NVCI_DATA_DIR || '/data');
  const profilePath = argValue(argv, '--profile', profileDefault(dataDir));
  const execute = argv.includes('--execute');
  try {
    const result = execute ? executeAleReadOnlyImport({ dataDir, profilePath }) : planAleReadOnlyImport({ dataDir, profilePath });
    process.stdout.write(`${JSON.stringify({ mode: execute ? 'execute' : 'dry_run', ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { planAleReadOnlyImport, executeAleReadOnlyImport, profileDefault };
