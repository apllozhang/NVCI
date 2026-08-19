const state = { overview: null, products: [], vendors: [], documents: [], settings: {}, runs: [] };
const templates = { dashboard: 'dashboard-template', vendors: 'vendors-template', products: 'products-template', library: 'library-template', updates: 'updates-template', runs: 'runs-template', settings: 'settings-template' };
const titles = { dashboard: ['OVERVIEW', '控制台'], vendors: ['SOURCE PLAYBOOK', '厂商记忆'], products: ['COLLATERAL GOVERNANCE', '产品与彩页'], library: ['ACTIVE LIBRARY', '本地资料库'], updates: ['INCREMENTAL UPDATE', '更新中心'], runs: ['AUDIT TRAIL', '任务日志'], settings: ['LOCAL ADMINISTRATION', '设置'] };
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
  const [overview, vendors, products, documents, settings, runs] = await Promise.all([api('/api/overview'), api('/api/vendors'), api('/api/products'), api('/api/documents'), api('/api/settings'), api('/api/runs')]);
  Object.assign(state, { overview, vendors, products, documents, settings, runs });
}
function mount(view) {
  const host = document.getElementById('content'); host.innerHTML = ''; const template = document.getElementById(templates[view]); host.appendChild(template.content.cloneNode(true));
  document.getElementById('view-kicker').textContent = titles[view][0]; document.getElementById('view-title').textContent = titles[view][1];
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('last-run').textContent = state.runs?.[0] ? `${state.runs[0].type} · ${fmtDate(state.runs[0].createdAt)}` : '尚未执行健康检查';
  ({ dashboard: renderDashboard, vendors: renderVendors, products: renderProducts, library: renderLibrary, updates: renderUpdates, runs: renderRuns, settings: renderSettings })[view]();
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
async function renderLibrary() {
  const target=document.getElementById('library-counts'); target.innerHTML='<p class="muted">正在扫描活动资料目录…</p>'; try { const data=await api('/api/library/scan'); const c=data.counts; target.innerHTML=[['PDF',c.pdf],['CSV',c.csv],['JSON',c.json],['其他文件',c.other]].map(([k,v])=>`<div class="stat-card"><div class="label">${k}</div><div class="value">${v}</div></div>`).join(''); document.getElementById('library-rows').innerHTML=data.entries.map(e=>`<tr><td>${esc(e.relativePath)}</td><td>${esc(e.ext || '无扩展名')}</td><td>${fmtBytes(e.bytes)}</td><td>${fmtDate(e.modifiedAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">活动资料目录为空。请将 PDF 和记录文件放入挂载目录。</td></tr>'; document.getElementById('scan-library').addEventListener('click', renderLibrary); } catch(err){ target.innerHTML=`<p class="form-error">${esc(err.message)}</p>`; }
}
function renderUpdates() {
  document.getElementById('auto-check').checked=Boolean(state.settings.autoHealthCheck); document.getElementById('interval-hours').value=state.settings.healthIntervalHours || 168;
  document.getElementById('run-health-2').addEventListener('click',runHealthCheck); document.getElementById('save-schedule').addEventListener('click', async()=>{ try { const settings=await api('/api/settings',{method:'PUT',body:JSON.stringify({autoHealthCheck:document.getElementById('auto-check').checked,healthIntervalHours:Number(document.getElementById('interval-hours').value)})}); state.settings=settings; notify('更新策略已保存。定时作业默认需在 NAS 侧通过容器重启策略或计划任务启用。');}catch(err){notify(err.message,true);} });
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
