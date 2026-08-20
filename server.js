const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureBundledProfiles, enqueueRun, listProfiles, profilePaths, readProfile, writeJsonAtomic } = require('./automation/collector-core');
const { assertOfficialHttps, normalizeProfileDraft, profileDetail } = require('./automation/config-schema');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.NVCI_DATA_DIR || '/data';
const ADMIN_PASSWORD = process.env.NVCI_ADMIN_PASSWORD || 'change-me-before-production';
const SESSION_SECRET = process.env.NVCI_SESSION_SECRET || 'change-me-before-production-session-secret';
const COOKIE_NAME = 'nvci_session';
const SESSION_TTL = 1000 * 60 * 60 * 12;
const MAX_RUNS = 100;
const LIBRARY_HOST_PATH = process.env.NVCI_LIBRARY_HOST_PATH || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: 0, etag: true }));

function mkdir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function file(name) { return path.join(DATA_DIR, name); }
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  mkdir(DATA_DIR);
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}
function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().slice(0, 8)}`; }
function hmac(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex'); }
function signSession() { const expires = Date.now() + SESSION_TTL; const payload = `admin.${expires}`; return `${payload}.${hmac(payload)}`; }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i), decodeURIComponent(v.slice(i + 1))]; })); }
function validSession(req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = hmac(payload);
  if (parts[2].length !== expected.length) return false;
  return parts[0] === 'admin' && Number(parts[1]) > Date.now() && crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
}
function auth(req, res, next) { if (!validSession(req)) return res.status(401).json({ error: '请先登录本地工作台。' }); next(); }

const seedVendors = [
  { id: 'ale', name: 'ALE', products: '交换机、无线、网络管理与安全', domains: ['al-enterprise.com'], primaryEvidence: '官方 Data sheet 与 Order information', strategy: '产品页发现；数据表/Order information 为型号主证据；PDF 优先。', healthUrl: 'https://www.al-enterprise.com/en/products', status: 'verified', lastVerified: '2026-08-19' },
  { id: 'hpe', name: 'HPE Networking', products: 'Aruba CX、Aruba WLAN、Juniper EX/无线、Central/Mist', domains: ['hpe.com', 'arubanetworks.com'], primaryEvidence: 'Data sheet → Specifications → QuickSpecs', strategy: '官网数据表为主；商城页面只按固定优先级补充。', healthUrl: 'https://www.hpe.com/us/en/networking.html', status: 'verified', lastVerified: '2026-08-18' },
  { id: 'cisco', name: 'Cisco', products: '交换机、无线', domains: ['cisco.com'], primaryEvidence: 'Data sheet 页面一对一 c/dam PDF', strategy: '必须精确映射页面内对应的官方 c/dam PDF；无 PDF 时才留 HTML。', healthUrl: 'https://www.cisco.com/site/us/en/products/networking/switches/index.html', status: 'verified', lastVerified: '2026-08-18' },
  { id: 'h3c', name: '新华三 H3C', products: '交换机、无线、路由器、技术文档', domains: ['h3c.com', 'download.h3c.com'], primaryEvidence: '官方产品页、download.h3c.com PDF、文档中心', strategy: '产品树发现；使用 curl 下载；技术文档须按版本与类型分层并验证匿名公开性。', healthUrl: 'https://www.h3c.com/cn/Products_And_Solution/InterConnect/Products/Switches/', status: 'verified', lastVerified: '2026-08-18' },
  { id: 'ruijie', name: '锐捷网络', products: '交换机、无线、云桌面、安全、路由器、软件、AI+数据', domains: ['ruijie.com.cn', 'yx.ruijie.com.cn'], primaryEvidence: '产品页资源 ID；预览/下载按钮实际 PDF', strategy: '先验证 PreviewFile；失败不得认定无资料；下载文件按钮签名 URL 需逐件、合规取得。', healthUrl: 'https://www.ruijie.com.cn/cp/', status: 'verified', lastVerified: '2026-08-19' },
  { id: 'huawei', name: '华为企业网络', products: '园区交换机、数据中心交换机、无线、路由器、安全、网络管控与分析', domains: ['e.huawei.com', 'e-file.huawei.com'], primaryEvidence: '企业网络资料页关联的官方 PDF；五道门禁', strategy: '从企业网络入口按类别、分组、系列与官方资料页建立资料链；仅在资料页实际关联且通过 PDF 签名、SHA-256、系列/型号匹配门禁后归档。', healthUrl: 'https://e.huawei.com/cn/solutions/enterprise-network', status: 'verified', lastVerified: '2026-08-19' }
];

const seedProducts = [
  { id: 'ruijie-ap520', vendor: 'ruijie', line: '无线', category: '面板型 AP', name: 'RG-AP520（BT）', status: 'pdf_acquired', productUrl: 'https://www.ruijie.com.cn/cp/resources/?id=1497', resourceId: '1497', pdfUrl: 'official_download_button_signed_url', note: '用户定位并完成下载文件按钮验证', verifiedAt: '2026-08-19' },
  { id: 'ruijie-ap110a', vendor: 'ruijie', line: '无线', category: '面板型 AP', name: 'RG-AP110-A', status: 'pdf_acquired', productUrl: 'https://www.ruijie.com.cn/cp/resources/?id=19909', resourceId: '19909', pdfUrl: 'official_download_button_signed_url', note: '用户定位并完成下载文件按钮验证', verifiedAt: '2026-08-19' },
  { id: 'ruijie-s5750-24e', vendor: 'ruijie', line: '交换机', category: '园区网/汇聚', name: 'RG-S5750-24GT/8SFP-E', status: 'user_confirmed_no_brochure', productUrl: 'https://www.ruijie.com.cn/cp/jh-yqw-hjjh/24gt8sfpe/', resourceId: '', pdfUrl: '', note: '用户确认无彩页素材', verifiedAt: '2026-08-19' },
  { id: 'ruijie-s5750-24p', vendor: 'ruijie', line: '交换机', category: '园区网/汇聚', name: 'RG-S5750-24GT/8SFP-P', status: 'user_confirmed_no_brochure', productUrl: 'https://www.ruijie.com.cn/cp/jh-yqw-hjjh/24gt8sfpp/', resourceId: '', pdfUrl: '', note: '用户确认无彩页素材', verifiedAt: '2026-08-19' },
  { id: 'ruijie-s5750-24s', vendor: 'ruijie', line: '交换机', category: '园区网/汇聚', name: 'RG-S5750-24SFP/8GT-E', status: 'user_confirmed_no_brochure', productUrl: 'https://www.ruijie.com.cn/cp/jh-yqw-hjjh/24sfp8gte/', resourceId: '', pdfUrl: '', note: '用户确认无彩页素材', verifiedAt: '2026-08-19' },
  { id: 'ruijie-s5750-48e', vendor: 'ruijie', line: '交换机', category: '园区网/汇聚', name: 'RG-S5750-48GT/4SFP-E', status: 'user_confirmed_no_brochure', productUrl: 'https://www.ruijie.com.cn/cp/jh-yqw-hjjh/48gt4sfpe/', resourceId: '', pdfUrl: '', note: '用户确认无彩页素材', verifiedAt: '2026-08-19' },
  { id: 'ruijie-s5750-48p', vendor: 'ruijie', line: '交换机', category: '园区网/汇聚', name: 'RG-S5750-48GT/4SFP-P', status: 'user_confirmed_no_brochure', productUrl: 'https://www.ruijie.com.cn/cp/jh-yqw-hjjh/48gt4sfpp/', resourceId: '', pdfUrl: '', note: '用户确认无彩页素材', verifiedAt: '2026-08-19' },
  { id: 'h3c-s12500', vendor: 'h3c', line: '交换机', category: '核心交换机', name: 'S12500', status: 'pdf_acquired', productUrl: 'https://www.h3c.com/cn/Service/Document_Software/Document_Center/Switches/Catalog/S12500/S12500/?CHID=105824&v=612', resourceId: '', pdfUrl: 'download.h3c.com', note: '技术文档试点：配置、命令、故障处理', verifiedAt: '2026-08-18' }
];

const seedDocuments = [
  { id: 'doc-rg1497', vendor: 'ruijie', product: 'RG-AP520（BT）', title: 'RG-AP520（BT）无线接入点产品彩页', source: '资源中心下载文件', resourceId: '1497', sha256: '917e59444bc6…', status: 'active', collectedAt: '2026-08-19', path: '02 无线/面板型 AP' },
  { id: 'doc-rg19909', vendor: 'ruijie', product: 'RG-AP110-A', title: 'RG-AP110-A 802.11n 单频双流面板型无线接入点产品彩页', source: '资源中心下载文件', resourceId: '19909', sha256: '4e3e48f74d6…', status: 'active', collectedAt: '2026-08-19', path: '02 无线/面板型 AP' },
  { id: 'doc-h3c-s12500', vendor: 'h3c', product: 'S12500', title: '三层技术 IP 路由命令参考', source: 'H3C 文档中心', resourceId: 'R1828P04', sha256: 'local-manifest', status: 'active', collectedAt: '2026-08-18', path: '01 交换机/S12500/R1828P04/命令参考' }
];

function mergeMissingSeedVendors() {
  const vendors = readJson('vendor-memories.json', []);
  const knownIds = new Set(vendors.map((vendor) => vendor.id));
  const missing = seedVendors.filter((vendor) => !knownIds.has(vendor.id));
  if (missing.length) writeJson('vendor-memories.json', [...vendors, ...missing]);
}

function ensureStore() {
  mkdir(DATA_DIR); mkdir(path.join(DATA_DIR, 'library')); mkdir(path.join(DATA_DIR, 'imports')); mkdir(path.join(DATA_DIR, 'exports'));
  ensureBundledProfiles(DATA_DIR);
  if (!fs.existsSync(file('vendor-memories.json'))) writeJson('vendor-memories.json', seedVendors);
  else mergeMissingSeedVendors();
  if (!fs.existsSync(file('products.json'))) writeJson('products.json', seedProducts);
  if (!fs.existsSync(file('documents.json'))) writeJson('documents.json', seedDocuments);
  if (!fs.existsSync(file('runs.json'))) writeJson('runs.json', []);
  if (!fs.existsSync(file('settings.json'))) writeJson('settings.json', { libraryPath: path.join(DATA_DIR, 'library'), readOnly: false, autoHealthCheck: false, healthIntervalHours: 168, initializedAt: now() });
}
ensureStore();

function recursiveScan(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) recursiveScan(full, out);
    else {
      const stat = fs.statSync(full);
      out.push({ relativePath: path.relative(root, full), fileName: entry.name, ext: path.extname(entry.name).toLowerCase(), bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return out;
}
function textCompare(left, right) { return String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' }); }
function libraryEntryType(entry) { return ['.pdf', '.csv', '.json'].includes(entry.ext) ? entry.ext.slice(1) : 'other'; }
function normalizedLibraryQuery(query = {}) {
  const pageSize = [10, 20, 50].includes(Number(query.pageSize)) ? Number(query.pageSize) : 20;
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const sort = ['path_asc', 'path_desc', 'modified_desc', 'modified_asc', 'size_desc', 'size_asc', 'type_asc'].includes(String(query.sort)) ? String(query.sort) : 'path_asc';
  const type = ['pdf', 'csv', 'json', 'other'].includes(String(query.type)) ? String(query.type) : '';
  return { page, pageSize, sort, type, q: String(query.q || '').trim().slice(0, 200) };
}
function scanLibrary(query) {
  const settings = readJson('settings.json', {});
  const root = settings.libraryPath || path.join(DATA_DIR, 'library');
  const entries = recursiveScan(root);
  const counts = { pdf: 0, csv: 0, json: 0, other: 0, bytes: 0 };
  for (const entry of entries) { counts.bytes += entry.bytes; counts[libraryEntryType(entry)] += 1; }
  const filters = normalizedLibraryQuery(query);
  const needle = filters.q.toLocaleLowerCase('zh-CN');
  let filtered = entries.filter((entry) => (!filters.type || libraryEntryType(entry) === filters.type) && (!needle || `${entry.relativePath} ${entry.fileName} ${entry.ext}`.toLocaleLowerCase('zh-CN').includes(needle)));
  const sorters = {
    path_asc: (a, b) => textCompare(a.relativePath, b.relativePath),
    path_desc: (a, b) => textCompare(b.relativePath, a.relativePath),
    modified_desc: (a, b) => textCompare(b.modifiedAt, a.modifiedAt) || textCompare(a.relativePath, b.relativePath),
    modified_asc: (a, b) => textCompare(a.modifiedAt, b.modifiedAt) || textCompare(a.relativePath, b.relativePath),
    size_desc: (a, b) => b.bytes - a.bytes || textCompare(a.relativePath, b.relativePath),
    size_asc: (a, b) => a.bytes - b.bytes || textCompare(a.relativePath, b.relativePath),
    type_asc: (a, b) => textCompare(libraryEntryType(a), libraryEntryType(b)) || textCompare(a.relativePath, b.relativePath),
  };
  filtered = filtered.sort(sorters[filters.sort]);
  const filteredCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(filteredCount / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const start = (page - 1) * filters.pageSize;
  return { root, hostPath: LIBRARY_HOST_PATH, counts, entries: filtered.slice(start, start + filters.pageSize), entryCount: entries.length, filteredCount, page, pageSize: filters.pageSize, pageCount, sort: filters.sort, type: filters.type, q: filters.q };
}
function runs() { return readJson('runs.json', []); }
function addRun(run) { const items = [run, ...runs()].slice(0, MAX_RUNS); writeJson('runs.json', items); return run; }
function statusLabel(status) { return ({ pdf_acquired: '已获公开 PDF', user_confirmed_no_brochure: '用户确认无彩页', source_unavailable: '资源 404', restricted: '访问受限', no_resource_link: '未发现资源入口', page_access_gap: '产品页访问缺口', pending: '待复核' })[status] || status; }
function profileDetails(profileId) { const profile = readProfile(DATA_DIR, profileId); const state = readJson(path.join('automation', 'profiles', profileId, 'state.json'), {}); return profileDetail(profile, state); }
function syncVendorFromProfile(profile) {
  const vendors = readJson('vendor-memories.json', []); const index = vendors.findIndex((vendor) => vendor.id === profile.vendorId);
  const record = { id: profile.vendorId, name: profile.vendorName || profile.vendorId, products: profile.productLine?.name || '未分类', domains: profile.officialDomains, primaryEvidence: profile.evidencePolicy || '官方公开资料', strategy: profile.sourcePolicy, healthUrl: profile.sources?.[0]?.productPageUrl || profile.sources?.[0]?.pdfUrl || '', status: 'pending', lastEditedAt: now() };
  if (index >= 0) vendors[index] = { ...vendors[index], ...record, products: vendors[index].products || record.products }; else vendors.push(record);
  writeJson('vendor-memories.json', vendors);
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'NVCI Workbench', at: now() }));
app.post('/api/login', (req, res) => {
  if (typeof req.body.password !== 'string' || req.body.password.length < 1 || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: '本地管理员密码不正确。' });
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(signSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); res.json({ ok: true }); });
app.get('/api/session', (req, res) => res.json({ authenticated: validSession(req) }));

app.get('/api/overview', auth, (req, res) => {
  const vendors = readJson('vendor-memories.json', []);
  const products = readJson('products.json', []);
  const docs = readJson('documents.json', []);
  const recent = runs().slice(0, 6);
  const groups = {};
  for (const product of products) groups[product.status] = (groups[product.status] || 0) + 1;
  res.json({ vendors, products, documents: docs, stats: { vendorCount: vendors.length, productCount: products.length, pdfCount: products.filter(p => p.status === 'pdf_acquired').length, confirmedNoBrochure: products.filter(p => p.status === 'user_confirmed_no_brochure').length, byStatus: groups, documentCount: docs.length }, recentRuns: recent, demoData: true });
});
app.get('/api/vendors', auth, (req, res) => res.json(readJson('vendor-memories.json', [])));
app.put('/api/vendors/:id', auth, (req, res) => {
  const vendors = readJson('vendor-memories.json', []); const index = vendors.findIndex(v => v.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到厂商记忆。' });
  vendors[index] = { ...vendors[index], ...req.body, id: vendors[index].id, lastEditedAt: now() }; writeJson('vendor-memories.json', vendors); res.json(vendors[index]);
});
app.get('/api/products', auth, (req, res) => {
  let items = readJson('products.json', []); const { vendor, status, q } = req.query;
  if (vendor) items = items.filter(p => p.vendor === vendor); if (status) items = items.filter(p => p.status === status);
  if (q) { const needle = String(q).toLowerCase(); items = items.filter(p => Object.values(p).join(' ').toLowerCase().includes(needle)); }
  res.json(items.map(p => ({ ...p, statusLabel: statusLabel(p.status) })));
});
app.post('/api/products/:id/confirm-no-brochure', auth, (req, res) => {
  const products = readJson('products.json', []); const index = products.findIndex(p => p.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: '未找到产品。' });
  products[index] = { ...products[index], status: 'user_confirmed_no_brochure', note: req.body.note || '管理员确认无彩页素材', verifiedAt: now().slice(0, 10), confirmedBy: 'local-admin' }; writeJson('products.json', products);
  addRun({ id: id('confirm'), type: '人工确认', status: 'completed', summary: `将 ${products[index].name} 标记为用户确认无彩页素材`, createdAt: now(), details: products[index] }); res.json(products[index]);
});
app.get('/api/documents', auth, (req, res) => res.json(readJson('documents.json', [])));
app.get('/api/runs', auth, (req, res) => res.json(runs()));
app.get('/api/settings', auth, (req, res) => res.json(readJson('settings.json', {})));
app.put('/api/settings', auth, (req, res) => { const setting = { ...readJson('settings.json', {}), ...req.body, updatedAt: now() }; writeJson('settings.json', setting); res.json(setting); });
app.get('/api/library/scan', auth, (req, res) => res.json(scanLibrary(req.query)));
app.post('/api/import/products', auth, (req, res) => {
  const incoming = Array.isArray(req.body.records) ? req.body.records : []; if (!incoming.length) return res.status(400).json({ error: '请提交 records 数组。' });
  const products = readJson('products.json', []); let added = 0, updated = 0;
  for (const raw of incoming.slice(0, 5000)) { if (!raw.name || !raw.vendor) continue; const key = raw.id || `${raw.vendor}:${raw.name}`; const index = products.findIndex(p => p.id === key || (p.vendor === raw.vendor && p.name === raw.name)); const normalized = { id: key, vendor: raw.vendor, line: raw.line || '未分类', category: raw.category || '未分类', name: raw.name, status: raw.status || 'pending', productUrl: raw.productUrl || '', resourceId: raw.resourceId || '', pdfUrl: raw.pdfUrl || '', note: raw.note || '', verifiedAt: raw.verifiedAt || now().slice(0, 10) }; if (index >= 0) { products[index] = { ...products[index], ...normalized }; updated++; } else { products.push(normalized); added++; } }
  writeJson('products.json', products); addRun({ id: id('import'), type: '导入产品状态', status: 'completed', summary: `新增 ${added}，更新 ${updated} 条产品状态`, createdAt: now() }); res.json({ added, updated, total: products.length });
});
app.post('/api/health-check', auth, async (req, res) => {
  const vendors = readJson('vendor-memories.json', []); const requested = Array.isArray(req.body.vendorIds) ? req.body.vendorIds : vendors.map(v => v.id); const selected = vendors.filter(v => requested.includes(v.id)); const results = [];
  for (const vendor of selected.slice(0, 8)) {
    const started = Date.now(); let result;
    try { const response = await fetch(vendor.healthUrl, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'NVCI-HealthCheck/0.1 (local incremental audit)' } }); result = { vendorId: vendor.id, url: vendor.healthUrl, status: response.status, contentType: response.headers.get('content-type') || '', etag: response.headers.get('etag') || '', lastModified: response.headers.get('last-modified') || '', contentLength: response.headers.get('content-length') || '', decision: response.status >= 200 && response.status < 400 ? 'reuse_unchanged_or_compare_metadata' : response.status === 404 ? 'source_unavailable' : 'needs_route_validation', elapsedMs: Date.now() - started }; }
    catch (error) { result = { vendorId: vendor.id, url: vendor.healthUrl, status: 0, decision: 'needs_route_validation', error: String(error.message || error), elapsedMs: Date.now() - started }; }
    results.push(result);
  }
  const vendorMap = new Map(vendors.map(v => [v.id, v])); for (const item of results) { const vendor = vendorMap.get(item.vendorId); if (vendor) { vendor.status = item.decision === 'reuse_unchanged_or_compare_metadata' ? 'healthy' : 'needs_validation'; vendor.lastHealthCheck = now(); vendor.lastHealthDecision = item.decision; } }
  writeJson('vendor-memories.json', vendors); const run = addRun({ id: id('health'), type: '路径健康检查', status: results.every(r => r.decision === 'reuse_unchanged_or_compare_metadata') ? 'completed' : 'attention', summary: `完成 ${results.length} 个厂商样本检查；仅记录 HTTP 元数据，未下载资料。`, createdAt: now(), results }); res.json({ run, results });
});
app.get('/api/source-configs', auth, (req, res) => { ensureBundledProfiles(DATA_DIR); res.json(listProfiles(DATA_DIR).map((item) => profileDetails(item.profileId))); });
app.get('/api/source-configs/:profileId', auth, (req, res) => { try { res.json(profileDetails(req.params.profileId)); } catch (error) { res.status(404).json({ error: String(error.message || error) }); } });
app.post('/api/source-configs', auth, (req, res) => {
  try { const profile = normalizeProfileDraft(req.body || {}); const target = profilePaths(DATA_DIR, profile.profileId).profileFile; if (fs.existsSync(target)) throw new Error(`来源配置已存在：${profile.profileId}`); writeJsonAtomic(target, profile); syncVendorFromProfile(profile); addRun({ id: id('source-config'), type: '来源配置新建', status: 'completed', summary: `新建 ${profile.vendorName} / ${profile.productLine.name} / ${profile.subseries.name} 草稿，含 ${profile.sources.length} 条资料`, createdAt: now(), details: { profileId: profile.profileId, approvalStatus: profile.approvalStatus } }); res.status(201).json(profileDetails(profile.profileId)); } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.put('/api/source-configs/:profileId', auth, (req, res) => {
  try { const existing = readProfile(DATA_DIR, req.params.profileId); const profile = normalizeProfileDraft({ ...(req.body || {}), profileId: existing.profileId }, existing); const target = profilePaths(DATA_DIR, existing.profileId).profileFile; writeJsonAtomic(target, profile); syncVendorFromProfile(profile); addRun({ id: id('source-config-edit'), type: '来源配置编辑', status: 'completed', summary: `已更新 ${profile.displayName}；配置已回到草稿待样本验证状态`, createdAt: now(), details: { profileId: profile.profileId } }); res.json(profileDetails(profile.profileId)); } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.post('/api/source-configs/:profileId/sample-check', auth, async (req, res) => {
  try {
    const profile = readProfile(DATA_DIR, req.params.profileId); const sample = profile.sources.slice(0, 5); const results = [];
    for (const source of sample) { const started = Date.now(); try { const url = assertOfficialHttps(source.pdfUrl, profile.officialDomains, `${source.documentId} PDF URL`); const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'NVCI-ConfigSample/0.3 (local official-source review)' } }); const contentType = response.headers.get('content-type') || ''; const ok = response.status >= 200 && response.status < 400 && contentType.toLowerCase().includes('pdf'); results.push({ documentId: source.documentId, series: source.series, modelNames: source.modelNames || [], url, status: response.status, contentType, etag: response.headers.get('etag') || '', lastModified: response.headers.get('last-modified') || '', contentLength: Number(response.headers.get('content-length') || 0), elapsedMs: Date.now() - started, ok, error: ok ? '' : '公开 PDF 样本未通过' }); } catch (error) { results.push({ documentId: source.documentId, series: source.series, modelNames: source.modelNames || [], status: 0, elapsedMs: Date.now() - started, ok: false, error: String(error.message || error) }); } }
    const passed = results.length === sample.length && results.every((item) => item.ok); profile.sampleCheck = { checkedAt: now(), passed, sampleCount: sample.length, results }; profile.approvalStatus = passed ? 'sample_verified' : 'draft'; profile.enabled = false; profile.updatedAt = now(); writeJsonAtomic(profilePaths(DATA_DIR, profile.profileId).profileFile, profile); addRun({ id: id('source-sample'), type: '来源样本检查', status: passed ? 'completed' : 'attention', summary: `${profile.displayName}：${passed ? '样本全部通过' : '存在未通过样本'}（${sample.length} 条）`, createdAt: now(), details: { profileId: profile.profileId, passed, results } }); res.json(profileDetails(profile.profileId));
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.post('/api/source-configs/:profileId/approve', auth, (req, res) => {
  try { const profile = readProfile(DATA_DIR, req.params.profileId); if (!profile.sampleCheck?.passed) throw new Error('请先通过全部样本检查后再批准。'); profile.approvalStatus = 'approved'; profile.enabled = true; profile.approvedAt = now(); profile.approvedBy = 'local-admin'; profile.updatedAt = now(); writeJsonAtomic(profilePaths(DATA_DIR, profile.profileId).profileFile, profile); addRun({ id: id('source-approve'), type: '来源配置批准', status: 'completed', summary: `已批准并启用 ${profile.displayName}；可按需运行或设置计划`, createdAt: now(), details: { profileId: profile.profileId } }); res.json(profileDetails(profile.profileId)); } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.post('/api/source-configs/:profileId/suspend', auth, (req, res) => {
  try { const profile = readProfile(DATA_DIR, req.params.profileId); profile.approvalStatus = 'suspended'; profile.enabled = false; profile.updatedAt = now(); writeJsonAtomic(profilePaths(DATA_DIR, profile.profileId).profileFile, profile); addRun({ id: id('source-suspend'), type: '来源配置暂停', status: 'completed', summary: `已暂停 ${profile.displayName} 的后续自动运行`, createdAt: now(), details: { profileId: profile.profileId } }); res.json(profileDetails(profile.profileId)); } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});

app.get('/api/automation', auth, (req, res) => {
  ensureBundledProfiles(DATA_DIR);
  const automationRoot = path.join(DATA_DIR, 'automation');
  const status = readJson(path.join('automation', 'status.json'), { profiles: {} });
  const queue = readJson(path.join('automation', 'queue.json'), { items: [] });
  res.json({ profiles: listProfiles(DATA_DIR), status, queue: queue.items.slice(-20) });
});
app.post('/api/automation/profiles/:profileId/run', auth, (req, res) => {
  try {
    const item = enqueueRun(DATA_DIR, req.params.profileId, 'local-admin');
    addRun({ id: id('auto-queue'), type: '自动采集请求', status: 'queued', summary: `已请求运行 ${req.params.profileId} 本地自动采集`, createdAt: now(), details: item });
    res.status(202).json(item);
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.put('/api/automation/profiles/:profileId', auth, (req, res) => {
  try {
    const profileFile = profilePaths(DATA_DIR, req.params.profileId).profileFile;
    const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    const body = req.body || {};
    if (typeof body.enabled === 'boolean') profile.enabled = body.enabled;
    if (body.schedule && typeof body.schedule === 'object') {
      const next = { ...profile.schedule };
      if (typeof body.schedule.enabled === 'boolean') next.enabled = body.schedule.enabled;
      for (const key of ['weekday', 'hour', 'minute']) if (body.schedule[key] !== undefined) next[key] = Number(body.schedule[key]);
      if (!Number.isInteger(next.weekday) || next.weekday < 0 || next.weekday > 6) throw new Error('weekday 必须是 0–6。');
      if (!Number.isInteger(next.hour) || next.hour < 0 || next.hour > 23) throw new Error('hour 必须是 0–23。');
      if (!Number.isInteger(next.minute) || next.minute < 0 || next.minute > 59) throw new Error('minute 必须是 0–59。');
      profile.schedule = next;
    }
    writeJsonAtomic(profileFile, profile);
    addRun({ id: id('auto-settings'), type: '自动采集设置', status: 'completed', summary: `已更新 ${req.params.profileId} 自动采集设置`, createdAt: now(), details: { enabled: profile.enabled, schedule: profile.schedule } });
    res.json({ profileId: profile.profileId, enabled: profile.enabled, schedule: profile.schedule });
  } catch (error) { res.status(400).json({ error: String(error.message || error) }); }
});
app.get('/api/export/state', auth, (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="nvci-state-export.json"'); res.json({ exportedAt: now(), vendors: readJson('vendor-memories.json', []), products: readJson('products.json', []), documents: readJson('documents.json', []), runs: runs(), settings: readJson('settings.json', {}), automation: { profiles: listProfiles(DATA_DIR), status: readJson(path.join('automation', 'status.json'), { profiles: {} }) } }); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`NVCI Workbench listening on http://0.0.0.0:${PORT}`));
