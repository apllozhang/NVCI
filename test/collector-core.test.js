'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { assertAllowedUrl, executeProfile, recoverStaleClaims, safeFetch } = require('../automation/collector-core');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function fixtureProfile(initialHash) {
  return {
    schemaVersion: '1.0', profileId: 'fixture_ale', vendorId: 'ale', displayName: 'Fixture ALE', enabled: true,
    mode: 'public_official_pdf_incremental', officialDomains: ['www.al-enterprise.com'], productLinePath: ['ALE产品彩页', '01 交换机'],
    sourcePolicy: 'test-only', collectionPolicy: { requestTimeoutMs: 5000, maxPdfBytes: 1024 * 1024, maxDocumentsPerRun: 15, userAgent: 'NVCI test', sequentialRequests: true },
    schedule: { enabled: false }, sources: [{ documentId: 'fixture-doc', series: 'OmniSwitch Fixture', productPageUrl: 'https://www.al-enterprise.com/en/products/switches/fixture', pdfUrl: 'https://www.al-enterprise.com/-/media/fixture.pdf', expectedSha256: initialHash, knownEtag: 'v1', knownLastModified: 'Tue, 01 Jan 2026 00:00:00 GMT', knownContentLength: 0, officialFileName: 'fixture.pdf', evidencePolicy: 'official_datasheet_and_embedded_order_information' }],
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

test('首次镜像、无变化复用和变化发布均受哈希与元数据门禁控制', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvci-collector-'));
  const firstPdf = Buffer.from('%PDF-1.7\nfixture-v1\n');
  const profile = fixtureProfile(sha256(firstPdf));
  writeProfile(root, profile);
  const current = { pdf: firstPdf, etag: 'v1', lastModified: 'Tue, 01 Jan 2026 00:00:00 GMT' };
  let adapter = mockFetcher(current);
  const first = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(first.outcome, 'initial_mirror_published');
  assert.equal(first.bootstrapComplete, true);
  assert.equal(adapter.calls.get, 1);
  const activePdf = path.join(root, 'library', 'ALE产品彩页', '01 交换机', '01 官方彩页', 'OmniSwitch_Fixture', 'fixture.pdf');
  assert.equal(fs.readFileSync(activePdf).toString(), firstPdf.toString());

  adapter = mockFetcher(current);
  const second = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(second.outcome, 'no_change');
  assert.equal(adapter.calls.get, 0);

  current.pdf = Buffer.from('%PDF-1.7\nfixture-v2\n'); current.etag = 'v2'; current.lastModified = 'Wed, 02 Jan 2026 00:00:00 GMT';
  adapter = mockFetcher(current);
  const third = await executeProfile({ dataDir: root, profileId: profile.profileId, fetchImpl: adapter.fetchImpl });
  assert.equal(third.outcome, 'changes_published');
  assert.equal(third.changed, 1);
  assert.equal(adapter.calls.get, 1);
  assert.equal(fs.readFileSync(activePdf).toString(), current.pdf.toString());
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
