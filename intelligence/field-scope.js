'use strict';

const DEFAULT_TEMPLATES = [
  {
    templateId: 'campus_switching_v1',
    name: '园区固定配置交换机｜核心技术字段 v1',
    productDomain: 'wired_switching',
    entityType: 'series',
    description: '用于接入/汇聚型固定配置园区交换机的产品定型、组合覆盖与横向技术对标。仅定义需要进入事实层的字段范围与证据门槛，不抽取或推断数值。',
    items: [
      ['form_factor', '产品形态', '硬件形态', 'enum', '', 'high', true, 'Data sheet'],
      ['downlink_ports', '下行端口配置', '端口与供电', 'structured', '', 'high', true, 'Data sheet 或 Order information'],
      ['downlink_speed', '下行端口速率', '端口与供电', 'structured', 'Gbps', 'high', true, 'Data sheet'],
      ['uplink_ports', '上行端口配置', '端口与供电', 'structured', '', 'high', true, 'Data sheet 或 Order information'],
      ['uplink_speed', '上行端口速率', '端口与供电', 'structured', 'Gbps', 'high', true, 'Data sheet'],
      ['poe_support', 'PoE 支持', '端口与供电', 'enum', '', 'high', true, 'Data sheet'],
      ['poe_budget', 'PoE 供电预算', '端口与供电', 'number', 'W', 'high', false, 'Data sheet；未披露必须标记未披露'],
      ['switching_capacity', '交换容量', '性能', 'number', 'Gbps/Tbps', 'high', true, 'Data sheet；保留厂商口径'],
      ['forwarding_rate', '包转发率', '性能', 'number', 'Mpps', 'high', false, 'Data sheet；未披露必须标记未披露'],
      ['stacking_virtualization', '堆叠/虚拟化能力', '架构与可靠性', 'enum', '', 'high', true, 'Data sheet 或官方配置指南'],
      ['max_stack_members', '最大堆叠成员数', '架构与可靠性', 'number', '台', 'medium', false, '官方配置指南优先'],
      ['l3_routing', '三层路由能力', '协议能力', 'enum', '', 'high', true, 'Data sheet 或官方配置指南'],
      ['ospf_support', 'OSPF 支持', '协议能力', 'enum', '', 'high', true, '官方配置指南优先；需注明软件版本'],
      ['vxlan_evpn_support', 'VXLAN/EVPN 支持', '协议能力', 'enum', '', 'medium', false, '官方配置指南优先；需注明适用版本/许可'],
      ['automation_api', '自动化/API 能力', '运维能力', 'enum', '', 'medium', false, '官方产品页、Data sheet 或开发者文档'],
      ['management_platform', '网管/云管能力', '运维能力', 'enum', '', 'medium', false, '官方产品页或网管资料'],
      ['acl_security', 'ACL/基础安全能力', '安全能力', 'enum', '', 'medium', false, 'Data sheet 或官方配置指南'],
    ].map(([fieldCode, label, fieldGroup, valueType, unitHint, priority, required, evidenceRequirement], index) => ({
      fieldCode, label, fieldGroup, valueType, unitHint, priority, required, evidenceRequirement, displayOrder: index + 1,
    })),
  },
];

function createFieldScopeManager({ db, stableId, timestamp, json, parseJson, auditGovernance, upsertReviewItem }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_templates (
      template_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      product_domain TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      template_state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS field_template_items (
      template_item_id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      field_code TEXT NOT NULL,
      label TEXT NOT NULL,
      field_group TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'text',
      unit_hint TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      required INTEGER NOT NULL DEFAULT 0,
      evidence_requirement TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(template_id, field_code),
      FOREIGN KEY(template_id) REFERENCES field_templates(template_id)
    );
    CREATE TABLE IF NOT EXISTS task_field_packs (
      task_field_pack_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      pack_status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT NOT NULL DEFAULT 'local-admin',
      created_at TEXT NOT NULL,
      submitted_at TEXT,
      approved_at TEXT,
      approved_by TEXT,
      superseded_at TEXT,
      UNIQUE(task_id, version_number),
      FOREIGN KEY(task_id) REFERENCES research_tasks(task_id),
      FOREIGN KEY(template_id) REFERENCES field_templates(template_id)
    );
    CREATE TABLE IF NOT EXISTS task_field_pack_items (
      task_field_pack_item_id TEXT PRIMARY KEY,
      task_field_pack_id TEXT NOT NULL,
      field_code TEXT NOT NULL,
      label TEXT NOT NULL,
      field_group TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'text',
      unit_hint TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium',
      required INTEGER NOT NULL DEFAULT 0,
      evidence_requirement TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(task_field_pack_id, field_code),
      FOREIGN KEY(task_field_pack_id) REFERENCES task_field_packs(task_field_pack_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_field_packs_task ON task_field_packs(task_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS idx_task_field_pack_items_pack ON task_field_pack_items(task_field_pack_id, selected, display_order);
  `);

  function seedTemplates() {
    const run = db.transaction(() => {
      for (const template of DEFAULT_TEMPLATES) {
        const now = timestamp();
        const existing = db.prepare('SELECT template_id FROM field_templates WHERE template_id = ?').get(template.templateId);
        if (existing) {
          db.prepare('UPDATE field_templates SET name = ?, product_domain = ?, entity_type = ?, description = ?, template_state = ?, updated_at = ? WHERE template_id = ?')
            .run(template.name, template.productDomain, template.entityType, template.description, 'active', now, template.templateId);
        } else {
          db.prepare('INSERT INTO field_templates(template_id, name, product_domain, entity_type, description, template_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(template.templateId, template.name, template.productDomain, template.entityType, template.description, 'active', now, now);
        }
        for (const item of template.items) {
          const current = db.prepare('SELECT template_item_id FROM field_template_items WHERE template_id = ? AND field_code = ?').get(template.templateId, item.fieldCode);
          if (current) {
            db.prepare(`UPDATE field_template_items SET label = ?, field_group = ?, value_type = ?, unit_hint = ?, priority = ?, required = ?, evidence_requirement = ?, display_order = ? WHERE template_id = ? AND field_code = ?`)
              .run(item.label, item.fieldGroup, item.valueType, item.unitHint, item.priority, item.required ? 1 : 0, item.evidenceRequirement, item.displayOrder, template.templateId, item.fieldCode);
          } else {
            db.prepare(`INSERT INTO field_template_items(template_item_id, template_id, field_code, label, field_group, value_type, unit_hint, priority, required, evidence_requirement, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(stableId('tmplfield', `${template.templateId}|${item.fieldCode}`), template.templateId, item.fieldCode, item.label, item.fieldGroup, item.valueType, item.unitHint, item.priority, item.required ? 1 : 0, item.evidenceRequirement, item.displayOrder);
          }
        }
      }
    });
    run();
  }

  function templateRow(row) {
    if (!row) return null;
    return {
      templateId: row.template_id,
      name: row.name,
      productDomain: row.product_domain,
      entityType: row.entity_type,
      description: row.description,
      templateState: row.template_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function packRow(row) {
    if (!row) return null;
    return {
      taskFieldPackId: row.task_field_pack_id,
      taskId: row.task_id,
      templateId: row.template_id,
      versionNumber: row.version_number,
      name: row.name,
      rationale: row.rationale,
      packStatus: row.pack_status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
      supersededAt: row.superseded_at,
    };
  }

  function itemRow(row) {
    return {
      fieldCode: row.field_code,
      label: row.label,
      fieldGroup: row.field_group,
      valueType: row.value_type,
      unitHint: row.unit_hint,
      priority: row.priority,
      required: Boolean(row.required),
      evidenceRequirement: row.evidence_requirement,
      displayOrder: row.display_order,
      selected: Boolean(row.selected),
    };
  }

  function listFieldTemplates() {
    return db.prepare('SELECT * FROM field_templates WHERE template_state = ? ORDER BY product_domain, name').all('active').map((row) => ({
      ...templateRow(row),
      items: db.prepare('SELECT * FROM field_template_items WHERE template_id = ? ORDER BY display_order').all(row.template_id).map(itemRow),
    }));
  }

  function getFieldTemplate(templateId) {
    const row = db.prepare('SELECT * FROM field_templates WHERE template_id = ?').get(templateId);
    if (!row) return null;
    return { ...templateRow(row), items: db.prepare('SELECT * FROM field_template_items WHERE template_id = ? ORDER BY display_order').all(templateId).map(itemRow) };
  }

  function listTaskFieldPacks(taskId) {
    return db.prepare('SELECT * FROM task_field_packs WHERE task_id = ? ORDER BY version_number DESC').all(taskId).map((row) => ({
      ...packRow(row),
      items: db.prepare('SELECT * FROM task_field_pack_items WHERE task_field_pack_id = ? ORDER BY display_order').all(row.task_field_pack_id).map(itemRow),
    }));
  }

  function activeTaskFieldPack(taskId) {
    const row = db.prepare(`SELECT * FROM task_field_packs WHERE task_id = ? AND pack_status = 'active' ORDER BY version_number DESC LIMIT 1`).get(taskId);
    if (!row) return null;
    return { ...packRow(row), items: db.prepare('SELECT * FROM task_field_pack_items WHERE task_field_pack_id = ? ORDER BY display_order').all(row.task_field_pack_id).map(itemRow) };
  }

  function fieldScopeSummary(taskId) {
    const packs = listTaskFieldPacks(taskId);
    const active = packs.find((pack) => pack.packStatus === 'active') || null;
    const pending = packs.find((pack) => ['draft', 'pending_approval'].includes(pack.packStatus)) || null;
    return { active, pending, versions: packs };
  }

  function createTaskFieldPack(input) {
    const task = db.prepare('SELECT task_id, title, scope_json FROM research_tasks WHERE task_id = ?').get(input.taskId);
    if (!task) throw new Error('未找到研究任务。');
    const template = getFieldTemplate(input.templateId);
    if (!template) throw new Error('未找到字段模板。');
    const selectedCodes = new Set((Array.isArray(input.selectedFieldCodes) ? input.selectedFieldCodes : template.items.map((item) => item.fieldCode)).map(String));
    const invalidCodes = [...selectedCodes].filter((code) => !template.items.some((item) => item.fieldCode === code));
    if (invalidCodes.length) throw new Error(`字段模板中不存在：${invalidCodes.join(', ')}`);
    const selectedItems = template.items.filter((item) => selectedCodes.has(item.fieldCode));
    if (!selectedItems.length) throw new Error('至少选择一个技术字段。');
    const now = timestamp();
    const versionNumber = (db.prepare('SELECT MAX(version_number) AS version FROM task_field_packs WHERE task_id = ?').get(input.taskId).version || 0) + 1;
    const packId = stableId('fieldpack', `${input.taskId}|${versionNumber}|${template.templateId}`);
    const rationale = String(input.rationale || '').trim();
    const name = `${template.name} · v${versionNumber}`;
    const actor = input.actor || 'local-admin';
    const run = db.transaction(() => {
      const oldDrafts = db.prepare(`SELECT task_field_pack_id FROM task_field_packs WHERE task_id = ? AND pack_status IN ('draft', 'pending_approval')`).all(input.taskId);
      db.prepare(`UPDATE task_field_packs SET pack_status = 'superseded', superseded_at = ? WHERE task_id = ? AND pack_status IN ('draft', 'pending_approval')`).run(now, input.taskId);
      db.prepare(`INSERT INTO task_field_packs(task_field_pack_id, task_id, template_id, version_number, name, rationale, pack_status, created_by, created_at, submitted_at, approved_at, approved_by, superseded_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?, NULL, NULL, NULL)`)
        .run(packId, input.taskId, template.templateId, versionNumber, name, rationale, actor, now, now);
      for (const item of template.items) {
        db.prepare(`INSERT INTO task_field_pack_items(task_field_pack_item_id, task_field_pack_id, field_code, label, field_group, value_type, unit_hint, priority, required, evidence_requirement, display_order, selected, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(stableId('fieldpackitem', `${packId}|${item.fieldCode}`), packId, item.fieldCode, item.label, item.fieldGroup, item.valueType, item.unitHint, item.priority, item.required ? 1 : 0, item.evidenceRequirement, item.displayOrder, selectedCodes.has(item.fieldCode) ? 1 : 0, now);
      }
      const review = upsertReviewItem({
        naturalKey: `field-scope-approval|${input.taskId}|${versionNumber}`,
        queueType: 'field_scope',
        objectType: 'task_field_pack',
        objectId: packId,
        taskId: input.taskId,
        title: `审批技术字段范围：${template.name} v${versionNumber}`,
        reason: `产品经理已选定 ${selectedItems.length} 个字段；批准后该范围成为后续受控抽取与字段覆盖率计算的唯一口径。${rationale ? ` 说明：${rationale}` : ''}`,
        severity: 'high',
        owner: actor,
        status: 'open',
        source: { templateId: template.templateId, selectedFieldCodes: [...selectedCodes], selectedCount: selectedItems.length, taskTitle: task.title },
      });
      auditGovernance({ actor, action: 'task_field_pack_submitted', objectType: 'task_field_pack', objectId: packId, after: { taskId: input.taskId, templateId: template.templateId, versionNumber, selectedFieldCodes: [...selectedCodes], replacedDrafts: oldDrafts.map((row) => row.task_field_pack_id), reviewId: review.review_id }, reason: rationale || '提交产品经理技术字段范围，等待批准' });
    });
    run();
    return { ...fieldScopeSummary(input.taskId), createdPackId: packId };
  }

  function approveTaskFieldPack(packId, input = {}) {
    const row = db.prepare('SELECT * FROM task_field_packs WHERE task_field_pack_id = ?').get(packId);
    if (!row) throw new Error('未找到字段范围版本。');
    if (row.pack_status !== 'pending_approval') throw new Error('仅待批准的字段范围可生效。');
    const reason = String(input.reason || '').trim();
    if (!reason) throw new Error('批准字段范围时必须说明决策依据。');
    const actor = input.actor || 'local-admin';
    const now = timestamp();
    const run = db.transaction(() => {
      db.prepare(`UPDATE task_field_packs SET pack_status = 'superseded', superseded_at = ? WHERE task_id = ? AND pack_status = 'active'`).run(now, row.task_id);
      db.prepare(`UPDATE task_field_packs SET pack_status = 'active', approved_at = ?, approved_by = ? WHERE task_field_pack_id = ?`).run(now, actor, packId);
      const review = db.prepare(`SELECT * FROM review_items WHERE object_type = 'task_field_pack' AND object_id = ? ORDER BY created_at DESC LIMIT 1`).get(packId);
      if (review) {
        const resolution = { ...parseJson(review.resolution_json), approvedPackId: packId, reason, approvedAt: now };
        db.prepare(`UPDATE review_items SET status = 'resolved', owner = ?, resolution_json = ?, updated_at = ?, closed_at = ? WHERE review_id = ?`).run(actor, json(resolution), now, now, review.review_id);
        auditGovernance({ actor, action: 'field_scope_approved', objectType: 'review_item', objectId: review.review_id, before: { status: review.status }, after: { status: 'resolved', packId }, reason });
      }
      const legacyReview = db.prepare(`SELECT * FROM review_items WHERE natural_key = 'ale-omniswitch-core-technical-fields-p0-2'`).get();
      if (legacyReview && legacyReview.status !== 'resolved') {
        const resolution = { ...parseJson(legacyReview.resolution_json), approvedPackId: packId, reason, approvedAt: now, supersededBy: 'product-manager-field-scope' };
        db.prepare(`UPDATE review_items SET status = 'resolved', owner = ?, resolution_json = ?, updated_at = ?, closed_at = ? WHERE review_id = ?`).run(actor, json(resolution), now, now, legacyReview.review_id);
        auditGovernance({ actor, action: 'legacy_field_scope_review_resolved', objectType: 'review_item', objectId: legacyReview.review_id, before: { status: legacyReview.status }, after: { status: 'resolved', packId }, reason });
      }
      db.prepare(`UPDATE research_tasks SET status = 'field_scope_ready', updated_at = ? WHERE task_id = ?`).run(now, row.task_id);
      auditGovernance({ actor, action: 'task_field_pack_approved', objectType: 'task_field_pack', objectId: packId, before: { packStatus: row.pack_status }, after: { packStatus: 'active', approvedAt: now, approvedBy: actor, taskStatus: 'field_scope_ready' }, reason });
    });
    run();
    return fieldScopeSummary(row.task_id);
  }

  function snapshotTables() {
    const rows = (table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return {
      fieldTemplates: rows('field_templates'),
      fieldTemplateItems: rows('field_template_items'),
      taskFieldPacks: rows('task_field_packs'),
      taskFieldPackItems: rows('task_field_pack_items'),
    };
  }

  seedTemplates();
  return { listFieldTemplates, getFieldTemplate, listTaskFieldPacks, activeTaskFieldPack, fieldScopeSummary, createTaskFieldPack, approveTaskFieldPack, snapshotTables };
}

module.exports = { DEFAULT_TEMPLATES, createFieldScopeManager };
