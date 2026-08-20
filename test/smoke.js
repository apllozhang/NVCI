const assert = require('assert');

async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', ...options });
  const body = await response.text();
  return { response, body };
}

async function main() {
  const base = process.env.NVCI_TEST_BASE || 'http://127.0.0.1:8788';
  const login = await request(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'local-test-password' }) });
  assert.equal(login.response.status, 200, `登录失败：${login.body}`);
  const cookie = login.response.headers.get('set-cookie');
  assert(cookie && cookie.includes('nvci_session='), '登录未返回会话 Cookie');
  const overview = await request(`${base}/api/overview`, { headers: { cookie } });
  assert.equal(overview.response.status, 200, `控制台读取失败：${overview.body}`);
  const data = JSON.parse(overview.body);
  assert.equal(data.stats.vendorCount, 6, '厂商记忆数量错误');
  const vendors = await request(`${base}/api/vendors`, { headers: { cookie } });
  assert.equal(vendors.response.status, 200, `厂商记忆读取失败：${vendors.body}`);
  const huawei = JSON.parse(vendors.body).find((vendor) => vendor.id === 'huawei');
  assert(huawei, '未初始化华为企业网络厂商记忆');
  assert.equal(huawei.healthUrl, 'https://e.huawei.com/cn/solutions/enterprise-network', '华为健康检查入口错误');
  const health = await request(`${base}/api/health-check`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ vendorIds: ['ale'] }) });
  assert.equal(health.response.status, 200, `健康检查失败：${health.body}`);
  const result = JSON.parse(health.body);
  assert.equal(result.results.length, 1, '健康检查未返回单厂商结果');
  console.log(JSON.stringify({ vendorCount: data.stats.vendorCount, huaweiHealthUrl: huawei.healthUrl, productCount: data.stats.productCount, healthDecision: result.results[0].decision }, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
