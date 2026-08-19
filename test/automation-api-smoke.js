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
  console.log(JSON.stringify({ profileId: profile.profileId, sourceCount: profile.sourceCount, queuedRequest: queued.data.id }));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
