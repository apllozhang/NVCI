'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { assertAllowedUrl, executeProfile, recoverStaleClaims, safeFetch } = require('../automation/collector-core');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function fixturePdf(label) { return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Title (${label}) >>\nendobj\ntrailer\n<< /Count 1 >>\n%%EOF\n`); }
function fixtureProfile(initialHash) {
  return {
    schemaVersion: '1.0', profileId: 'fixture_ale', vendorId: 'ale', displayName: 'Fixture ALE', enabled: true,
    mode: 'public_official_pdf_incremental', officialDomains: ['www.al-enterprise.com'], productLinePath: ['ALE产品彩页', '01 交换机'],
    sourcePolicy: 'test-only', collectionPolicy: { requestTimeoutMs: 5000, maxPdfBytes: 1024 * 1024, maxDocumentsPerRun: 15, userAgent: 'NVCI test', sequentialRequests: true },
    schedule: { enabled: false }, sources: [{ documentId: 'fixture-doc', series: 'OmniSwitch Fixture', modelNames: ['OS-FIXTURE'], productPageUrl: 'https://www.al-enterprise.com/en/products/switches/fixture', pdfUrl: 'https://www.al-enterprise.com/-/media/fixture.pdf', expectedSha256: initialHash, knownEtag: 'v1', knownLastModified: 'Tue, 01 Jan 2026 00:00:00 GMT', knownContentLength: 0, officialFileName: 'omniswitch-fixture.pdf', matchTerms: ['OmniSwitch Fixture'], evidencePolicy: 'official_datasheet_and_embedded_order_information' }],
  };
}
function writeProfile(root, profile) {
  const target = path.join(root, 'automation', 'source-profiles');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${profile.profileId}.json`), JSON.stringify(profile));
}
function mockFetcher(current) {
  const calls = { head: 0, get: 0 };
  const fetchImpl = async (_url, options) => {
    if (options.method === 'HEAD') {
      calls.head += 1;
      return new Response(null, { status: 200, headers: { 'content-type': 'application/pdf', etag: current.etag, 'last-modified': current.lastModified, 'content-length': String(current.pdf.length) } });
    }
    calls.get += 1;
    return new Response(current.pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  return { fetchImpl, calls };
}

test('拒绝非官方 HTTPS 或不在白名单的来源', () => {
  const profile = { officialDomains: ['www.al-enterprise.com'] };
  assert.throws(() => assertAllowedUrl('http://www.al-enterprise.com/file.pdf', profile));
  assert.throws(() => assertAllowedUrl('https://example.invalid/file.pdf', profile));
  assert.equal(assertAllowedUrl('https://www.al-enterprise.com/file.pdf', profile).hostname, 'www.al-enterprise.com');
});

test('仅允许官方起始 URL 跳转到显式声明的受控存储域', async () => {
  const profile = { officialDomains: ['www.ruijie.com.cn', 'yx.ruijie.com.cn'], trustedRedirectDomains: ['zlkfile.oss-cn-beijing.aliyuncs.com'], collectionPolicy: { requestTimeoutMs: 1000 } };
  assert.throws(() => assertAllowedUrl('https://zlkfile.oss-cn-beijing.aliyuncs.com/object.pdf', profile));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('yx.ruijie.com.cn')) return new Response(null, { status: 302, headers: { location: 'https://zlkfile.oss-cn-beijing.aliyuncs.com/object.pdf' } });
    return new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const result = await safeFetch('https://yx.ruijie.com.cn/yx/download/1-1497/?field=PreviewFile', { method: 'HEAD' }, profile, fetchImpl);
  assert.equal(result.finalUrl, 'https://zlkfile.oss-cn-beijing.aliyuncs.com/object.pdf');
  assert.equal(result.redirectCount, 1);
  assert.equal(calls.length, 2);
});

test('首次镜像、无变化复用和变化发布均受哈希与元数据门禁控制', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-collector-'));
  const firstPdf = fixturePdf('OmniSwitch Fixture v1');
  const profile = fixtureProfile(sha256(firstPdf));
  writeProfile(root, profile);
  const current = { pdf: firstPdf, etag: 'v1', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT' };
  let adapter = mockFetcher(current);
  const first = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(first.outcome, 'initial_mirror_published');
  assert.equal(first.bootstrapComplete, true);
  assert.equal(adapter.calls.get, 1);
  const activePdf = path.join(root, 'library', 'ALE产品彩页', '01 交换机', '01 官方彩页', 'OmniSwitch_Fixture', 'omniswitch-fixture.pdf');
  assert.equal(fs.readFileSync(activePdf).toString(), firstPdf.toString());

  adapter = mockFetcher(current);
  const second = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(second.outcome, 'no_change');
  assert.equal(adapter.calls.get, 0);

  current.pdf = fixturePdf('OmniSwitch Fixture v2'); current.etag = 'v2'; current.lastModified = 'Wed, 02 Jan 2026 00:00:00 GMT';
  adapter = mockFetcher(current);
  const third = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(third.outcome, 'changes_published');
  assert.equal(third.changed, 1);
  assert.equal(adapter.calls.get, 1);
  assert.equal(fs.readFileSync(activePdf).toString(), current.pdf.toString());
});


test('PDF 不可读或与声明系列不匹配时不得写入活动资料库', async () => {
  const parseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-gate-parse-'));
  const invalidPdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n');
  const parseProfile = fixtureProfile(sha256(invalidPdf));
  writeProfile(parseRoot, parseProfile);
  let adapter = mockFetcher({ pdf: invalidPdf, etag: 'broken', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT' });
  const parseResult = await executeProfile({ dataDir: parseRoot, profileId: parseProfile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(parseResult.outcome, 'attention');
  assert.equal(parseResult.failures[0].decision, 'parse_failed');
  const mismatchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-gate-match-'));
  const validPdf = fixturePdf('Unrelated Platform');
  const mismatchProfile = fixtureProfile(sha256(validPdf));
  mismatchProfile.sources[0].officialFileName = 'unrelated-platform.pdf';
  mismatchProfile.sources[0].matchTerms = ['OmniSwitch Fixture'];
  writeProfile(mismatchRoot, mismatchProfile);
  adapter = mockFetcher({ pdf: validPdf, etag: 'mismatch', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT' });
  const mismatchResult = await executeProfile({ dataDir: mismatchRoot, profileId: mismatchProfile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(mismatchResult.outcome, 'attention');
  assert.equal(mismatchResult.failures[0].decision, 'source_series_mismatch');
});

test('HTTP 请求超过受控超时会收敛为明确错误', async () => {
  const profile = { officialDomains: ['www.al-enterprise.com'], collectionPolicy: { requestTimeoutMs: 1000 } };
  const hangingFetcher = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(() => safeFetch('https://www.al-enterprise.com/file.pdf', { method: 'HEAD' }, profile, hangingFetcher), /请求头超时/);
});

test('陈旧 claimed 队列任务会自动恢复为可审计失败', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-stale-queue-'));
  const queueFile = path.join(root, 'automation', 'queue.json');
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, JSON.stringify({ items: [{ id: 'stale-1', profileId: 'fixture_ale', status: 'claimed', claimedAt: '2020-01-01T00:00:00Z' }] }));
  assert.equal(recoverStaleClaims(root, 1000), 1);
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  assert.equal(queue.items[0].status, 'failed');
  assert.equal(queue.items[0].outcome, 'interrupted');
});


test('未完成的首次镜像会复用已核验来源而不重复下载', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-bootstrap-resume-'));
  const pdf = fixturePdf('OmniSwitch Fixture resume');
  const profile = fixtureProfile(sha256(pdf));
  writeProfile(root, profile);
  const current = { pdf, etag: 'v1', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT' };
  let adapter = mockFetcher(current);
  await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  const stateFile = path.join(root, 'automation', 'profiles', profile.profileId, 'state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.bootstrapComplete = false;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  adapter = mockFetcher(current);
  const resumed = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(adapter.calls.get, 0);
  assert.equal(resumed.outcome, 'initial_mirror_published');
  assert.equal(resumed.bootstrapComplete, true);
});
