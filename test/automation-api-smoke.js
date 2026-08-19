'use strict';

const assert = require('node:assert/strict');

const base = process.env.NVCI_TEST_BASE || 'http://127.0.0.1:8790';
const password = process.env.NVCI_ADMIN_PASSWORD || 'local-test-password';

async function request(url, options = {}) {
  const response = await fetch(`${base}${url}`, options);
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { response, data };
}

(async () => {
  const login = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.response.status, 200, `login failed: ${JSON.stringify(login.data)}`);
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const status = await request('/api/automation', { headers });
  assert.equal(status.response.status, 200, `automation state failed: ${JSON.stringify(status.data)}`);
  const profile = status.data.profiles.find((item) => item.profileId === 'ale_omniswitch');
  assert.ok(profile, 'ALE OmniSwitch profile was not copied into runtime data');
  assert.equal(profile.sourceCount, 15);
  const queued = await request('/api/automation/profiles/ale_omniswitch/run', { method: 'POST', headers, body: '{}' });
  assert.equal(queued.response.status, 202, `queue failed: ${JSON.stringify(queued.data)}`);
  assert.equal(queued.data.status, 'queued');
  const after = await request('/api/automation', { headers });
  assert.ok(after.data.queue.some((item) => item.id === queued.data.id && item.status === 'queued'));
  const draftBody = { vendorId:'fixture_vendor', vendorName:'Fixture Vendor', displayName:'Fixture Campus Switch 官方 Data sheet', officialDomains:['www.al-enterprise.com'], productLine:{ id:'switches', name:'交换机', libraryRootName:'Fixture产品彩页' }, subseries:{ id:'campus_1000', name:'Campus 1000' }, sources:[{ series:'Campus 1000', modelNames:['C1000-24T','C1000-48P'], productPageUrl:'https://www.al-enterprise.com/en/products/switches', pdfUrl:'https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-2260-datasheet-en.pdf', officialFileName:'Campus_1000_Data_Sheet.pdf', evidencePolicy:'official_datasheet' }] };
  const created = await request('/api/source-configs', { method:'POST', headers, body:JSON.stringify(draftBody) });
  assert.equal(created.response.status, 201, `source config create failed: ${JSON.stringify(created.data)}`);
  assert.equal(created.data.approvalStatus, 'draft'); assert.equal(created.data.modelCount, 2);
  const list = await request('/api/source-configs', { headers });
  assert.ok(list.data.some((item) => item.profileId === created.data.profileId && item.subseries.name === 'Campus 1000'));
  const blocked = await request(`/api/automation/profiles/${created.data.profileId}/run`, { method:'POST', headers, body:'{}' });
  assert.equal(blocked.response.status, 400, 'unapproved source config must not be queued');
  console.log(JSON.stringify({ profileId: profile.profileId, sourceCount: profile.sourceCount, queuedRequest: queued.data.id, draftProfile: created.data.profileId, draftModels: created.data.modelCount }));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
