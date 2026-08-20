'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 'p0-1.0';

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

  function overview() {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const byType = db.prepare('SELECT entity_type AS type, COUNT(*) AS count FROM entities GROUP BY entity_type ORDER BY entity_type').all();
    const byState = db.prepare('SELECT publication_state AS state, COUNT(*) AS count FROM facts GROUP BY publication_state ORDER BY publication_state').all();
    const lastImport = db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 1').get();
    return {
      schemaVersion: SCHEMA_VERSION,
      databasePath: dbPath,
      counts: { entities: count('entities'), documents: count('documents'), documentRevisions: count('document_revisions'), evidence: count('evidence'), facts: count('facts'), importRuns: count('import_runs') },
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
    exportSnapshot,
    transaction: (fn) => db.transaction(fn)(),
    close: () => db.close(),
  };
}

module.exports = { SCHEMA_VERSION, createIntelligenceCore, parseJson, stableId };
