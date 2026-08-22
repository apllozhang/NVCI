'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  const dataDir = process.env.NVCI_DATA_DIR;
  if (dataDir) {
    const libraryDir = path.join(dataDir, 'library', '测试资料库', '01 官方彩页');
    fs.mkdirSync(libraryDir, { recursive: true });
    for (let index = 1; index <= 23; index += 1) {
      const ext = index % 3 === 0 ? '.csv' : index % 3 === 1 ? '.pdf' : '.json';
      fs.writeFileSync(path.join(libraryDir, `测试文件-${String(index).padStart(2, '0')}${ext}`), `fixture-${index}`);
    }
  }
  const firstLibraryPage = await request('/api/library/scan?page=1&pageSize=10&sort=path_asc', { headers });
  assert.equal(firstLibraryPage.response.status, 200, `library scan failed: ${JSON.stringify(firstLibraryPage.data)}`);
  assert.ok(firstLibraryPage.data.entryCount >= 23, 'library scan must return all indexed files');
  assert.equal(firstLibraryPage.data.entries.length, 10, 'library page size 10 must be honored');
  assert.equal(firstLibraryPage.data.pageCount, 3, 'library results must provide page count');
  const secondLibraryPage = await request('/api/library/scan?page=2&pageSize=10&sort=path_asc', { headers });
  assert.equal(secondLibraryPage.data.entries[0].relativePath.endsWith('测试文件-11.json'), true, 'library paths must use stable natural ordering');
  const filteredLibrary = await request('/api/library/scan?page=1&pageSize=20&type=pdf&q=测试文件-01&sort=path_asc', { headers });
  assert.equal(filteredLibrary.data.filteredCount, 1, 'library query and type filter must be combined');
  assert.equal(filteredLibrary.data.entries[0].fileName, '测试文件-01.pdf');
  const status = await request('/api/automation', { headers });
  assert.equal(status.response.status, 200, `automation state failed: ${JSON.stringify(status.data)}`);
  const profile = status.data.profiles.find((item) => item.profileId === 'ale_omniswitch');
  assert.ok(profile, 'ALE OmniSwitch profile was not copied into runtime data');
  assert.equal(profile.sourceCount, 15);
  const huaweiProfiles = status.data.profiles.filter((item) => item.vendorId === 'huawei');
  assert.equal(huaweiProfiles.length, 7, 'all seven Huawei bundled profiles must be loaded');
  assert.equal(huaweiProfiles.reduce((total, item) => total + item.sourceCount, 0), 42, 'Huawei bundled profiles must contain 42 verified sources');
  for (const huaweiProfile of huaweiProfiles) {
    assert.equal(huaweiProfile.approvalStatus, 'draft', `${huaweiProfile.profileId} must require sample verification before approval`);
    assert.equal(huaweiProfile.enabled, false, `${huaweiProfile.profileId} must remain disabled until manually approved`);
  }
  const extremeProfiles = status.data.profiles.filter((item) => item.vendorId === 'extreme');
  assert.equal(extremeProfiles.length, 3, 'Extreme must load three product-domain bundled profiles');
  assert.equal(extremeProfiles.reduce((total, item) => total + item.sourceCount, 0), 48, 'Extreme must contain all Drive-verified Data Sheets');
  const extremeExpectedCounts = { extreme_wired_access_datasheets: 23, extreme_wireless_access_datasheets: 13, extreme_management_datasheets: 12 };
  for (const [profileId, sourceCount] of Object.entries(extremeExpectedCounts)) {
    const extremeProfile = extremeProfiles.find((item) => item.profileId === profileId);
    assert.ok(extremeProfile, `${profileId} must be loaded`);
    assert.equal(extremeProfile.sourceCount, sourceCount, `${profileId} source count mismatch`);
    assert.equal(extremeProfile.approvalStatus, 'draft'); assert.equal(extremeProfile.enabled, false);
  }
  const controlledVendorIds = ['ale', 'hpe', 'cisco', 'h3c', 'ruijie', 'huawei', 'extreme'];
  for (const vendorId of controlledVendorIds) {
    const vendorProfiles = status.data.profiles.filter((item) => item.vendorId === vendorId);
    assert.ok(vendorProfiles.length > 0, `${vendorId} must have at least one controlled source profile`);
    if (vendorId !== 'ale') {
      for (const vendorProfile of vendorProfiles) {
        assert.equal(vendorProfile.approvalStatus, 'draft', `${vendorProfile.profileId} must require sample verification before approval`);
        assert.equal(vendorProfile.enabled, false, `${vendorProfile.profileId} must remain disabled until manually approved`);
      }
    }
  }
  const queued = await request('/api/automation/profiles/ale_omniswitch/run', { method: 'POST', headers, body: '{}' });
  assert.equal(queued.response.status, 202, `queue failed: ${JSON.stringify(queued.data)}`);
  assert.equal(queued.data.status, 'queued');
  const after = await request('/api/automation', { headers });
  assert.ok(after.data.queue.some((item) => item.id === queued.data.id && item.status === 'queued'));
  const onboardingOptions = await request('/api/onboarding/options', { headers });
  assert.equal(onboardingOptions.response.status, 200, `onboarding options failed: ${JSON.stringify(onboardingOptions.data)}`);
  assert.ok(onboardingOptions.data.vendors.length >= 7);
  assert.ok(onboardingOptions.data.profiles.some((item) => item.profileId === 'ale_omniswitch'));
  assert.ok(onboardingOptions.data.fieldTemplates.some((item) => item.templateId === 'campus_switching_v1'));
  const onboardingCreated = await request('/api/onboarding/tasks', { method:'POST', headers, body:JSON.stringify({ title:'ALE OmniSwitch 新手任务回归', decisionQuestion:'建立 ALE OmniSwitch 产品列表、官方 URL 与关键交换机参数归档范围。', mode:'vertical', priority:'high', profileIds:['ale_omniswitch'], execution:{ type:'weekly', weekday:1, hour:2, minute:15 }, analysis:{ templateId:'campus_switching_v1', selectedFieldCodes:['form_factor','downlink_ports','switching_capacity','ospf_support'], rationale:'API 回归：验证任务卡、产品 URL、执行计划与字段包。' } }) });
  assert.equal(onboardingCreated.response.status, 201, `onboarding create failed: ${JSON.stringify(onboardingCreated.data)}`);
  assert.equal(onboardingCreated.data.status, 'scheduled');
  assert.equal(onboardingCreated.data.vendorIds[0], 'ale');
  assert.ok(onboardingCreated.data.products.length >= 15);
  assert.ok(onboardingCreated.data.products.every((item) => item.pdfUrl && item.modelName));
  assert.equal(onboardingCreated.data.fieldScope.pending.packStatus, 'pending_approval');
  const onboardingRun = await request(`/api/onboarding/tasks/${onboardingCreated.data.taskId}/run-now`, { method:'POST', headers, body:'{}' });
  assert.equal(onboardingRun.response.status, 202, `onboarding run failed: ${JSON.stringify(onboardingRun.data)}`);
  assert.ok(onboardingRun.data.requests.length >= 1);
  const onboardingDetail = await request(`/api/onboarding/tasks/${onboardingCreated.data.taskId}`, { headers });
  assert.equal(onboardingDetail.response.status, 200);
  assert.equal(onboardingDetail.data.status, 'queued');
  assert.ok(onboardingDetail.data.requests.some((item) => (item.onboardingTaskIds || []).includes(onboardingCreated.data.taskId)));
  const draftBody = { vendorId:'fixture_vendor', vendorName:'Fixture Vendor', displayName:'Fixture Campus Switch 官方 Data sheet', officialDomains:['www.al-enterprise.com'], productLine:{ id:'switches', name:'交换机', libraryRootName:'Fixture产品彩页' }, subseries:{ id:'campus_1000', name:'Campus 1000' }, sources:[{ series:'Campus 1000', modelNames:['C1000-24T','C1000-48P'], productPageUrl:'https://www.al-enterprise.com/en/products/switches', pdfUrl:'https://www.al-enterprise.com/-/media/assets/internet/documents/omniswitch-2260-datasheet-en.pdf', officialFileName:'Campus_1000_Data_Sheet.pdf', evidencePolicy:'official_datasheet' }] };
  const created = await request('/api/source-configs', { method:'POST', headers, body:JSON.stringify(draftBody) });
  assert.equal(created.response.status, 201, `source config create failed: ${JSON.stringify(created.data)}`);
  assert.equal(created.data.approvalStatus, 'draft'); assert.equal(created.data.modelCount, 2);
  const list = await request('/api/source-configs', { headers });
  assert.ok(list.data.some((item) => item.profileId === created.data.profileId && item.subseries.name === 'Campus 1000'));
  const blocked = await request(`/api/automation/profiles/${created.data.profileId}/run`, { method:'POST', headers, body:'{}' });
  assert.equal(blocked.response.status, 400, 'unapproved source config must not be queued');
  console.log(JSON.stringify({ profileId: profile.profileId, sourceCount: profile.sourceCount, controlledVendors: controlledVendorIds, queuedRequest: queued.data.id, draftProfile: created.data.profileId, draftModels: created.data.modelCount }));
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
