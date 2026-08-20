'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createFieldScopeManager } = require('./intelligence/field-scope');

const SCHEMA_VERSION = 'p0-4.0';

function timestamp() { return new Date().toISOString(); }
function json(value) { return JSON.stringify(value ?? {}); }
function parseJson(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function stableId(prefix, naturalKey) { return `${prefix}_${crypto.createHash('sha256').update(String(naturalKey)).digest('hex').slice(0, 24)}`; }
function ensureDir(target) { fs.mkdirSync(target, { recursive: true }); }

function createIntelligenceCore(dataDir) {
  const rootDir = path.join(dataDir, 'intelligence');
  ensureDir(rootDir);
  const dbPath = path.join(rootDir, 'intelligence.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      vendor_id TEXT NOT NULL DEFAULT '',
      parent_entity_id TEXT,
      canonical_name TEXT NOT NULL,
      natural_key TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      source_state TEXT NOT NULL DEFAULT 'draft',
      attributes_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(entity_type, vendor_id, natural_key)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_vendor_type ON entities(vendor_id, entity_type);
    CREATE TABLE IF NOT EXISTS entity_aliases (
      alias_id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_type TEXT NOT NULL DEFAULT 'display_name',
      region TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(entity_id, alias, alias_type, region),
      FOREIGN KEY(entity_id) REFERENCES entities(entity_id)
    );
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      series_entity_id TEXT,
      document_type TEXT NOT NULL,
      title TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      product_page_url TEXT NOT NULL DEFAULT '',
      logical_key TEXT NOT NULL UNIQUE,
      source_state TEXT NOT NULL DEFAULT 'draft',
      attributes_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(series_entity_id) REFERENCES entities(entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_vendor ON documents(vendor_id);
    CREATE TABLE IF NOT EXISTS document_revisions (
      revision_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      official_file_name TEXT NOT NULL DEFAULT '',
      local_path TEXT NOT NULL DEFAULT '',
      source_profile_path TEXT NOT NULL DEFAULT '',
      snapshot_id TEXT NOT NULL DEFAULT '',
      revision_state TEXT NOT NULL DEFAULT 'verified',
      collected_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(document_id, sha256),
      FOREIGN KEY(document_id) REFERENCES documents(document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_revisions_document ON document_revisions(document_id);
    CREATE TABLE IF NOT EXISTS evidence (
      evidence_id TEXT PRIMARY KEY,
      revision_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field_code TEXT NOT NULL,
      source_url TEXT NOT NULL,
      quote_text TEXT NOT NULL DEFAULT '',
      locator TEXT NOT NULL DEFAULT '',
      evidence_scope TEXT NOT NULL DEFAULT 'series',
      evidence_status TEXT NOT NULL DEFAULT 'official_explicit',
      created_at TEXT NOT NULL,
      UNIQUE(revision_id, entity_id, field_code, source_url, locator),
      FOREIGN KEY(revision_id) REFERENCES document_revisions(revision_id),
      FOREIGN KEY(entity_id) REFERENCES entities(entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_entity_field ON evidence(entity_id, field_code);
    CREATE TABLE IF NOT EXISTS facts (
      fact_id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      field_code TEXT NOT NULL,
      normalized_value_json TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      conditions_json TEXT NOT NULL DEFAULT '{}',
      evidence_id TEXT NOT NULL,
      publication_state TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(entity_id, field_code, evidence_id),
      FOREIGN KEY(entity_id) REFERENCES entities(entity_id),
      FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id);
    CREATE TABLE IF NOT EXISTS import_runs (
      import_run_id TEXT PRIMARY KEY,
      importer_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      source_descriptor_json TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_text TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS import_items (
      import_item_id TEXT PRIMARY KEY,
      import_run_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(import_run_id, source_key, target_type, target_id),
      FOREIGN KEY(import_run_id) REFERENCES import_runs(import_run_id)
    );
    CREATE TABLE IF NOT EXISTS research_tasks (
      task_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      decision_question TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      owner TEXT NOT NULL DEFAULT 'local-admin',
      status TEXT NOT NULL DEFAULT 'draft',
      priority TEXT NOT NULL DEFAULT 'medium',
      baseline_descriptor_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE(mode, title)
    );
    CREATE INDEX IF NOT EXISTS idx_research_tasks_status ON research_tasks(status, priority);
    CREATE TABLE IF NOT EXISTS review_items (
      review_id TEXT PRIMARY KEY,
      task_id TEXT,
      queue_type TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      natural_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      owner TEXT NOT NULL DEFAULT 'local-admin',
      source_json TEXT NOT NULL DEFAULT '{}',
      resolution_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY(task_id) REFERENCES research_tasks(task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_items_status ON review_items(status, severity, queue_type);
    CREATE TABLE IF NOT EXISTS governance_audit (
      audit_id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_governance_audit_object ON governance_audit(object_type, object_id, created_at);
    CREATE TABLE IF NOT EXISTS comparison_relationships (
      relationship_id TEXT PRIMARY KEY,
      natural_key TEXT NOT NULL UNIQUE,
      task_id TEXT,
      subject_entity_id TEXT NOT NULL,
      counterpart_entity_id TEXT NOT NULL,
      match_status TEXT NOT NULL,
      review_state TEXT NOT NULL DEFAULT 'candidate',
      candidate_rank INTEGER NOT NULL DEFAULT 0,
      hard_gates_json TEXT NOT NULL DEFAULT '{}',
      dimensions_json TEXT NOT NULL DEFAULT '{}',
      rationale TEXT NOT NULL DEFAULT '',
      key_deviations TEXT NOT NULL DEFAULT '',
      disqualification_reason TEXT NOT NULL DEFAULT '',
      validation_questions_json TEXT NOT NULL DEFAULT '[]',
      source_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES research_tasks(task_id),
      FOREIGN KEY(subject_entity_id) REFERENCES entities(entity_id),
      FOREIGN KEY(counterpart_entity_id) REFERENCES entities(entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_comparison_relationships_task ON comparison_relationships(task_id, match_status, review_state);
    CREATE INDEX IF NOT EXISTS idx_comparison_relationships_subject ON comparison_relationships(subject_entity_id, counterpart_entity_id);
    CREATE TABLE IF NOT EXISTS comparison_relationship_evidence (
      relationship_evidence_id TEXT PRIMARY KEY,
      relationship_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      participant_side TEXT NOT NULL,
      field_code TEXT NOT NULL,
      evidence_role TEXT NOT NULL DEFAULT 'hard_gate',
      created_at TEXT NOT NULL,
      UNIQUE(relationship_id, evidence_id, participant_side, field_code, evidence_role),
      FOREIGN KEY(relationship_id) REFERENCES comparison_relationships(relationship_id),
      FOREIGN KEY(evidence_id) REFERENCES evidence(evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_comparison_relation_evidence ON comparison_relationship_evidence(relationship_id, participant_side);
  `);

  db.prepare(`INSERT INTO schema_meta(meta_key, meta_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value, updated_at = excluded.updated_at`)
    .run('schema_version', SCHEMA_VERSION, timestamp());

  const statements = {
    findEntity: db.prepare('SELECT * FROM entities WHERE entity_type = ? AND vendor_id = ? AND natural_key = ?'),
    insertEntity: db.prepare(`INSERT INTO entities(entity_id, entity_type, vendor_id, parent_entity_id, canonical_name, natural_key, lifecycle_state, source_state, attributes_json, created_at, updated_at)
      VALUES (@entity_id, @entity_type, @vendor_id, @parent_entity_id, @canonical_name, @natural_key, @lifecycle_state, @source_state, @attributes_json, @created_at, @updated_at)`),
    updateEntity: db.prepare(`UPDATE entities SET parent_entity_id = @parent_entity_id, canonical_name = @canonical_name, lifecycle_state = @lifecycle_state,
      source_state = @source_state, attributes_json = @attributes_json, updated_at = @updated_at WHERE entity_id = @entity_id`),
    findDocument: db.prepare('SELECT * FROM documents WHERE logical_key = ?'),
    insertDocument: db.prepare(`INSERT INTO documents(document_id, vendor_id, series_entity_id, document_type, title, canonical_url, product_page_url, logical_key, source_state, attributes_json, created_at, updated_at)
      VALUES (@document_id, @vendor_id, @series_entity_id, @document_type, @title, @canonical_url, @product_page_url, @logical_key, @source_state, @attributes_json, @created_at, @updated_at)`),
    updateDocument: db.prepare(`UPDATE documents SET series_entity_id = @series_entity_id, title = @title, canonical_url = @canonical_url,
      product_page_url = @product_page_url, source_state = @source_state, attributes_json = @attributes_json, updated_at = @updated_at WHERE document_id = @document_id`),
    findRevision: db.prepare('SELECT * FROM document_revisions WHERE document_id = ? AND sha256 = ?'),
    insertRevision: db.prepare(`INSERT INTO document_revisions(revision_id, document_id, sha256, official_file_name, local_path, source_profile_path, snapshot_id, revision_state, collected_at, metadata_json)
      VALUES (@revision_id, @document_id, @sha256, @official_file_name, @local_path, @source_profile_path, @snapshot_id, @revision_state, @collected_at, @metadata_json)`),
    findEvidence: db.prepare('SELECT * FROM evidence WHERE revision_id = ? AND entity_id = ? AND field_code = ? AND source_url = ? AND locator = ?'),
    insertEvidence: db.prepare(`INSERT INTO evidence(evidence_id, revision_id, entity_id, field_code, source_url, quote_text, locator, evidence_scope, evidence_status, created_at)
      VALUES (@evidence_id, @revision_id, @entity_id, @field_code, @source_url, @quote_text, @locator, @evidence_scope, @evidence_status, @created_at)`),
    findFact: db.prepare('SELECT * FROM facts WHERE entity_id = ? AND field_code = ? AND evidence_id = ?'),
    insertFact: db.prepare(`INSERT INTO facts(fact_id, entity_id, field_code, normalized_value_json, unit, conditions_json, evidence_id, publication_state, created_at, updated_at)
      VALUES (@fact_id, @entity_id, @field_code, @normalized_value_json, @unit, @conditions_json, @evidence_id, @publication_state, @created_at, @updated_at)`),
    updateFact: db.prepare(`UPDATE facts SET normalized_value_json = @normalized_value_json, unit = @unit, conditions_json = @conditions_json,
      publication_state = @publication_state, updated_at = @updated_at WHERE fact_id = @fact_id`),
  };

  function upsertEntity(input) {
    const vendorId = input.vendorId || '';
    const naturalKey = input.naturalKey || input.canonicalName;
    const existing = statements.findEntity.get(input.entityType, vendorId, naturalKey);
    const record = {
      entity_id: existing?.entity_id || stableId('ent', `${input.entityType}|${vendorId}|${naturalKey}`),
      entity_type: input.entityType,
      vendor_id: vendorId,
      parent_entity_id: input.parentEntityId || null,
      canonical_name: input.canonicalName,
      natural_key: naturalKey,
      lifecycle_state: input.lifecycleState || 'active',
      source_state: input.sourceState || 'draft',
      attributes_json: json(input.attributes || {}),
      created_at: existing?.created_at || timestamp(),
      updated_at: timestamp(),
    };
    if (existing) statements.updateEntity.run(record); else statements.insertEntity.run(record);
    return { ...record, attributes: input.attributes || {}, existed: Boolean(existing) };
  }

  function upsertDocument(input) {
    const logicalKey = input.logicalKey || `${input.vendorId}|${input.documentType}|${input.canonicalUrl}`;
    const existing = statements.findDocument.get(logicalKey);
    const record = {
      document_id: existing?.document_id || stableId('doc', logicalKey),
      vendor_id: input.vendorId,
      series_entity_id: input.seriesEntityId || null,
      document_type: input.documentType || 'datasheet',
      title: input.title || input.officialFileName || logicalKey,
      canonical_url: input.canonicalUrl,
      product_page_url: input.productPageUrl || '',
      logical_key: logicalKey,
      source_state: input.sourceState || 'verified',
      attributes_json: json(input.attributes || {}),
      created_at: existing?.created_at || timestamp(),
      updated_at: timestamp(),
    };
    if (existing) statements.updateDocument.run(record); else statements.insertDocument.run(record);
    return { ...record, attributes: input.attributes || {}, existed: Boolean(existing) };
  }

  function upsertRevision(input) {
    const existing = statements.findRevision.get(input.documentId, input.sha256);
    if (existing) return { ...existing, metadata: parseJson(existing.metadata_json), existed: true };
    const record = {
      revision_id: stableId('rev', `${input.documentId}|${input.sha256}`),
      document_id: input.documentId,
      sha256: input.sha256,
      official_file_name: input.officialFileName || '',
      local_path: input.localPath || '',
      source_profile_path: input.sourceProfilePath || '',
      snapshot_id: input.snapshotId || '',
      revision_state: input.revisionState || 'verified',
      collected_at: input.collectedAt || timestamp(),
      metadata_json: json(input.metadata || {}),
    };
    statements.insertRevision.run(record);
    return { ...record, metadata: input.metadata || {}, existed: false };
  }

  function upsertEvidence(input) {
    const existing = statements.findEvidence.get(input.revisionId, input.entityId, input.fieldCode, input.sourceUrl, input.locator || '');
    if (existing) return { ...existing, existed: true };
    const record = {
      evidence_id: stableId('evd', `${input.revisionId}|${input.entityId}|${input.fieldCode}|${input.sourceUrl}|${input.locator || ''}`),
      revision_id: input.revisionId,
      entity_id: input.entityId,
      field_code: input.fieldCode,
      source_url: input.sourceUrl,
      quote_text: input.quoteText || '',
      locator: input.locator || '',
      evidence_scope: input.evidenceScope || 'series',
      evidence_status: input.evidenceStatus || 'official_explicit',
      created_at: timestamp(),
    };
    statements.insertEvidence.run(record);
    return { ...record, existed: false };
  }

  function upsertFact(input) {
    const existing = statements.findFact.get(input.entityId, input.fieldCode, input.evidenceId);
    const record = {
      fact_id: existing?.fact_id || stableId('fact', `${input.entityId}|${input.fieldCode}|${input.evidenceId}`),
      entity_id: input.entityId,
      field_code: input.fieldCode,
      normalized_value_json: json(input.value),
      unit: input.unit || '',
      conditions_json: json(input.conditions || {}),
      evidence_id: input.evidenceId,
      publication_state: input.publicationState || 'draft',
      created_at: existing?.created_at || timestamp(),
      updated_at: timestamp(),
    };
    if (existing) statements.updateFact.run(record); else statements.insertFact.run(record);
    return { ...record, value: input.value, conditions: input.conditions || {}, existed: Boolean(existing) };
  }

  function startImport(input) {
    const record = {
      import_run_id: input.importRunId || `imp_${crypto.randomUUID()}`,
      importer_name: input.importerName,
      mode: input.mode,
      status: 'running',
      source_descriptor_json: json(input.sourceDescriptor || {}),
      summary_json: '{}',
      started_at: timestamp(),
      finished_at: null,
      error_text: '',
    };
    db.prepare(`INSERT INTO import_runs(import_run_id, importer_name, mode, status, source_descriptor_json, summary_json, started_at, finished_at, error_text)
      VALUES (@import_run_id, @importer_name, @mode, @status, @source_descriptor_json, @summary_json, @started_at, @finished_at, @error_text)`).run(record);
    return record;
  }

  function finishImport(importRunId, status, summary = {}, errorText = '') {
    db.prepare('UPDATE import_runs SET status = ?, summary_json = ?, finished_at = ?, error_text = ? WHERE import_run_id = ?')
      .run(status, json(summary), timestamp(), errorText, importRunId);
  }

  function recordImportItem(input) {
    const record = {
      import_item_id: stableId('impitem', `${input.importRunId}|${input.sourceKey}|${input.targetType}|${input.targetId}`),
      import_run_id: input.importRunId,
      source_key: input.sourceKey,
      target_type: input.targetType,
      target_id: input.targetId,
      action: input.action,
      detail_json: json(input.detail || {}),
      created_at: timestamp(),
    };
    db.prepare(`INSERT INTO import_items(import_item_id, import_run_id, source_key, target_type, target_id, action, detail_json, created_at)
      VALUES (@import_item_id, @import_run_id, @source_key, @target_type, @target_id, @action, @detail_json, @created_at)
      ON CONFLICT(import_run_id, source_key, target_type, target_id) DO UPDATE SET action = excluded.action, detail_json = excluded.detail_json`).run(record);
  }

  function taskRow(row) {
    return row ? { ...row, scope: parseJson(row.scope_json), baselineDescriptor: parseJson(row.baseline_descriptor_json) } : null;
  }

  function reviewRow(row) {
    return row ? { ...row, source: parseJson(row.source_json), resolution: parseJson(row.resolution_json) } : null;
  }

  function auditGovernance(input) {
    db.prepare(`INSERT INTO governance_audit(audit_id, actor, action, object_type, object_id, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`gov_${crypto.randomUUID()}`, input.actor || 'local-admin', input.action, input.objectType, input.objectId, json(input.before || {}), json(input.after || {}), input.reason || '', timestamp());
  }

  function upsertResearchTask(input) {
    const existing = db.prepare('SELECT * FROM research_tasks WHERE mode = ? AND title = ?').get(input.mode, input.title);
    const record = {
      task_id: existing?.task_id || stableId('task', `${input.mode}|${input.title}`),
      title: input.title,
      mode: input.mode,
      decision_question: input.decisionQuestion,
      scope_json: json(input.scope || {}),
      owner: input.owner || 'local-admin',
      status: existing?.status || input.status || 'draft',
      priority: input.priority || existing?.priority || 'medium',
      baseline_descriptor_json: json(input.baselineDescriptor || {}),
      created_at: existing?.created_at || timestamp(),
      updated_at: timestamp(),
      published_at: input.publishedAt || existing?.published_at || null,
    };
    if (existing) {
      db.prepare(`UPDATE research_tasks SET decision_question = ?, scope_json = ?, owner = ?, status = ?, priority = ?, baseline_descriptor_json = ?, updated_at = ?, published_at = ? WHERE task_id = ?`)
        .run(record.decision_question, record.scope_json, record.owner, record.status, record.priority, record.baseline_descriptor_json, record.updated_at, record.published_at, record.task_id);
    } else {
      db.prepare(`INSERT INTO research_tasks(task_id, title, mode, decision_question, scope_json, owner, status, priority, baseline_descriptor_json, created_at, updated_at, published_at)
        VALUES (@task_id, @title, @mode, @decision_question, @scope_json, @owner, @status, @priority, @baseline_descriptor_json, @created_at, @updated_at, @published_at)`).run(record);
    }
    return { ...record, scope: input.scope || {}, baselineDescriptor: input.baselineDescriptor || {}, existed: Boolean(existing) };
  }

  function upsertReviewItem(input) {
    const existing = db.prepare('SELECT * FROM review_items WHERE natural_key = ?').get(input.naturalKey);
    const record = {
      review_id: existing?.review_id || stableId('review', input.naturalKey),
      task_id: input.taskId || null,
      queue_type: input.queueType,
      object_type: input.objectType,
      object_id: input.objectId,
      natural_key: input.naturalKey,
      title: input.title,
      reason: input.reason || '',
      severity: input.severity || 'medium',
      status: existing?.status || input.status || 'open',
      owner: input.owner || existing?.owner || 'local-admin',
      source_json: json(input.source || {}),
      resolution_json: json(input.resolution || (existing ? parseJson(existing.resolution_json) : {})),
      created_at: existing?.created_at || timestamp(),
      updated_at: timestamp(),
      closed_at: input.closedAt || existing?.closed_at || null,
    };
    if (existing) {
      db.prepare(`UPDATE review_items SET task_id = ?, queue_type = ?, object_type = ?, object_id = ?, title = ?, reason = ?, severity = ?, status = ?, owner = ?, source_json = ?, resolution_json = ?, updated_at = ?, closed_at = ? WHERE review_id = ?`)
        .run(record.task_id, record.queue_type, record.object_type, record.object_id, record.title, record.reason, record.severity, record.status, record.owner, record.source_json, record.resolution_json, record.updated_at, record.closed_at, record.review_id);
    } else {
      db.prepare(`INSERT INTO review_items(review_id, task_id, queue_type, object_type, object_id, natural_key, title, reason, severity, status, owner, source_json, resolution_json, created_at, updated_at, closed_at)
        VALUES (@review_id, @task_id, @queue_type, @object_type, @object_id, @natural_key, @title, @reason, @severity, @status, @owner, @source_json, @resolution_json, @created_at, @updated_at, @closed_at)`).run(record);
    }
    return { ...record, source: input.source || {}, resolution: input.resolution || {}, existed: Boolean(existing) };
  }

  function relationshipRow(row) {
    return row ? {
      ...row,
      hardGates: parseJson(row.hard_gates_json),
      dimensions: parseJson(row.dimensions_json),
      validationQuestions: parseJson(row.validation_questions_json, []),
      sourceSnapshot: parseJson(row.source_snapshot_json),
    } : null;
  }

  function upsertComparisonRelationship(input) {
    const allowedStatus = new Set(['direct_candidate', 'partial_candidate', 'adjacent_upgrade', 'not_comparable', 'insufficient_evidence']);
    const allowedReviewStates = new Set(['candidate', 'review_required', 'approved', 'rejected', 'superseded']);
    if (!allowedStatus.has(input.matchStatus)) throw new Error('对标关系状态不合法。');
    if (!allowedReviewStates.has(input.reviewState || 'candidate')) throw new Error('对标关系审核状态不合法。');
    if (!input.subjectEntityId || !input.counterpartEntityId || input.subjectEntityId === input.counterpartEntityId) throw new Error('对标关系必须关联两个不同的型号实体。');
    const naturalKey = input.naturalKey || `${input.subjectEntityId}|${input.counterpartEntityId}|${input.matchStatus}`;
    const existing = db.prepare('SELECT * FROM comparison_relationships WHERE natural_key = ?').get(naturalKey);
    const record = {
      relationship_id: existing?.relationship_id || stableId('rel', naturalKey), natural_key: naturalKey, task_id: input.taskId || null,
      subject_entity_id: input.subjectEntityId, counterpart_entity_id: input.counterpartEntityId, match_status: input.matchStatus,
      review_state: input.reviewState || 'candidate', candidate_rank: Number.isInteger(input.candidateRank) ? input.candidateRank : 0,
      hard_gates_json: json(input.hardGates || {}), dimensions_json: json(input.dimensions || {}), rationale: input.rationale || '',
      key_deviations: input.keyDeviations || '', disqualification_reason: input.disqualificationReason || '',
      validation_questions_json: json(input.validationQuestions || []), source_snapshot_json: json(input.sourceSnapshot || {}),
      created_at: existing?.created_at || timestamp(), updated_at: timestamp(),
    };
    if (existing) {
      db.prepare(`UPDATE comparison_relationships SET task_id = ?, subject_entity_id = ?, counterpart_entity_id = ?, match_status = ?, review_state = ?, candidate_rank = ?, hard_gates_json = ?, dimensions_json = ?, rationale = ?, key_deviations = ?, disqualification_reason = ?, validation_questions_json = ?, source_snapshot_json = ?, updated_at = ? WHERE relationship_id = ?`)
        .run(record.task_id, record.subject_entity_id, record.counterpart_entity_id, record.match_status, record.review_state, record.candidate_rank, record.hard_gates_json, record.dimensions_json, record.rationale, record.key_deviations, record.disqualification_reason, record.validation_questions_json, record.source_snapshot_json, record.updated_at, record.relationship_id);
    } else {
      db.prepare(`INSERT INTO comparison_relationships(relationship_id, natural_key, task_id, subject_entity_id, counterpart_entity_id, match_status, review_state, candidate_rank, hard_gates_json, dimensions_json, rationale, key_deviations, disqualification_reason, validation_questions_json, source_snapshot_json, created_at, updated_at)
        VALUES (@relationship_id, @natural_key, @task_id, @subject_entity_id, @counterpart_entity_id, @match_status, @review_state, @candidate_rank, @hard_gates_json, @dimensions_json, @rationale, @key_deviations, @disqualification_reason, @validation_questions_json, @source_snapshot_json, @created_at, @updated_at)`).run(record);
    }
    return { ...relationshipRow(record), existed: Boolean(existing) };
  }

  function linkComparisonRelationshipEvidence(input) {
    if (!['subject', 'counterpart'].includes(input.participantSide)) throw new Error('关系证据参与方必须为 subject 或 counterpart。');
    const role = input.evidenceRole || 'hard_gate';
    const naturalKey = `${input.relationshipId}|${input.evidenceId}|${input.participantSide}|${input.fieldCode}|${role}`;
    const existing = db.prepare('SELECT * FROM comparison_relationship_evidence WHERE relationship_id = ? AND evidence_id = ? AND participant_side = ? AND field_code = ? AND evidence_role = ?')
      .get(input.relationshipId, input.evidenceId, input.participantSide, input.fieldCode, role);
    if (existing) return { ...existing, existed: true };
    const record = { relationship_evidence_id: stableId('relevd', naturalKey), relationship_id: input.relationshipId, evidence_id: input.evidenceId, participant_side: input.participantSide, field_code: input.fieldCode, evidence_role: role, created_at: timestamp() };
    db.prepare(`INSERT INTO comparison_relationship_evidence(relationship_evidence_id, relationship_id, evidence_id, participant_side, field_code, evidence_role, created_at)
      VALUES (@relationship_evidence_id, @relationship_id, @evidence_id, @participant_side, @field_code, @evidence_role, @created_at)`).run(record);
    return { ...record, existed: false };
  }

  function listComparisonRelationships(filters = {}) {
    const clauses = []; const params = [];
    if (filters.taskId) { clauses.push('r.task_id = ?'); params.push(filters.taskId); }
    if (filters.matchStatus) { clauses.push('r.match_status = ?'); params.push(filters.matchStatus); }
    if (filters.reviewState) { clauses.push('r.review_state = ?'); params.push(filters.reviewState); }
    if (filters.q) { clauses.push('(s.canonical_name LIKE ? OR c.canonical_name LIKE ?)'); const query = `%${String(filters.q).slice(0, 120)}%`; params.push(query, query); }
    const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
    const sql = `SELECT r.*, s.canonical_name AS subject_name, s.vendor_id AS subject_vendor_id, c.canonical_name AS counterpart_name, c.vendor_id AS counterpart_vendor_id
      FROM comparison_relationships r JOIN entities s ON s.entity_id = r.subject_entity_id JOIN entities c ON c.entity_id = r.counterpart_entity_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY CASE r.review_state WHEN 'review_required' THEN 0 WHEN 'candidate' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, r.candidate_rank ASC, s.canonical_name, c.canonical_name LIMIT ${limit}`;
    return db.prepare(sql).all(...params).map((row) => ({ ...relationshipRow(row), subjectName: row.subject_name, subjectVendorId: row.subject_vendor_id, counterpartName: row.counterpart_name, counterpartVendorId: row.counterpart_vendor_id }));
  }

  function comparisonRelationshipDetail(relationshipId) {
    const row = db.prepare(`SELECT r.*, s.canonical_name AS subject_name, s.vendor_id AS subject_vendor_id, c.canonical_name AS counterpart_name, c.vendor_id AS counterpart_vendor_id
      FROM comparison_relationships r JOIN entities s ON s.entity_id = r.subject_entity_id JOIN entities c ON c.entity_id = r.counterpart_entity_id WHERE r.relationship_id = ?`).get(relationshipId);
    if (!row) return null;
    const evidence = db.prepare(`SELECT re.*, e.source_url, e.quote_text, e.locator, e.evidence_scope, e.evidence_status, d.title AS document_title, d.canonical_url, rev.sha256, rev.official_file_name
      FROM comparison_relationship_evidence re JOIN evidence e ON e.evidence_id = re.evidence_id JOIN document_revisions rev ON rev.revision_id = e.revision_id JOIN documents d ON d.document_id = rev.document_id
      WHERE re.relationship_id = ? ORDER BY re.participant_side, re.evidence_role, re.field_code`).all(relationshipId);
    return { ...relationshipRow(row), subjectName: row.subject_name, subjectVendorId: row.subject_vendor_id, counterpartName: row.counterpart_name, counterpartVendorId: row.counterpart_vendor_id, evidence };
  }

  function updateComparisonRelationshipReview(relationshipId, input = {}) {
    const before = db.prepare('SELECT * FROM comparison_relationships WHERE relationship_id = ?').get(relationshipId);
    if (!before) throw new Error('未找到对标关系。');
    const allowed = new Set(['candidate', 'review_required', 'approved', 'rejected', 'superseded']);
    const reviewState = input.reviewState || before.review_state;
    if (!allowed.has(reviewState)) throw new Error('对标关系审核状态不合法。');
    const reason = String(input.reason || '').trim();
    if (['approved', 'rejected', 'superseded'].includes(reviewState) && !reason) throw new Error('批准、驳回或替代对标关系时必须说明理由。');
    db.prepare('UPDATE comparison_relationships SET review_state = ?, updated_at = ? WHERE relationship_id = ?').run(reviewState, timestamp(), relationshipId);
    const after = db.prepare('SELECT * FROM comparison_relationships WHERE relationship_id = ?').get(relationshipId);
    auditGovernance({ actor: input.actor || 'local-admin', action: 'comparison_relationship_review', objectType: 'comparison_relationship', objectId: relationshipId, before: relationshipRow(before), after: { ...relationshipRow(after), reason }, reason });
    return relationshipRow(after);
  }

  function comparisonRelationshipMetrics(taskId = '') {
    const where = taskId ? 'WHERE task_id = ?' : '';
    const params = taskId ? [taskId] : [];
    const byStatus = Object.fromEntries(db.prepare(`SELECT match_status AS key, COUNT(*) AS count FROM comparison_relationships ${where} GROUP BY match_status`).all(...params).map((row) => [row.key, row.count]));
    const byReviewState = Object.fromEntries(db.prepare(`SELECT review_state AS key, COUNT(*) AS count FROM comparison_relationships ${where} GROUP BY review_state`).all(...params).map((row) => [row.key, row.count]));
    const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
    const evidenceLinks = db.prepare(`SELECT COUNT(*) AS count FROM comparison_relationship_evidence ${taskId ? 'WHERE relationship_id IN (SELECT relationship_id FROM comparison_relationships WHERE task_id = ?)' : ''}`).get(...params).count;
    return { total, byStatus, byReviewState, evidenceLinks };
  }

  const fieldScopes = createFieldScopeManager({ db, stableId, timestamp, json, parseJson, auditGovernance, upsertReviewItem });

  function bootstrapAleGovernance(actor = 'local-admin') {
    const series = db.prepare(`SELECT entity_id, canonical_name FROM entities WHERE vendor_id = 'ale' AND entity_type = 'series' ORDER BY canonical_name`).all();
    const documentCount = db.prepare(`SELECT COUNT(*) AS count FROM documents WHERE vendor_id = 'ale'`).get().count;
    if (!series.length || !documentCount) throw new Error('请先完成 ALE 只读导入，再创建 P0-2 治理试点任务。');
    const created = { tasks: 0, reviews: 0, reusedTasks: 0, reusedReviews: 0 };
    const run = db.transaction(() => {
      const task = upsertResearchTask({
        title: 'ALE OmniSwitch 纵向产品线基线审阅',
        mode: 'vertical',
        decisionQuestion: '基于已验证的 ALE OmniSwitch 官方 Data sheet 与 Order information 证据，确认哪些系列可进入后续产品定型、组合覆盖与横向对标分析。',
        scope: { vendorId: 'ale', productDomain: 'wired_switching', entityType: 'series', entityIds: series.map((item) => item.entity_id), entityCount: series.length },
        priority: 'high',
        status: 'evidence_review',
        baselineDescriptor: { importer: 'ale-readonly-importer', documentCount, evidenceRule: 'official_datasheet_and_embedded_order_information', initializedAt: timestamp() },
        owner: actor,
      });
      if (task.existed) created.reusedTasks += 1; else created.tasks += 1;
      const reviews = [
        {
          naturalKey: 'ale-omniswitch-core-technical-fields-p0-2', queueType: 'fact_quality', objectType: 'research_task', objectId: task.task_id, taskId: task.task_id,
          title: '定义 ALE OmniSwitch 园区交换机核心技术字段导入范围',
          reason: 'P0-1 当前导入的是资料与证据元数据；端口、PoE、性能、堆叠、OSPF 等用于产品定型的字段仍须通过受控抽取与人工证据审核进入事实层。',
          severity: 'high', source: { requiredFieldPack: 'campus_switching_v1', expectedFields: ['downlink_ports', 'uplink_ports', 'poe_budget', 'switching_capacity', 'forwarding_rate', 'stacking_virtualization', 'ospf_support'] },
        },
        {
          naturalKey: 'ale-omniswitch-baseline-evidence-approval-p0-2', queueType: 'evidence', objectType: 'research_task', objectId: task.task_id, taskId: task.task_id,
          title: '审核 ALE OmniSwitch P0-1 资料基线与证据策略',
          reason: '确认 15 份受控 Data sheet、SHA-256 基线和 Order information 证据策略可作为后续纵向研究任务的只读基线；该审核不修改原始资料。',
          severity: 'medium', source: { documentCount, seriesCount: series.length, evidencePolicy: 'official_datasheet_and_embedded_order_information' },
        },
      ];
      for (const input of reviews) {
        const review = upsertReviewItem({ ...input, owner: actor, status: 'open' });
        if (review.existed) created.reusedReviews += 1; else created.reviews += 1;
      }
      auditGovernance({ actor, action: 'bootstrap_ale_governance', objectType: 'research_task', objectId: task.task_id, after: { taskId: task.task_id, created, documentCount, seriesCount: series.length }, reason: '初始化 P0-2 ALE 纵向研究治理试点' });
      return task;
    });
    const task = run();
    return { task, created, metrics: governanceMetrics() };
  }

  function listResearchTasks() {
    return db.prepare('SELECT * FROM research_tasks ORDER BY CASE status WHEN \'evidence_review\' THEN 0 WHEN \'collecting\' THEN 1 WHEN \'draft\' THEN 2 ELSE 3 END, updated_at DESC').all().map(taskRow);
  }

  function listReviewItems(filters = {}) {
    const clauses = []; const params = [];
    if (filters.status) { clauses.push('r.status = ?'); params.push(filters.status); }
    if (filters.taskId) { clauses.push('r.task_id = ?'); params.push(filters.taskId); }
    const sql = `SELECT r.*, t.title AS task_title FROM review_items r LEFT JOIN research_tasks t ON t.task_id = r.task_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, CASE r.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 500`;
    return db.prepare(sql).all(...params).map((row) => ({ ...reviewRow(row), taskTitle: row.task_title || '' }));
  }

  function updateReviewItem(reviewId, input = {}) {
    const before = db.prepare('SELECT * FROM review_items WHERE review_id = ?').get(reviewId);
    if (!before) throw new Error('未找到审核项。');
    const allowed = new Set(['open', 'in_review', 'resolved', 'deferred', 'rejected']);
    const status = input.status || before.status;
    if (!allowed.has(status)) throw new Error('审核状态不合法。');
    const reason = String(input.reason || '').trim();
    if (['resolved', 'deferred', 'rejected'].includes(status) && !reason) throw new Error('关闭、延期或驳回审核项时必须说明理由。');
    const after = { ...before, status, owner: String(input.owner || before.owner).slice(0, 120), resolution_json: json({ ...parseJson(before.resolution_json), ...(input.resolution || {}), reason: reason || parseJson(before.resolution_json).reason || '', updatedAt: timestamp() }), updated_at: timestamp(), closed_at: ['resolved', 'deferred', 'rejected'].includes(status) ? timestamp() : null };
    db.prepare('UPDATE review_items SET status = ?, owner = ?, resolution_json = ?, updated_at = ?, closed_at = ? WHERE review_id = ?').run(after.status, after.owner, after.resolution_json, after.updated_at, after.closed_at, reviewId);
    auditGovernance({ actor: input.actor || 'local-admin', action: 'review_item_update', objectType: 'review_item', objectId: reviewId, before: reviewRow(before), after: reviewRow(after), reason });
    return reviewRow(after);
  }

  function governanceMetrics() {
    const seriesCount = db.prepare(`SELECT COUNT(*) AS count FROM entities WHERE vendor_id = 'ale' AND entity_type = 'series'`).get().count;
    const provenanceCodes = ['datasheet_sha256', 'evidence_policy', 'official_datasheet_url', 'official_file_name', 'official_product_page_url'];
    const provenanceFacts = db.prepare(`SELECT COUNT(DISTINCT f.entity_id || '|' || f.field_code) AS count FROM facts f JOIN entities e ON e.entity_id = f.entity_id
      WHERE e.vendor_id = 'ale' AND e.entity_type = 'series' AND f.field_code IN (${provenanceCodes.map(() => '?').join(',')})`).get(...provenanceCodes).count;
    const expectedProvenance = seriesCount * provenanceCodes.length;
    const aleTask = db.prepare(`SELECT task_id FROM research_tasks WHERE mode = 'vertical' AND title = 'ALE OmniSwitch 纵向产品线基线审阅'`).get();
    const activeScope = aleTask ? fieldScopes.activeTaskFieldPack(aleTask.task_id) : null;
    const technicalCodes = activeScope ? activeScope.items.filter((item) => item.selected).map((item) => item.fieldCode) : [];
    const technicalRows = technicalCodes.length ? db.prepare(`SELECT f.publication_state AS state, COUNT(DISTINCT f.entity_id || '|' || f.field_code) AS count FROM facts f JOIN entities e ON e.entity_id = f.entity_id
      WHERE e.vendor_id = 'ale' AND e.entity_type = 'series' AND f.field_code IN (${technicalCodes.map(() => '?').join(',')})
      GROUP BY f.publication_state`).all(...technicalCodes) : [];
    const technicalByState = Object.fromEntries(technicalRows.map((row) => [row.state, row.count]));
    const technicalVerified = technicalByState.evidence_verified || 0;
    const technicalNotDisclosed = technicalByState.not_disclosed || 0;
    const technicalNeedsReview = technicalByState.needs_review || 0;
    const technicalFacts = technicalVerified + technicalNotDisclosed + technicalNeedsReview;
    const expectedTechnical = seriesCount * technicalCodes.length;
    const freshnessCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const freshness = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN r.collected_at >= ? THEN 1 ELSE 0 END) AS fresh FROM document_revisions r
      JOIN documents d ON d.document_id = r.document_id WHERE d.vendor_id = 'ale' AND r.revision_state IN ('verified', 'verified_baseline')`).get(freshnessCutoff);
    const queueRows = db.prepare(`SELECT severity, COUNT(*) AS count FROM review_items WHERE status IN ('open', 'in_review') GROUP BY severity`).all();
    const openBySeverity = Object.fromEntries(queueRows.map((row) => [row.severity, row.count]));
    const taskStates = db.prepare('SELECT status, COUNT(*) AS count FROM research_tasks GROUP BY status').all();
    return {
      generatedAt: timestamp(),
      taskStates: Object.fromEntries(taskStates.map((row) => [row.status, row.count])),
      fieldCoverage: {
        provenance: { label: '资料与证据元数据', completed: provenanceFacts, expected: expectedProvenance, percent: expectedProvenance ? Math.round((provenanceFacts / expectedProvenance) * 1000) / 10 : 0, status: 'ready' },
        technical: { label: activeScope ? activeScope.name : '待产品经理定义的技术字段范围', completed: technicalFacts, expected: expectedTechnical, percent: expectedTechnical ? Math.round((technicalFacts / expectedTechnical) * 1000) / 10 : 0, verified: technicalVerified, notDisclosed: technicalNotDisclosed, needsReview: technicalNeedsReview, verifiedPercent: expectedTechnical ? Math.round((technicalVerified / expectedTechnical) * 1000) / 10 : 0, status: activeScope ? (technicalFacts === expectedTechnical && expectedTechnical ? (technicalNeedsReview ? 'review_required' : 'ready') : 'review_required') : 'scope_pending', fieldPack: activeScope?.templateId || '', activeScopeVersion: activeScope?.versionNumber || 0, selectedFieldCodes: technicalCodes },
      },
      fieldScope: { taskId: aleTask?.task_id || '', active: activeScope, pending: aleTask ? fieldScopes.fieldScopeSummary(aleTask.task_id).pending : null },
      freshness: { windowDays: 180, verifiedDocuments: freshness.total || 0, freshDocuments: freshness.fresh || 0, percent: freshness.total ? Math.round(((freshness.fresh || 0) / freshness.total) * 1000) / 10 : 0, status: freshness.total && freshness.fresh === freshness.total ? 'fresh' : 'review_required' },
      reviewQueue: { openTotal: Object.values(openBySeverity).reduce((sum, value) => sum + value, 0), bySeverity: { high: openBySeverity.high || 0, medium: openBySeverity.medium || 0, low: openBySeverity.low || 0 } },
    };
  }

  function overview() {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const byType = db.prepare('SELECT entity_type AS type, COUNT(*) AS count FROM entities GROUP BY entity_type ORDER BY entity_type').all();
    const byState = db.prepare('SELECT publication_state AS state, COUNT(*) AS count FROM facts GROUP BY publication_state ORDER BY publication_state').all();
    const lastImport = db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 1').get();
    return {
      schemaVersion: SCHEMA_VERSION,
      databasePath: dbPath,
      counts: { entities: count('entities'), documents: count('documents'), documentRevisions: count('document_revisions'), evidence: count('evidence'), facts: count('facts'), importRuns: count('import_runs'), researchTasks: count('research_tasks'), reviewItems: count('review_items'), comparisonRelationships: count('comparison_relationships'), comparisonRelationshipEvidence: count('comparison_relationship_evidence'), fieldTemplates: count('field_templates'), taskFieldPacks: count('task_field_packs') },
      entitiesByType: byType,
      factsByPublicationState: byState,
      lastImport: lastImport ? { ...lastImport, sourceDescriptor: parseJson(lastImport.source_descriptor_json), summary: parseJson(lastImport.summary_json) } : null,
    };
  }

  function listEntities(filters = {}) {
    const clauses = []; const params = [];
    if (filters.vendorId) { clauses.push('vendor_id = ?'); params.push(filters.vendorId); }
    if (filters.entityType) { clauses.push('entity_type = ?'); params.push(filters.entityType); }
    if (filters.q) { clauses.push('canonical_name LIKE ?'); params.push(`%${String(filters.q).slice(0, 120)}%`); }
    const sql = `SELECT entity_id, entity_type, vendor_id, parent_entity_id, canonical_name, natural_key, lifecycle_state, source_state, attributes_json, created_at, updated_at FROM entities ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY vendor_id, entity_type, canonical_name LIMIT 500`;
    return db.prepare(sql).all(...params).map((row) => ({ ...row, attributes: parseJson(row.attributes_json) }));
  }

  function entityDetail(entityId) {
    const entity = db.prepare('SELECT * FROM entities WHERE entity_id = ?').get(entityId);
    if (!entity) return null;
    const aliases = db.prepare('SELECT alias, alias_type, region FROM entity_aliases WHERE entity_id = ? ORDER BY alias').all(entityId);
    const facts = db.prepare(`SELECT f.*, e.source_url, e.quote_text, e.locator, e.evidence_scope, e.evidence_status, r.sha256, r.official_file_name, r.local_path, r.snapshot_id, d.title AS document_title, d.canonical_url, d.product_page_url
      FROM facts f JOIN evidence e ON e.evidence_id = f.evidence_id JOIN document_revisions r ON r.revision_id = e.revision_id JOIN documents d ON d.document_id = r.document_id
      WHERE f.entity_id = ? ORDER BY f.field_code, r.collected_at DESC`).all(entityId).map((row) => ({ ...row, value: parseJson(row.normalized_value_json), conditions: parseJson(row.conditions_json) }));
    return { ...entity, attributes: parseJson(entity.attributes_json), aliases, facts };
  }

  function listDocuments(filters = {}) {
    const clauses = []; const params = [];
    if (filters.vendorId) { clauses.push('d.vendor_id = ?'); params.push(filters.vendorId); }
    const sql = `SELECT d.document_id, d.vendor_id, d.series_entity_id, d.document_type, d.title, d.canonical_url, d.product_page_url, d.source_state,
      COUNT(r.revision_id) AS revision_count, MAX(r.collected_at) AS last_collected_at
      FROM documents d LEFT JOIN document_revisions r ON r.document_id = d.document_id ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY d.document_id ORDER BY d.vendor_id, d.title LIMIT 500`;
    return db.prepare(sql).all(...params);
  }

  function listImportRuns() {
    return db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 100').all().map((row) => ({ ...row, sourceDescriptor: parseJson(row.source_descriptor_json), summary: parseJson(row.summary_json) }));
  }

  function exportSnapshot() {
    const rows = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return {
      exportFormat: 'nvci_intelligence_snapshot_v1',
      exportedAt: timestamp(),
      schemaVersion: SCHEMA_VERSION,
      overview: overview(),
      entities: rows('entities').map((row) => ({ ...row, attributes: parseJson(row.attributes_json) })),
      entityAliases: rows('entity_aliases'),
      documents: rows('documents').map((row) => ({ ...row, attributes: parseJson(row.attributes_json) })),
      documentRevisions: rows('document_revisions').map((row) => ({ ...row, metadata: parseJson(row.metadata_json) })),
      evidence: rows('evidence'),
      facts: rows('facts').map((row) => ({ ...row, value: parseJson(row.normalized_value_json), conditions: parseJson(row.conditions_json) })),
      importRuns: listImportRuns(),
      importItems: rows('import_items').map((row) => ({ ...row, detail: parseJson(row.detail_json) })),
      researchTasks: rows('research_tasks').map(taskRow),
      reviewItems: rows('review_items').map(reviewRow),
      governanceAudit: rows('governance_audit').map((row) => ({ ...row, before: parseJson(row.before_json), after: parseJson(row.after_json) })),
      comparisonRelationships: rows('comparison_relationships').map(relationshipRow),
      comparisonRelationshipEvidence: rows('comparison_relationship_evidence'),
      comparisonRelationshipMetrics: comparisonRelationshipMetrics(),
      governanceMetrics: governanceMetrics(),
      ...fieldScopes.snapshotTables(),
    };
  }

  return {
    db,
    dbPath,
    schemaVersion: SCHEMA_VERSION,
    upsertEntity,
    upsertDocument,
    upsertRevision,
    upsertEvidence,
    upsertFact,
    startImport,
    finishImport,
    recordImportItem,
    overview,
    listEntities,
    entityDetail,
    listDocuments,
    listImportRuns,
    bootstrapAleGovernance,
    upsertResearchTask,
    listResearchTasks,
    listReviewItems,
    upsertReviewItem,
    updateReviewItem,
    upsertComparisonRelationship,
    linkComparisonRelationshipEvidence,
    listComparisonRelationships,
    comparisonRelationshipDetail,
    updateComparisonRelationshipReview,
    comparisonRelationshipMetrics,
    governanceMetrics,
    listFieldTemplates: fieldScopes.listFieldTemplates,
    getFieldTemplate: fieldScopes.getFieldTemplate,
    listTaskFieldPacks: fieldScopes.listTaskFieldPacks,
    fieldScopeSummary: fieldScopes.fieldScopeSummary,
    createTaskFieldPack: fieldScopes.createTaskFieldPack,
    approveTaskFieldPack: fieldScopes.approveTaskFieldPack,
    exportSnapshot,
    transaction: (fn) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

module.exports = { SCHEMA_VERSION, createIntelligenceCore, parseJson, stableId };
