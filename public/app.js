const state = { overview: null, products: [], vendors: [], documents: [], settings: {}, runs: [] };
const templates = { dashboard: 'dashboard-template', vendors: 'vendors-template', products: 'products-template', intelligence: 'intelligence-template', library: 'library-template', updates: 'updates-template', runs: 'runs-template', settings: 'settings-template' };
const titles = { dashboard: ['OVERVIEW', '控制台'], vendors: ['SOURCE PLAYBOOK', '厂商记忆'], products: ['COLLATERAL GOVERNANCE', '产品与彩页'], intelligence: ['P0-1 INTELLIGENCE CORE', '情报核心（试点）'], library: ['ACTIVE LIBRARY', '本地资料库'], updates: ['INCREMENTAL UPDATE', '更新中心'], runs: ['AUDIT TRAIL', '任务日志'], settings: ['LOCAL ADMINISTRATION', '设置'] };
let activeView = 'dashboard';

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (response.status === 401) { showLogin(); throw new Error('请重新登录。'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求未完成。');
  return data;
}
function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
function fmtDate(value) { if (!value) return '—'; try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return value; } }
function fmtBytes(bytes) { if (bytes === 0) return '0 B'; if (!bytes) return '—'; const u=['B','KB','MB','GB']; const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),u.length-1); return `${(bytes/1024**i).toFixed(i ? 1 : 0)} ${u[i]}`; }
function statusLabel(s) { return ({ pdf_acquired:'已获公开 PDF', user_confirmed_no_brochure:'用户确认无彩页', source_unavailable:'资源 404', restricted:'访问受限', no_resource_link:'未发现资源入口', page_access_gap:'产品页访问缺口', pending:'待复核' })[s] || s; }
function showLogin() { document.getElementById('app-shell').classList.add('hidden'); document.getElementById('login-screen').classList.remove('hidden'); }
function showApp() { document.getElementById('login-screen').classList.add('hidden'); document.getElementById('app-shell').classList.remove('hidden'); }

async function bootstrap() {
  const session = await fetch('/api/session').then(r => r.json());
  if (!session.authenticated) return showLogin();
  showApp(); await refreshState(); navigate('dashboard');
}
async function refreshState() {
  const [overview, vendors, products, documents, settings, runs, automation, sourceConfigs, intelligenceOverview] = await Promise.all([api('/api/overview'), api('/api/vendors'), api('/api/products'), api('/api/documents'), api('/api/settings'), api('/api/runs'), api('/api/automation'), api('/api/source-configs'), api('/api/intelligence/overview')]);
  Object.assign(state, { overview, vendors, products, documents, settings, runs, automation, sourceConfigs, intelligenceOverview });
}
function mount(view) {
  const host = document.getElementById('content'); host.innerHTML = ''; const template = document.getElementById(templates[view]); host.appendChild(template.content.cloneNode(true));
  document.getElementById('view-kicker').textContent = titles[view][0]; document.getElementById('view-title').textContent = titles[view][1];
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('last-run').textContent = state.runs?.[0] ? `${state.runs[0].type} · ${fmtDate(state.runs[0].createdAt)}` : '尚未执行健康检查';
  ({ dashboard: renderDashboard, vendors: renderVendors, products: renderProducts, intelligence: renderIntelligence, library: renderLibrary, updates: renderUpdates, runs: renderRuns, settings: renderSettings })[view]();
  host.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.goto)));
}
function navigate(view) { activeView = view; mount(view); }

function renderDashboard() {
  const { stats, vendors, recentRuns } = state.overview;
  const cards = [{ label:'厂商路径记忆', value:stats.vendorCount, color:'accent' }, { label:'产品/系列状态', value:stats.productCount }, { label:'已获公开 PDF', value:stats.pdfCount }, { label:'用户确认无彩页', value:stats.confirmedNoBrochure, color:'warn' }, { label:'归档文档示例', value:stats.documentCount }];
  document.getElementById('stats').innerHTML = cards.map(c => `<div class="stat-card"><div class="label">${c.label}</div><div class="value" style="color:${c.color==='warn'?'var(--warn)':c.color==='accent'?'var(--accent)':'var(--text)'}">${c.value}</div></div>`).join('');
  document.getElementById('vendor-health').innerHTML = vendors.map(v => `<div class="vendor-row"><div><div class="vendor-name">${esc(v.name)}</div><div class="vendor-meta">${esc(v.products)}</div></div><div class="vendor-meta">${esc(v.strategy)}</div><span class="status-chip ${esc(v.status)}">${v.status === 'needs_validation' ? '待验证' : v.status === 'healthy' ? '健康' : '已验证'}</span></div>`).join('');
  document.getElementById('recent-runs').innerHTML = recentRuns.length ? recentRuns.map(runMarkup).join('') : '<p class="muted">尚无运行日志。</p>';
  const entries = Object.entries(stats.byStatus || {}); const max = Math.max(...entries.map(([,v]) => v), 1);
  document.getElementById('status-bars').innerHTML = entries.map(([key, value]) => `<div class="status-bar-row"><span>${statusLabel(key)}</span><div class="bar"><span style="width:${value/max*100}%"></span></div><strong>${value}</strong></div>`).join('');
  document.getElementById('run-health').addEventListener('click', runHealthCheck);
}
function runMarkup(r) { return `<div class="run-item ${r.status==='attention'?'attention':''}"><div class="run-title">${esc(r.type)} <span class="badge ${r.status==='attention'?'warn':'good'}">${esc(r.status)}</span></div><div class="run-meta">${esc(r.summary || '')} · ${fmtDate(r.createdAt)}</div></div>`; }

function renderVendors() {
  document.getElementById('vendor-cards').innerHTML = state.vendors.map(v => `<article class="vendor-card" data-id="${esc(v.id)}"><h4>${esc(v.name)}</h4><div class="domains">${esc(v.domains.join(' · '))}</div><p><strong>产品域：</strong>${esc(v.products)}</p><p><strong>主证据：</strong>${esc(v.primaryEvidence)}</p><label>采集路径与访问边界<textarea>${esc(v.strategy)}</textarea></label><label>小样本健康检查 URL<input value="${esc(v.healthUrl)}" /></label><button class="secondary save-vendor">保存厂商记忆</button></article>`).join('');
  document.querySelectorAll('.save-vendor').forEach(button => button.addEventListener('click', async e => { const card=e.target.closest('.vendor-card'); const id=card.dataset.id; const [strategy, healthUrl]=card.querySelectorAll('textarea,input'); try { await api(`/api/vendors/${id}`, { method:'PUT', body:JSON.stringify({ strategy:strategy.value, healthUrl:healthUrl.value }) }); await refreshState(); renderVendors(); notify('厂商记忆已保存。'); } catch(err){ notify(err.message,true); } }));
}
function renderProducts() {
  const render = () => { const q=document.getElementById('product-search').value.toLowerCase(); const status=document.getElementById('product-status').value; const rows=state.products.filter(p => (!q || Object.values(p).join(' ').toLowerCase().includes(q)) && (!status || p.status===status)); document.getElementById('product-rows').innerHTML=rows.map(p=>`<tr><td>${esc(p.vendor)}</td><td>${esc(p.line)}<br><span class="muted">${esc(p.category)}</span></td><td><div class="product-name">${esc(p.name)}</div></td><td><span class="tag ${esc(p.status)}">${statusLabel(p.status)}</span></td><td>${esc(p.resourceId || '—')}</td><td>${p.productUrl ? `<a href="${esc(p.productUrl)}" target="_blank" rel="noreferrer">产品 / 资源页</a>` : '—'}</td><td>${esc(p.note || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">未找到符合条件的记录。</td></tr>'; };
  document.getElementById('product-search').addEventListener('input', render); document.getElementById('product-status').addEventListener('change', render); render();
}
function libraryTypeLabel(ext) { return ext ? ext.slice(1).toUpperCase() : '无扩展名'; }
async function renderLibrary() {
  const target = document.getElementById('library-counts');
  const pathTarget = document.getElementById('library-path');
  const summaryTarget = document.getElementById('library-result-summary');
  const rowsTarget = document.getElementById('library-rows');
  const paginationTarget = document.getElementById('library-pagination');
  const controls = {
    search: document.getElementById('library-search'), type: document.getElementById('library-type'),
    sort: document.getElementById('library-sort'), pageSize: document.getElementById('library-page-size'),
  };
  const query = { page: 1, pageSize: Number(controls.pageSize.value), q: '', type: '', sort: controls.sort.value };
  let searchTimer;
  const load = async ({ resetPage = false, notice = false } = {}) => {
    if (resetPage) query.page = 1;
    target.innerHTML = '<p class="muted">正在读取活动资料目录…</p>';
    summaryTarget.textContent = '正在更新索引…';
    try {
      const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), q: query.q, type: query.type, sort: query.sort });
      const data = await api(`/api/library/scan?${params.toString()}`);
      query.page = data.page;
      const c = data.counts;
      target.innerHTML = [['PDF', c.pdf], ['CSV', c.csv], ['JSON', c.json], ['其他文件', c.other]].map(([label, value]) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
      pathTarget.innerHTML = `<strong>容器扫描路径：</strong><code>${esc(data.root)}</code>${data.hostPath ? `<br><strong>NAS 存放路径：</strong><code>${esc(data.hostPath)}</code>` : ''}`;
      const filterText = data.filteredCount === data.entryCount ? `共 ${data.entryCount} 个文件` : `筛选结果 ${data.filteredCount} / 全部 ${data.entryCount} 个文件`;
      summaryTarget.textContent = `${filterText} · 第 ${data.page} / ${data.pageCount} 页 · 每页 ${data.pageSize} 条`;
      const offset = (data.page - 1) * data.pageSize;
      rowsTarget.innerHTML = data.entries.map((entry, index) => `<tr><td class="number-col">${offset + index + 1}</td><td class="file-name">${esc(entry.fileName || entry.relativePath.split('/').pop())}</td><td class="path-cell"><code>${esc(entry.relativePath)}</code></td><td><span class="file-type">${esc(libraryTypeLabel(entry.ext))}</span></td><td>${fmtBytes(entry.bytes)}</td><td>${fmtDate(entry.modifiedAt)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted empty-cell">未找到符合当前条件的文件。</td></tr>';
      paginationTarget.innerHTML = `<button class="secondary page-button" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 <strong>${data.page}</strong> / ${data.pageCount} 页</span><button class="secondary page-button" data-page="${data.page + 1}" ${data.page >= data.pageCount ? 'disabled' : ''}>下一页</button>`;
      paginationTarget.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => { query.page = Number(button.dataset.page); load(); }));
      if (notice) notify('资料库索引已重新扫描。');
    } catch (error) {
      target.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
      summaryTarget.textContent = '索引读取失败。';
      rowsTarget.innerHTML = '<tr><td colspan="6" class="muted empty-cell">无法读取活动资料目录。</td></tr>';
      paginationTarget.innerHTML = '';
    }
  };
  controls.search.addEventListener('input', () => { query.q = controls.search.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(() => load({ resetPage: true }), 220); });
  controls.type.addEventListener('change', () => { query.type = controls.type.value; load({ resetPage: true }); });
  controls.sort.addEventListener('change', () => { query.sort = controls.sort.value; load({ resetPage: true }); });
  controls.pageSize.addEventListener('change', () => { query.pageSize = Number(controls.pageSize.value); load({ resetPage: true }); });
  document.getElementById('scan-library').addEventListener('click', () => load({ resetPage: false, notice: true }));
  await load();
}
function approvalLabel(status) { return ({draft:'草稿',sample_verified:'样本已通过',approved:'已批准',suspended:'已暂停'})[status] || status; }
function sourceRow(source = {}) { return `<fieldset class="source-row"><legend>资料条目</legend><label>子系列<input data-field="series" value="${esc(source.series || '')}" placeholder="例如 Aruba CX 6300" required /></label><label>覆盖型号（逗号分隔）<input data-field="modelNames" value="${esc((source.modelNames || []).join(', '))}" placeholder="例如 JL658A, JL659A" required /></label><label>官方产品页（可选）<input data-field="productPageUrl" value="${esc(source.productPageUrl || '')}" placeholder="https://官方域名/..." /></label><label>官方资料页（可选）<input data-field="materialPageUrl" value="${esc(source.materialPageUrl || '')}" placeholder="https://官方域名/..." /></label><label>官方 PDF URL<input data-field="pdfUrl" value="${esc(source.pdfUrl || '')}" placeholder="https://官方域名/...pdf" required /></label><label>官方文件名<input data-field="officialFileName" value="${esc(source.officialFileName || '')}" placeholder="官方文件名.pdf" required /></label><label>系列/型号匹配词（逗号分隔）<input data-field="matchTerms" value="${esc((source.matchTerms || []).join(', '))}" placeholder="例如 CX 6300, 6300" /></label><label>证据规则<input data-field="evidencePolicy" value="${esc(source.evidencePolicy || 'official_datasheet')}" required /></label><button type="button" class="link-button remove-source">移除此条目</button></fieldset>`; }
function renderUpdates() {
  const configs = state.sourceConfigs || []; const worker = state.automation?.status?.worker || {}; const weekday = ['周日','周一','周二','周三','周四','周五','周六'];
  const selectedId = state.selectedSourceConfigId && configs.some(item => item.profileId === state.selectedSourceConfigId) ? state.selectedSourceConfigId : (configs[0]?.profileId || '');
  state.selectedSourceConfigId = selectedId; const profile = configs.find(item => item.profileId === selectedId); const runtime = profile ? (state.automation?.status?.profiles?.[profile.profileId] || {}) : {};
  const target = document.getElementById('automation-control');
  const list = configs.length ? configs.map(item => `<button class="config-card ${item.profileId===selectedId?'active':''}" data-select-profile="${esc(item.profileId)}"><span class="badge ${item.approvalStatus==='approved'?'good':item.approvalStatus==='sample_verified'?'warn':'neutral'}">${esc(approvalLabel(item.approvalStatus))}</span><strong>${esc(item.vendorName)} · ${esc(item.subseries?.name || item.displayName)}</strong><small>${esc(item.productLine?.name || '')} · ${item.sourceCount} 份资料 · ${item.modelCount || 0} 个型号</small></button>`).join('') : '<p class="muted">尚无来源配置。</p>';
  const isNew = state.editSourceConfigId === 'new'; const editing = state.editSourceConfigId === selectedId; const form = isNew ? { sources: [] } : (profile && (editing || (profile.approvalStatus !== 'approved' && profile.approvalStatus !== 'suspended')) ? profile : null);
  const seedSources = form?.sources?.length ? form.sources : [{ series:'', modelNames:[], productPageUrl:'', pdfUrl:'', officialFileName:'', evidencePolicy:'official_datasheet' }];
  target.innerHTML = `<div class="config-layout"><aside class="config-list"><div class="panel-head"><div><p class="eyebrow">SOURCE PROFILES</p><h3>品牌 / 产品线 / 型号</h3></div><button id="new-source-config" class="secondary">新建来源</button></div>${list}</aside><section class="config-detail">${profile ? `<div class="detail-grid"><div class="detail"><span>品牌</span><strong>${esc(profile.vendorName)}</strong></div><div class="detail"><span>产品线</span><strong>${esc(profile.productLine?.name || '—')}</strong></div><div class="detail"><span>子系列</span><strong>${esc(profile.subseries?.name || '—')}</strong></div><div class="detail"><span>型号 / 资料</span><strong>${profile.modelCount || 0} / ${profile.sourceCount}</strong></div><div class="detail"><span>审核状态</span><strong>${esc(approvalLabel(profile.approvalStatus))}</strong></div><div class="detail"><span>首次镜像</span><strong>${profile.bootstrapComplete ? '已完成' : '待执行'}</strong></div></div><p class="small muted">官方域名：${esc((profile.officialDomains || []).join(' · '))}${profile.trustedRedirectDomains?.length ? ` · 仅重定向信任域：${esc(profile.trustedRedirectDomains.join(' · '))}` : ''}</p><div class="automation-actions">${profile.approvalStatus==='approved' ? `<button id="run-automation" class="primary">立即运行 ${esc(profile.displayName)}</button><button id="edit-source" class="secondary">编辑型号/资料</button><button id="suspend-source" class="secondary">暂停来源</button>` : profile.approvalStatus==='sample_verified' ? '<button id="approve-source" class="primary">批准并启用</button>' : profile.approvalStatus==='suspended' ? '<button id="edit-source" class="secondary">编辑并重新验证</button>' : '<button id="sample-source" class="primary">执行 1–5 条样本检查</button>'}<span class="muted">${profile.approvalStatus==='approved'?'仅已批准来源可以进入 NAS 自动下载队列。':'草稿来源只允许样本检查，不会下载或写入活动资料库。'}</span></div>${profile.sampleCheck ? `<div class="callout ${profile.sampleCheck.passed?'':'form-error'}"><strong>最近样本检查：${profile.sampleCheck.passed?'通过':'未通过'}</strong> · ${fmtDate(profile.sampleCheck.checkedAt)}<br>${profile.sampleCheck.results.map(item=>`${esc(item.series)} · ${esc(item.checkMethod || 'HEAD')} · HTTP ${item.status || '失败'} · ${esc(item.contentType || item.error || '')}${item.finalUrl ? ` · ${esc(item.finalUrl)}` : ''}`).join('<br>')}</div>` : ''}${profile.approvalStatus==='approved' ? `<div class="setting-row"><label class="toggle-label"><input id="automation-schedule-enabled" type="checkbox" ${profile.schedule?.enabled ? 'checked' : ''} /> 启用每周计划</label><label>星期<select id="automation-weekday">${weekday.map((name,index)=>`<option value="${index}" ${Number(profile.schedule?.weekday)===index?'selected':''}>${name}</option>`).join('')}</select></label><label>时间<input id="automation-hour" type="number" min="0" max="23" value="${Number(profile.schedule?.hour ?? 2)}" /> : <input id="automation-minute" type="number" min="0" max="59" value="${Number(profile.schedule?.minute ?? 15)}" /></label><button id="save-automation" class="secondary">保存自动计划</button></div>` : ''}` : '<p class="muted">请新建一个来源配置。</p>'}</section></div><section id="config-editor" class="panel config-editor ${form?'':'hidden'}"><div class="panel-head"><div><p class="eyebrow">CONFIGURATION WIZARD</p><h3>${form?'编辑草稿来源':'新建受控来源'}</h3><p class="muted">必须先登记官方域名和资料 URL；样本检查通过后才可批准自动镜像。</p></div></div><form id="source-config-form"><input type="hidden" id="source-profile-id" value="${esc(form?.profileId || '')}" /><div class="config-form-grid"><label>品牌标识<input id="source-vendor-id" value="${esc(form?.vendorId || '')}" placeholder="例如 hpe" required /></label><label>品牌名称<input id="source-vendor-name" value="${esc(form?.vendorName || '')}" placeholder="例如 HPE Networking" required /></label><label>产品线名称<input id="source-line-name" value="${esc(form?.productLine?.name || '')}" placeholder="例如 交换机" required /></label><label>资料库品牌根目录<input id="source-library-root" value="${esc(form?.productLine?.libraryRootName || '')}" placeholder="例如 HPE Networking彩页" required /></label><label>子系列名称<input id="source-subseries-name" value="${esc(form?.subseries?.name || '')}" placeholder="例如 Aruba CX 6300" required /></label><label>官方域名（逗号分隔）<input id="source-domains" value="${esc((form?.officialDomains || []).join(', '))}" placeholder="www.hpe.com, hpe.com" required /></label><label>仅重定向信任域（可选）<input id="source-trusted-redirect-domains" value="${esc((form?.trustedRedirectDomains || []).join(', '))}" placeholder="例如官方 CDN 或对象存储域" /></label><label class="full">来源策略<textarea id="source-policy">${esc(form?.sourcePolicy || '仅采集已登记的公开官方 PDF；产品页用于发现，资料事实以声明的证据规则为准。')}</textarea></label></div><div class="panel-head"><h4>型号与官方资料</h4><button type="button" id="add-source-row" class="secondary">添加资料条目</button></div><div id="source-rows">${seedSources.map(sourceRow).join('')}</div><div class="automation-actions"><button type="submit" class="primary">保存为草稿</button><button type="button" id="cancel-source-form" class="secondary">取消</button></div></form></section><p class="small muted">后台轮询：${worker.pollSeconds || '—'} 秒。未变化资料只复用元数据与历史哈希。</p>`;
  document.getElementById('run-health-2').addEventListener('click',runHealthCheck);
  target.querySelectorAll('[data-select-profile]').forEach(button => button.addEventListener('click', () => { state.selectedSourceConfigId=button.dataset.selectProfile; renderUpdates(); }));
  document.getElementById('new-source-config').addEventListener('click', () => { state.selectedSourceConfigId=''; state.editSourceConfigId='new'; renderUpdates(); });
  const editor = document.getElementById('config-editor'); const formEl = document.getElementById('source-config-form');
  if (formEl) { document.getElementById('add-source-row').addEventListener('click', () => { document.getElementById('source-rows').insertAdjacentHTML('beforeend', sourceRow()); }); document.getElementById('source-rows').addEventListener('click', event => { if (event.target.classList.contains('remove-source')) { const rows=document.querySelectorAll('.source-row'); if (rows.length>1) event.target.closest('.source-row').remove(); else notify('至少保留一条资料。',true); } }); document.getElementById('cancel-source-form').addEventListener('click', () => { state.editSourceConfigId=''; renderUpdates(); }); formEl.addEventListener('submit', async event => { event.preventDefault(); const sources=[...document.querySelectorAll('.source-row')].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, (input.dataset.field==='modelNames'||input.dataset.field==='matchTerms')?input.value.split(/[,，;；]/).map(v=>v.trim()).filter(Boolean):input.value]))); const payload={ vendorId:document.getElementById('source-vendor-id').value, vendorName:document.getElementById('source-vendor-name').value, productLine:{name:document.getElementById('source-line-name').value, libraryRootName:document.getElementById('source-library-root').value}, subseries:{name:document.getElementById('source-subseries-name').value}, officialDomains:document.getElementById('source-domains').value.split(/[,，;；]/).map(v=>v.trim()).filter(Boolean), trustedRedirectDomains:document.getElementById('source-trusted-redirect-domains').value.split(/[,，;；]/).map(v=>v.trim()).filter(Boolean), sourcePolicy:document.getElementById('source-policy').value, sources }; const profileId=document.getElementById('source-profile-id').value; try { const saved=await api(profileId?`/api/source-configs/${encodeURIComponent(profileId)}`:'/api/source-configs',{method:profileId?'PUT':'POST',body:JSON.stringify(payload)}); state.selectedSourceConfigId=saved.profileId; state.editSourceConfigId=''; await refreshState(); renderUpdates(); notify('来源草稿已保存；请执行样本检查。'); } catch(error) { notify(error.message,true); } }); }
  const selected = profile; if (!selected) return;
  const refreshSelected = async (url, message) => { try { const next=await api(url,{method:'POST',body:'{}'}); state.selectedSourceConfigId=next.profileId; await refreshState(); renderUpdates(); notify(message); } catch(error) { notify(error.message,true); } };
  document.getElementById('sample-source')?.addEventListener('click', () => refreshSelected(`/api/source-configs/${encodeURIComponent(selected.profileId)}/sample-check`, '样本检查已完成。'));
  document.getElementById('approve-source')?.addEventListener('click', () => refreshSelected(`/api/source-configs/${encodeURIComponent(selected.profileId)}/approve`, '来源已批准并启用。'));
  document.getElementById('suspend-source')?.addEventListener('click', () => refreshSelected(`/api/source-configs/${encodeURIComponent(selected.profileId)}/suspend`, '来源已暂停。'));
  document.getElementById('edit-source')?.addEventListener('click', () => { state.editSourceConfigId=selected.profileId; renderUpdates(); });
  document.getElementById('run-automation')?.addEventListener('click', async () => { try { const queued=await api(`/api/automation/profiles/${encodeURIComponent(selected.profileId)}/run`,{method:'POST',body:'{}'}); await refreshState(); renderUpdates(); notify(`已请求自动采集：${queued.id}`); } catch(error) { notify(error.message,true); } });
  document.getElementById('save-automation')?.addEventListener('click', async () => { try { await api(`/api/automation/profiles/${encodeURIComponent(selected.profileId)}`, { method:'PUT', body:JSON.stringify({ enabled:true, schedule:{ enabled:document.getElementById('automation-schedule-enabled').checked, weekday:Number(document.getElementById('automation-weekday').value), hour:Number(document.getElementById('automation-hour').value), minute:Number(document.getElementById('automation-minute').value) } }) }); await refreshState(); renderUpdates(); notify('自动计划已保存。'); } catch(error) { notify(error.message,true); } });
}
async function renderIntelligence() {
  const statsTarget = document.getElementById('intelligence-stats');
  const statusTarget = document.getElementById('intelligence-status');
  const auditTarget = document.getElementById('intelligence-import-audit');
  const seriesTarget = document.getElementById('intelligence-series');
  const detailTarget = document.getElementById('intelligence-detail');
  const previewButton = document.getElementById('preview-ale-import');
  const executeButton = document.getElementById('execute-ale-import');
  const exportButton = document.getElementById('export-intelligence');
  const governanceBootstrapButton = document.getElementById('bootstrap-ale-governance');
  const governanceMetricsTarget = document.getElementById('governance-metrics');
  const governanceTasksTarget = document.getElementById('governance-tasks');
  const governanceReviewsTarget = document.getElementById('governance-reviews');
  const fieldScopeStatusTarget = document.getElementById('field-scope-status');
  const fieldScopeNextActionTarget = document.getElementById('field-scope-next-action');
  const fieldScopeTaskSelect = document.getElementById('field-scope-task');
  const fieldScopeTemplateSelect = document.getElementById('field-scope-template');
  const fieldScopeDescriptionTarget = document.getElementById('field-scope-template-description');
  const fieldScopeItemsTarget = document.getElementById('field-scope-items');
  const fieldScopeRationaleInput = document.getElementById('field-scope-rationale');
  const submitFieldScopeButton = document.getElementById('submit-field-scope');
  const approveFieldScopeButton = document.getElementById('approve-field-scope');
  const previewAleFieldFactsButton = document.getElementById('preview-ale-field-facts');
  const executeAleFieldFactsButton = document.getElementById('execute-ale-field-facts');
  const aleFieldFactImportStatusTarget = document.getElementById('ale-field-fact-import-status');
  const comparisonMetricsTarget = document.getElementById('comparison-metrics');
  const comparisonImportStatusTarget = document.getElementById('p04-relation-import-status');
  const comparisonRowsTarget = document.getElementById('comparison-rows');
  const comparisonDetailTarget = document.getElementById('comparison-detail');
  const comparisonSummaryTarget = document.getElementById('comparison-result-summary');
  const comparisonSearchInput = document.getElementById('comparison-search');
  const comparisonStatusFilter = document.getElementById('comparison-status-filter');
  const comparisonReviewFilter = document.getElementById('comparison-review-filter');
  const previewP04RelationsButton = document.getElementById('preview-p04-relations');
  const executeP04RelationsButton = document.getElementById('execute-p04-relations');
  let selectedEntityId = '';
  let fieldScopeTaskId = '';
  let fieldScopeTemplateId = '';
  let comparisonStatus = comparisonStatusFilter.value;
  let comparisonReviewState = comparisonReviewFilter.value;
  let comparisonQuery = '';

  const relationLabels = { direct_candidate: '直接候选', partial_candidate: '部分候选', adjacent_upgrade: '相邻升级', not_comparable: '不宜比较', insufficient_evidence: '证据不足' };
  const reviewLabels = { candidate: '候选', review_required: '待复核', approved: '已批准', rejected: '已驳回', superseded: '已替代' };
  const relationTone = (status) => ({ direct_candidate: 'good', partial_candidate: 'good', adjacent_upgrade: 'neutral', not_comparable: 'neutral', insufficient_evidence: 'warn' }[status] || 'neutral');
  const reviewTone = (status) => ({ approved: 'good', candidate: 'neutral', review_required: 'warn', rejected: 'warn', superseded: 'neutral' }[status] || 'neutral');

  const renderComparisonDetail = async (relationshipId) => {
    comparisonDetailTarget.innerHTML = '<p class="muted">正在读取双方字段证据与关系审计…</p>';
    try {
      const item = await api(`/api/intelligence/comparisons/${encodeURIComponent(relationshipId)}`);
      const gateRows = Object.entries(item.hardGates || {}).map(([code, gate]) => `<div class="detail"><span>${esc(code)}</span><strong>${esc(gate.subject?.value ?? '未披露')} ↔ ${esc(gate.counterpart?.value ?? '未披露')}</strong><span class="badge ${gate.subject?.outcome === 'pass' ? 'good' : 'warn'}">${gate.subject?.outcome === 'pass' ? '门槛通过' : '门槛不通过'}</span><small class="muted">双方证据：${esc(gate.subject?.evidenceState || '')} / ${esc(gate.counterpart?.evidenceState || '')}${gate.subject?.reason ? ` · ${esc(gate.subject.reason)}` : ''}</small></div>`).join('');
      const evidenceRows = (item.evidence || []).map((evidence) => `<div class="detail"><span>${esc(evidence.participant_side === 'subject' ? 'ALE' : 'HPE Aruba')} · ${esc(evidence.field_code)}</span><strong>${esc(evidence.document_title || evidence.official_file_name || '官方 Data sheet')}</strong><small class="muted">SHA-256 ${esc((evidence.sha256 || '').slice(0, 12))}… · ${esc(evidence.locator || '')}</small><span>${esc(evidence.quote_text || '未提供原文摘录')}</span>${evidence.source_url ? `<a href="${esc(evidence.source_url)}" target="_blank" rel="noreferrer">官方证据链接</a>` : ''}</div>`).join('');
      const reviewActions = ['candidate', 'review_required'].includes(item.review_state) ? `<div class="governance-actions"><button class="primary comparison-review-action" data-status="approved">批准此关系</button><button class="secondary comparison-review-action" data-status="rejected">驳回此关系</button></div>` : '';
      comparisonDetailTarget.innerHTML = `<div class="detail"><span>关系</span><strong>${esc(item.subjectName)} ↔ ${esc(item.counterpartName)}</strong><span class="badge ${relationTone(item.match_status)}">${esc(relationLabels[item.match_status] || item.match_status)}</span><span class="badge ${reviewTone(item.review_state)}">${esc(reviewLabels[item.review_state] || item.review_state)}</span></div><div class="detail"><span>判定依据</span><strong>${esc(item.rationale || '未填写')}</strong></div><div class="detail"><span>关键偏离</span><strong>${esc(item.key_deviations || '无')}</strong></div><div class="detail"><span>不适用原因</span><strong>${esc(item.disqualification_reason || '无')}</strong></div><div class="detail"><span>采购验证问题</span><strong>${(item.validationQuestions || []).map(esc).join('；') || '无'}</strong></div><h4 class="detail-heading">首层硬门槛</h4>${gateRows || '<p class="muted">暂无硬门槛。</p>'}<h4 class="detail-heading">双方证据回链</h4>${evidenceRows || '<p class="muted">暂无证据关联。</p>'}${reviewActions}`;
      comparisonDetailTarget.querySelectorAll('.comparison-review-action').forEach((button) => button.addEventListener('click', async () => {
        const nextState = button.dataset.status;
        const reason = window.prompt(nextState === 'approved' ? '请填写批准此对标关系的依据；该记录将进入治理审计：' : '请填写驳回此对标关系的原因；该记录将进入治理审计：');
        if (!reason) return;
        try { await api(`/api/intelligence/comparisons/${encodeURIComponent(item.relationship_id)}/review`, { method: 'PATCH', body: JSON.stringify({ reviewState: nextState, reason }) }); await refreshState(); await load(); notify('对标关系审核状态已更新并保留审计记录。'); }
        catch (error) { notify(error.message, true); }
      }));
    } catch (error) { comparisonDetailTarget.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; }
  };

  const loadComparisonRows = async () => {
    const query = new URLSearchParams({ limit: '200' });
    if (comparisonStatus) query.set('matchStatus', comparisonStatus);
    if (comparisonReviewState) query.set('reviewState', comparisonReviewState);
    if (comparisonQuery) query.set('q', comparisonQuery);
    const rows = await api(`/api/intelligence/comparisons?${query.toString()}`);
    comparisonSummaryTarget.textContent = rows.length ? `当前显示 ${rows.length} 条${comparisonStatus ? `“${relationLabels[comparisonStatus] || comparisonStatus}”` : ''}关系；点击“查看证据”审阅双方硬门槛、原文和资料修订。` : '尚未导入符合当前筛选条件的关系。';
    comparisonRowsTarget.innerHTML = rows.length ? rows.map((row) => `<tr><td>${esc(row.subjectName)}</td><td>${esc(row.counterpartName)}</td><td><span class="badge ${relationTone(row.match_status)}">${esc(relationLabels[row.match_status] || row.match_status)}</span></td><td><span class="badge ${reviewTone(row.review_state)}">${esc(reviewLabels[row.review_state] || row.review_state)}</span></td><td>${esc(row.key_deviations || row.disqualification_reason || '无')}</td><td><button class="secondary comparison-detail-button" data-relationship-id="${esc(row.relationship_id)}">查看证据</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">没有符合当前筛选条件的对标关系。</td></tr>';
    comparisonRowsTarget.querySelectorAll('.comparison-detail-button').forEach((button) => button.addEventListener('click', () => renderComparisonDetail(button.dataset.relationshipId)));
  };

  const load = async () => {
    try {
      const [overview, entities, imports, metrics, tasks, reviews, fieldTemplates, comparisonMetrics] = await Promise.all([api('/api/intelligence/overview'), api('/api/intelligence/entities?vendorId=ale&entityType=series'), api('/api/intelligence/import-runs'), api('/api/intelligence/metrics'), api('/api/intelligence/research-tasks'), api('/api/intelligence/review-items'), api('/api/intelligence/field-templates'), api('/api/intelligence/comparisons/metrics')]);
      const preferredAleVerticalTask = tasks.find((task) => task.mode === 'vertical' && task.scope?.vendorId === 'ale') || tasks[0];
      if (!tasks.some((task) => task.task_id === fieldScopeTaskId)) fieldScopeTaskId = preferredAleVerticalTask?.task_id || '';
      if (!fieldTemplates.some((template) => template.templateId === fieldScopeTemplateId)) fieldScopeTemplateId = fieldTemplates[0]?.templateId || '';
      const fieldPacks = fieldScopeTaskId ? await api(`/api/intelligence/research-tasks/${encodeURIComponent(fieldScopeTaskId)}/field-packs`) : [];
      state.intelligenceOverview = overview;
      const c = overview.counts;
      statsTarget.innerHTML = [['实体', c.entities], ['资料', c.documents], ['资料修订', c.documentRevisions], ['证据对象', c.evidence], ['字段事实', c.facts], ['导入审计', c.importRuns]].map(([label, value]) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
      const latest = overview.lastImport;
      statusTarget.innerHTML = latest ? `<strong>最近导入：${esc(latest.status === 'completed' ? '已完成' : latest.status)}</strong><br><span class="muted">${fmtDate(latest.finished_at || latest.started_at)} · ${esc(latest.importer_name)} · ${latest.summary?.sourceCount || 0} 份受控资料</span><br><span class="small muted">数据库：${esc(overview.databasePath)}。SQLite 数据层与 PDF/manifest/来源配置隔离。</span>` : '<strong>尚未执行导入。</strong><br><span class="muted">可先预览 ALE 受控来源；执行后只会写入独立 SQLite 数据库。</span>';
      auditTarget.innerHTML = imports.length ? imports.slice(0, 5).map(item => `<div class="run-item ${item.status === 'failed' ? 'attention' : ''}"><div class="run-title">${esc(item.importer_name)} <span class="badge ${item.status === 'completed' ? 'good' : 'warn'}">${esc(item.status)}</span></div><div class="run-meta">${fmtDate(item.finished_at || item.started_at)} · ${item.summary?.sourceCount || 0} 份资料 · 新增实体 ${item.summary?.created?.entities || 0} / 复用 ${item.summary?.reused?.entities || 0}</div></div>`).join('') : '<p class="muted">尚无情报核心导入审计。</p>';
      const comparisonCards = [
        ['对标关系', comparisonMetrics.total || 0, 'accent'],
        ['直接候选', comparisonMetrics.byStatus?.direct_candidate || 0, 'accent'],
        ['部分 / 相邻升级', (comparisonMetrics.byStatus?.partial_candidate || 0) + (comparisonMetrics.byStatus?.adjacent_upgrade || 0), 'accent'],
        ['不宜 / 证据不足', (comparisonMetrics.byStatus?.not_comparable || 0) + (comparisonMetrics.byStatus?.insufficient_evidence || 0), (comparisonMetrics.byStatus?.insufficient_evidence || 0) ? 'warn' : 'accent'],
        ['关系待复核', comparisonMetrics.byReviewState?.review_required || 0, (comparisonMetrics.byReviewState?.review_required || 0) ? 'warn' : 'accent'],
      ];
      comparisonMetricsTarget.innerHTML = comparisonCards.map(([label, value, tone]) => `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value" style="color:${tone==='warn'?'var(--warn)':'var(--accent)'}">${esc(value)}</div></div>`).join('');
      const hasComparisons = (comparisonMetrics.total || 0) > 0;
      comparisonImportStatusTarget.className = `callout ${hasComparisons ? ((comparisonMetrics.byReviewState?.review_required || 0) ? 'attention' : 'success') : 'muted'}`;
      comparisonImportStatusTarget.innerHTML = hasComparisons
        ? `<strong>P0-4 关系库已写入。</strong><br><span>共 ${comparisonMetrics.total} 条多对多关系；直接候选 ${comparisonMetrics.byStatus?.direct_candidate || 0}、部分候选 ${comparisonMetrics.byStatus?.partial_candidate || 0}、相邻升级 ${comparisonMetrics.byStatus?.adjacent_upgrade || 0}、不宜比较 ${comparisonMetrics.byStatus?.not_comparable || 0}、证据不足 ${comparisonMetrics.byStatus?.insufficient_evidence || 0}。只有审核状态“已批准”的关系可被用于产品定型结论。</span>`
        : '<strong>尚未导入 P0-4 关系。</strong><br><span>先预览首批 81 个基础技术型号和 1,610 条候选对；预览不会写入 SQLite。</span>';
      await loadComparisonRows();
      const coverage = metrics.fieldCoverage || {};
      const metricCards = [
        ['证据元数据覆盖率', `${coverage.provenance?.percent ?? 0}%`, coverage.provenance?.status === 'ready' ? 'accent' : 'warn'],
        ['技术字段记录覆盖率', `${coverage.technical?.percent ?? 0}%`, coverage.technical?.status === 'ready' ? 'accent' : 'warn'],
        ['资料新鲜度', `${metrics.freshness?.percent ?? 0}%`, metrics.freshness?.status === 'fresh' ? 'accent' : 'warn'],
        ['待复核数量', metrics.reviewQueue?.openTotal ?? 0, (metrics.reviewQueue?.bySeverity?.high || 0) ? 'warn' : 'accent'],
      ];
      governanceMetricsTarget.innerHTML = metricCards.map(([label, value, tone]) => `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value" style="color:${tone==='warn'?'var(--warn)':'var(--accent)'}">${esc(value)}</div>${label === '技术字段记录覆盖率' ? `<div class="small muted">已核验 ${coverage.technical?.verified || 0} · 未披露 ${coverage.technical?.notDisclosed || 0} · 待复核 ${coverage.technical?.needsReview || 0}</div>` : ''}</div>`).join('');
      const activeFieldPack = fieldPacks.find((pack) => pack.packStatus === 'active') || null;
      const pendingFieldPack = fieldPacks.find((pack) => pack.packStatus === 'pending_approval') || null;
      const selectedTemplate = fieldTemplates.find((template) => template.templateId === fieldScopeTemplateId) || null;
      const inheritedPack = [pendingFieldPack, activeFieldPack].find((pack) => pack?.templateId === fieldScopeTemplateId) || null;
      const selectedFieldCodes = new Set(inheritedPack ? inheritedPack.items.filter((item) => item.selected).map((item) => item.fieldCode) : (selectedTemplate?.items || []).map((item) => item.fieldCode));
      fieldScopeTaskSelect.innerHTML = tasks.length ? tasks.map((task) => `<option value="${esc(task.task_id)}" ${task.task_id===fieldScopeTaskId?'selected':''}>${esc(task.title)} · ${esc(task.status)}</option>`).join('') : '<option value="">请先初始化研究任务</option>';
      fieldScopeTemplateSelect.innerHTML = fieldTemplates.length ? fieldTemplates.map((template) => `<option value="${esc(template.templateId)}" ${template.templateId===fieldScopeTemplateId?'selected':''}>${esc(template.name)}</option>`).join('') : '<option value="">暂无字段模板</option>';
      fieldScopeDescriptionTarget.innerHTML = selectedTemplate ? `<strong>${esc(selectedTemplate.name)}</strong><br><span class="muted">${esc(selectedTemplate.description)}</span>` : '请选择研究任务和字段模板。';
      fieldScopeItemsTarget.innerHTML = selectedTemplate ? selectedTemplate.items.map((item) => `<label class="field-scope-item"><input type="checkbox" data-field-code="${esc(item.fieldCode)}" ${selectedFieldCodes.has(item.fieldCode)?'checked':''} /><span><strong>${esc(item.label)}</strong><small>${esc(item.fieldCode)} · ${esc(item.fieldGroup)} · ${esc(item.valueType)}${item.unitHint?` · ${esc(item.unitHint)}`:''}</small><em>优先级：${esc(item.priority)}${item.required?' · 必选':''}</em><i>证据：${esc(item.evidenceRequirement)}</i></span></label>`).join('') : '<p class="muted">当前没有可用字段模板。</p>';
      const activeCount = activeFieldPack?.items.filter((item) => item.selected).length || 0;
      const approvedAt = activeFieldPack?.approvedAt ? fmtDate(activeFieldPack.approvedAt) : '已记录';
      fieldScopeStatusTarget.className = `callout ${activeFieldPack ? 'success' : pendingFieldPack ? 'attention' : 'muted'}`;
      fieldScopeStatusTarget.innerHTML = activeFieldPack
        ? `<strong>✓ 技术字段范围已批准生效：v${activeFieldPack.versionNumber}</strong><br><span>${esc(activeFieldPack.name)} · ${activeCount} 个字段 · 批准人 ${esc(activeFieldPack.approvedBy || 'local-admin')} · ${esc(approvedAt)}</span><br><span class="small">批准依据：${esc(activeFieldPack.rationale || '未填写')}</span>`
        : pendingFieldPack
          ? `<strong>待审批：v${pendingFieldPack.versionNumber}</strong><br><span>${esc(pendingFieldPack.name)} · ${pendingFieldPack.items.filter((item) => item.selected).length} 个字段；批准前不会改变覆盖率口径。</span>`
          : '<strong>尚未定义技术字段范围</strong><br><span>选择模板并提交后，系统生成独立审批项；批准后才生效。</span>';
      fieldScopeNextActionTarget.className = `field-scope-next-action ${activeFieldPack ? 'success' : pendingFieldPack ? 'attention' : 'muted'}`;
      fieldScopeNextActionTarget.innerHTML = activeFieldPack
          ? `<strong>下一步：开始受控抽取与字段事实审核。</strong><span>技术字段记录覆盖率按 ${activeCount} 个生效字段 × ${tasks.find((task) => task.task_id === fieldScopeTaskId)?.scope?.entityCount || 0} 个系列计算；当前 ${coverage.technical?.completed || 0}/${coverage.technical?.expected || 0}。状态分布：已核验 ${coverage.technical?.verified || 0}，未披露 ${coverage.technical?.notDisclosed || 0}，待复核 ${coverage.technical?.needsReview || 0}。只有“已核验”可直接进入对标判断；未披露不得推断，待复核必须处理审核队列。如需调整范围，请创建新版本后重新审批。</span>`
        : pendingFieldPack
          ? '<strong>下一步：审核并批准待审字段范围。</strong><span>批准前不改变技术字段覆盖率，也不会触发自动抽取。</span>'
          : '<strong>下一步：选择字段并提交进入审批。</strong><span>提交后的字段包需要批准，才会成为研究任务的正式技术口径。</span>';
      submitFieldScopeButton.disabled = !fieldScopeTaskId || !selectedTemplate;
      submitFieldScopeButton.textContent = activeFieldPack ? '创建字段范围新版本，进入审批' : '提交字段范围，进入审批';
      approveFieldScopeButton.hidden = !pendingFieldPack;
      approveFieldScopeButton.disabled = !pendingFieldPack;
      approveFieldScopeButton.textContent = pendingFieldPack ? `批准待审字段范围 v${pendingFieldPack.versionNumber}` : '批准待审字段范围';
      const fieldImportReady = Boolean(activeFieldPack && entities.length);
      previewAleFieldFactsButton.disabled = !fieldImportReady;
      executeAleFieldFactsButton.disabled = !fieldImportReady;
      aleFieldFactImportStatusTarget.className = `callout ${fieldImportReady ? (coverage.technical?.needsReview ? 'attention' : 'success') : 'muted'}`;
      aleFieldFactImportStatusTarget.innerHTML = fieldImportReady
        ? `<strong>${coverage.technical?.completed ? '字段事实已可复核或重复执行' : '字段事实导入已就绪'}</strong><br><span>范围：${activeCount} 个已批准字段 × ${tasks.find((task) => task.task_id === fieldScopeTaskId)?.scope?.entityCount || 0} 个 ALE 系列。当前：已核验 ${coverage.technical?.verified || 0} · 未披露 ${coverage.technical?.notDisclosed || 0} · 待复核 ${coverage.technical?.needsReview || 0}。执行遵循幂等规则，重复执行不会重复创建字段事实。</span>`
        : '<strong>导入门禁未满足。</strong><br><span>请依次完成 ALE 只读导入、初始化治理试点、提交并批准技术字段范围；系统不会绕过这些研究治理步骤直接写入字段事实。</span>';
      fieldScopeTaskSelect.onchange = () => { fieldScopeTaskId = fieldScopeTaskSelect.value; load(); };
      fieldScopeTemplateSelect.onchange = () => { fieldScopeTemplateId = fieldScopeTemplateSelect.value; load(); };
      submitFieldScopeButton.onclick = async () => {
        const selected = [...fieldScopeItemsTarget.querySelectorAll('input[data-field-code]:checked')].map((input) => input.dataset.fieldCode);
        if (!selected.length) return notify('请至少选择一个需要进入事实层的技术字段。', true);
        submitFieldScopeButton.disabled = true; submitFieldScopeButton.textContent = '正在提交…';
        try {
          const result = await api(`/api/intelligence/research-tasks/${encodeURIComponent(fieldScopeTaskId)}/field-packs`, { method: 'POST', body: JSON.stringify({ templateId: fieldScopeTemplateId, selectedFieldCodes: selected, rationale: fieldScopeRationaleInput.value }) });
          fieldScopeRationaleInput.value = '';
          await refreshState(); await load();
          notify(`字段范围已提交：v${result.pending?.versionNumber || ''}，等待批准后才生效。`);
        } catch (error) { notify(error.message, true); }
        finally { submitFieldScopeButton.textContent = '提交字段范围，进入审批'; }
      };
      approveFieldScopeButton.onclick = async () => {
        if (!pendingFieldPack) return;
        const reason = window.prompt(`请填写批准 ${pendingFieldPack.name} 的决策依据。批准后将作为字段覆盖率和后续受控抽取的统一口径：`);
        if (!reason) return;
        approveFieldScopeButton.disabled = true; approveFieldScopeButton.textContent = '正在批准…';
        try {
          await api(`/api/intelligence/field-packs/${encodeURIComponent(pendingFieldPack.taskFieldPackId)}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
          await refreshState(); await load();
          notify('技术字段范围已批准生效；覆盖率口径已更新。');
        } catch (error) { notify(error.message, true); }
      };
      governanceTasksTarget.innerHTML = tasks.length ? tasks.map(task => `<article class="governance-item"><div class="governance-title"><strong>${esc(task.title)}</strong><span class="badge ${task.status==='analysis_ready'?'good':'warn'}">${esc(task.status)}</span></div><p>${esc(task.decision_question)}</p><div class="run-meta">范围：${esc(task.scope?.entityCount || 0)} 个系列 · 优先级：${esc(task.priority)} · 负责人：${esc(task.owner)} · 更新：${fmtDate(task.updated_at)}</div></article>`).join('') : '<p class="muted">先完成 ALE 只读导入，再初始化研究任务。</p>';
      governanceReviewsTarget.innerHTML = reviews.length ? reviews.map(review => `<article class="governance-item ${review.severity==='high'?'attention':''}"><div class="governance-title"><strong>${esc(review.title)}</strong><span class="badge ${review.severity==='high'?'warn':review.status==='resolved'?'good':'neutral'}">${esc(review.severity)} · ${esc(review.status)}</span></div><p>${esc(review.reason)}</p><div class="run-meta">队列：${esc(review.queue_type)} · 负责人：${esc(review.owner)} · ${review.taskTitle ? `任务：${esc(review.taskTitle)}` : ''}</div><div class="governance-actions">${review.status==='open'?`<button class="secondary review-update" data-review-id="${esc(review.review_id)}" data-review-status="in_review">开始复核</button>`:''}${['open','in_review'].includes(review.status)?`<button class="secondary review-update" data-review-id="${esc(review.review_id)}" data-review-status="deferred">延期</button><button class="primary review-update" data-review-id="${esc(review.review_id)}" data-review-status="resolved">确认关闭</button>`:''}</div></article>`).join('') : '<p class="muted">尚无审核项；初始化 ALE 治理试点后会生成字段质量与资料基线审核。</p>';
      governanceBootstrapButton.disabled = entities.length === 0;
      governanceBootstrapButton.textContent = tasks.length ? '重新核对 ALE 治理试点' : '初始化 ALE 治理试点';
      governanceReviewsTarget.querySelectorAll('.review-update').forEach(button => button.addEventListener('click', async () => {
        const status = button.dataset.reviewStatus; const reviewId = button.dataset.reviewId;
        const requiresReason = ['resolved', 'deferred'].includes(status);
        const reason = requiresReason ? window.prompt(status === 'resolved' ? '请填写关闭理由（将写入治理审计）：' : '请填写延期理由（将写入治理审计）：') : '';
        if (requiresReason && !reason) return;
        try { await api(`/api/intelligence/review-items/${encodeURIComponent(reviewId)}`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); await refreshState(); await load(); notify('审核项已更新并写入治理审计。'); }
        catch (error) { notify(error.message, true); }
      }));
      seriesTarget.innerHTML = entities.length ? entities.map(entity => `<tr><td><button class="link-button intelligence-entity" data-entity-id="${esc(entity.entity_id)}">${esc(entity.canonical_name)}</button></td><td><span class="badge good">${esc(entity.source_state)}</span></td><td>${esc(entity.attributes?.evidencePolicy || '官方资料')}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">尚未导入 ALE 系列；请先执行只读导入。</td></tr>';
      seriesTarget.querySelectorAll('.intelligence-entity').forEach((button) => button.addEventListener('click', async () => {
        selectedEntityId = button.dataset.entityId;
        detailTarget.innerHTML = '<p class="muted">正在读取字段事实与证据…</p>';
        try {
          const entity = await api(`/api/intelligence/entities/${encodeURIComponent(selectedEntityId)}`);
          detailTarget.innerHTML = `<div class="detail"><span>系列</span><strong>${esc(entity.canonical_name)}</strong></div><div class="detail"><span>资料状态</span><strong>${esc(entity.source_state)}</strong></div>${entity.facts.map(fact => `<div class="detail"><span>${esc(fact.field_code)}</span><strong>${esc(typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value))}</strong><span class="badge ${fact.publication_state === 'evidence_verified' ? 'good' : fact.publication_state === 'needs_review' ? 'warn' : 'neutral'}">${esc({ evidence_verified: '已核验', not_disclosed: '未披露', needs_review: '待复核' }[fact.publication_state] || fact.publication_state)}</span><small class="muted">${esc(fact.document_title || '')} · SHA-256 ${esc((fact.sha256 || '').slice(0, 12))}… · ${esc(fact.locator || '')}</small>${fact.source_url ? `<a href="${esc(fact.source_url)}" target="_blank" rel="noreferrer">官方证据链接</a>` : ''}</div>`).join('')}`;
        } catch (error) { detailTarget.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; }
      }));
    } catch (error) {
      statsTarget.innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
      statusTarget.textContent = '情报核心读取失败。';
    }
  };

  exportButton.addEventListener('click', () => { window.location.href = '/api/intelligence/export'; });
  governanceBootstrapButton.addEventListener('click', async () => {
    governanceBootstrapButton.disabled = true; governanceBootstrapButton.textContent = '正在初始化…';
    try { const result = await api('/api/intelligence/governance/ale-bootstrap', { method: 'POST', body: '{}' }); await refreshState(); await load(); notify(`ALE 治理试点已就绪：任务新增 ${result.created.tasks}，审核新增 ${result.created.reviews}。`); }
    catch (error) { notify(error.message, true); }
    finally { governanceBootstrapButton.disabled = false; }
  });
  previewAleFieldFactsButton.addEventListener('click', async () => {
    previewAleFieldFactsButton.disabled = true; previewAleFieldFactsButton.textContent = '正在预览…';
    try {
      const plan = await api('/api/intelligence/imports/ale-field-facts/preview', { method: 'POST', body: '{}' });
      const states = plan.summary?.states || {};
      aleFieldFactImportStatusTarget.className = 'callout success';
      aleFieldFactImportStatusTarget.innerHTML = `<strong>预览完成：未写入 SQLite。</strong><br><span>${plan.summary?.plannedFacts || 0} 项字段事实，覆盖 ${plan.summary?.series || 0} 个系列 × ${plan.summary?.fieldsPerSeries || 0} 个字段；已核验 ${states.evidence_verified || 0} · 未披露 ${states.not_disclosed || 0} · 待复核 ${states.needs_review || 0}。</span>`;
      notify(`ALE 字段事实预览完成：${plan.summary?.plannedFacts || 0} 项，未写入数据库。`);
    } catch (error) { notify(error.message, true); }
    finally { previewAleFieldFactsButton.textContent = '预览 ALE 字段事实导入'; await load(); }
  });
  executeAleFieldFactsButton.addEventListener('click', async () => {
    const confirmed = window.confirm('确认将已审计的 ALE 字段事实写入独立 SQLite 情报核心吗？\n\n本操作不会修改 PDF、来源配置、活动资料库或历史快照；待复核字段将自动进入审核队列。');
    if (!confirmed) return;
    executeAleFieldFactsButton.disabled = true; executeAleFieldFactsButton.textContent = '正在导入…';
    try {
      const result = await api('/api/intelligence/imports/ale-field-facts/execute', { method: 'POST', body: '{}' });
      const states = result.summary?.states || {};
      await refreshState(); await load();
      notify(`字段事实导入完成：已核验 ${states.evidence_verified || 0} · 未披露 ${states.not_disclosed || 0} · 待复核 ${states.needs_review || 0}。`);
    } catch (error) { notify(error.message, true); }
    finally { executeAleFieldFactsButton.textContent = '执行字段事实导入'; }
  });
  comparisonStatusFilter.onchange = async () => { comparisonStatus = comparisonStatusFilter.value; await loadComparisonRows(); };
  comparisonReviewFilter.onchange = async () => { comparisonReviewState = comparisonReviewFilter.value; await loadComparisonRows(); };
  comparisonSearchInput.onchange = async () => { comparisonQuery = comparisonSearchInput.value.trim(); await loadComparisonRows(); };
  comparisonSearchInput.onkeydown = async (event) => { if (event.key === 'Enter') { event.preventDefault(); comparisonQuery = comparisonSearchInput.value.trim(); await loadComparisonRows(); } };
  previewP04RelationsButton.addEventListener('click', async () => {
    previewP04RelationsButton.disabled = true; previewP04RelationsButton.textContent = '正在预览…';
    try {
      const plan = await api('/api/intelligence/imports/p04-pilot-relations/preview', { method: 'POST', body: '{}' });
      comparisonImportStatusTarget.className = 'callout success';
      comparisonImportStatusTarget.innerHTML = `<strong>预览完成：未写入 SQLite。</strong><br><span>范围：${plan.modelCount || 0} 个基础技术型号；候选对：${plan.candidatePairs || 0}；系列：${(plan.expectedSeries || []).map((item) => `${esc(item.series)}（${item.models}）`).join('、')}。资料快照：${esc(plan.sourceSnapshot?.snapshotId || '')}。</span>`;
      notify(`P0-4 预览完成：${plan.modelCount || 0} 个型号，${plan.candidatePairs || 0} 条候选对；未写入数据库。`);
    } catch (error) { notify(error.message, true); }
    finally { previewP04RelationsButton.disabled = false; previewP04RelationsButton.textContent = '预览 P0-4 对标关系'; }
  });
  executeP04RelationsButton.addEventListener('click', async () => {
    const confirmed = window.confirm('确认将 P0-4 审计基线中的型号实体、字段事实、证据回链与多对多对标关系写入独立 SQLite 情报核心吗？\n\n本操作不会修改 PDF、资料库、采集配置或历史快照。导入结果中的“直接候选”仍需产品经理审核批准后才可用于产品定型结论。');
    if (!confirmed) return;
    executeP04RelationsButton.disabled = true; executeP04RelationsButton.textContent = '正在导入…';
    try {
      const result = await api('/api/intelligence/imports/p04-pilot-relations/execute', { method: 'POST', body: '{}' });
      await refreshState(); await load();
      const states = result.summary?.relationshipStates || {};
      notify(`P0-4 导入完成：直接 ${states.direct_candidate || 0}、部分 ${states.partial_candidate || 0}、相邻升级 ${states.adjacent_upgrade || 0}、不宜比较 ${states.not_comparable || 0}、证据不足 ${states.insufficient_evidence || 0}。`);
    } catch (error) { notify(error.message, true); }
    finally { executeP04RelationsButton.disabled = false; executeP04RelationsButton.textContent = '执行受控关系导入'; }
  });
  previewButton.addEventListener('click', async () => {
    previewButton.disabled = true; previewButton.textContent = '正在预览…';
    try { const plan = await api('/api/intelligence/imports/ale-readonly/preview', { method: 'POST', body: '{}' }); notify(`ALE 预览完成：${plan.sourceCount} 份受控资料，${plan.invalid.length} 条不完整。未写入数据库。`); await load(); }
    catch (error) { notify(error.message, true); }
    finally { previewButton.disabled = false; previewButton.textContent = '预览 ALE 导入'; }
  });
  executeButton.addEventListener('click', async () => {
    executeButton.disabled = true; executeButton.textContent = '正在导入…';
    try { const result = await api('/api/intelligence/imports/ale-readonly/execute', { method: 'POST', body: '{}' }); await refreshState(); await load(); notify(`已完成 ALE 只读导入：${result.sourceCount} 份资料；未改写 PDF 或来源配置。`); }
    catch (error) { notify(error.message, true); }
    finally { executeButton.disabled = false; executeButton.textContent = '执行只读导入'; }
  });
  await load();
}
function renderRuns(){ document.getElementById('run-log').innerHTML=state.runs.length?state.runs.map(runMarkup).join(''):'<p class="muted">尚无任务日志。</p>'; }
function renderSettings(){ const root=state.settings.libraryPath||'/data/library'; document.getElementById('setting-summary').innerHTML=[['服务端口',location.port||'80'],['资料库路径',root],['自动健康检查',state.settings.autoHealthCheck?'已启用':'已关闭'],['检查间隔',`${state.settings.healthIntervalHours||168} 小时`]].map(([k,v])=>`<div class="detail"><span>${k}</span><strong>${esc(v)}</strong></div>`).join(''); document.getElementById('export-state-2').addEventListener('click',exportState); }
async function runHealthCheck(){ const buttons=document.querySelectorAll('#run-health,#run-health-2'); buttons.forEach(b=>{b.disabled=true;b.textContent='正在检查…'}); try { const result=await api('/api/health-check',{method:'POST',body:JSON.stringify({vendorIds:state.vendors.map(v=>v.id)})}); await refreshState(); const html=result.results.map(r=>`<div><strong>${esc(r.vendorId)}</strong> · HTTP ${r.status||'失败'} · <span class="badge ${r.decision==='reuse_unchanged_or_compare_metadata'?'good':'warn'}">${esc(r.decision)}</span><br><span class="muted">${esc(r.url)} · ${r.elapsedMs}ms</span></div>`).join('<hr>'); const out=document.getElementById('health-result'); if(out) out.innerHTML=html; notify('路径健康检查完成；仅检查 HTTP 元数据，未下载资料。'); if(activeView==='dashboard') mount('dashboard'); } catch(err){notify(err.message,true);} finally {buttons.forEach(b=>{b.disabled=false;b.textContent=b.id==='run-health'?'运行路径健康检查':'执行当前样本检查'});} }
function exportState(){ window.location.href='/api/export/state'; }
function notify(text,error=false){ const el=document.createElement('div'); el.className='toast'; el.style.cssText=`position:fixed;right:22px;bottom:22px;z-index:100;background:${error?'#52212b':'#163a36'};border:1px solid ${error?'#a84e5e':'#2b8773'};padding:12px 15px;border-radius:10px;color:#ecf8f6;box-shadow:var(--shadow);max-width:380px;font-size:13px`;el.textContent=text;document.body.appendChild(el);setTimeout(()=>el.remove(),4200);}

document.getElementById('login-form').addEventListener('submit',async e=>{e.preventDefault();const password=document.getElementById('password').value;try{await api('/api/login',{method:'POST',body:JSON.stringify({password})});document.getElementById('login-error').textContent='';await bootstrap();}catch(err){document.getElementById('login-error').textContent=err.message;}});
document.getElementById('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(b)navigate(b.dataset.view)});
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});showLogin();});
document.getElementById('export-state').addEventListener('click',exportState);
bootstrap().catch(err=>{console.error(err);showLogin();});
