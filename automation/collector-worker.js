'use strict';

const { claimNextRun, createStatus, ensureBundledProfiles, executeProfile, finishQueuedRun, listProfiles, readJson, recoverStaleClaims, writeJsonAtomic } = require('./collector-core');

const DATA_DIR = process.env.NVCI_DATA_DIR || '/data';
const POLL_SECONDS = Math.max(15, Number(process.env.NVCI_AUTOMATION_POLL_SECONDS || 60));
const ENABLED = String(process.env.NVCI_AUTOMATION_ENABLED || 'true').toLowerCase() === 'true';
const RUN_ON_START = String(process.env.NVCI_AUTOMATION_RUN_ON_START || 'false').toLowerCase() === 'true';
let busy = false;

function scheduleDue(profile, state, now = new Date()) {
  if (!profile.enabled || !profile.schedule || profile.schedule.enabled === false) return false;
  const schedule = profile.schedule;
  if (now.getDay() !== Number(schedule.weekday) || now.getHours() !== Number(schedule.hour) || now.getMinutes() !== Number(schedule.minute)) return false;
  const today = now.toISOString().slice(0, 10);
  return state.lastScheduledDate !== today;
}

function markScheduleRun(profileId, date) {
  const file = `${DATA_DIR}/automation/profiles/${profileId}/state.json`;
  const state = readJson(file, { profileId, sources: {}, publishedSnapshots: [] });
  writeJsonAtomic(file, { ...state, lastScheduledDate: date });
}

async function runOne(profileId, trigger, requestId = '') {
  busy = true;
  try {
    const result = await executeProfile({ dataDir: DATA_DIR, profileId, force: false });
    if (requestId) finishQueuedRun(DATA_DIR, requestId, result.outcome);
    console.log(JSON.stringify({ event: 'collector_complete', trigger, ...result }));
  } catch (error) {
    const message = String(error.message || error);
    if (requestId) finishQueuedRun(DATA_DIR, requestId, '', message);
    createStatus(DATA_DIR, { profiles: { [profileId]: { state: 'attention', error: message, completedAt: new Date().toISOString() } } });
    console.error(JSON.stringify({ event: 'collector_failed', trigger, profileId, error: message }));
  } finally {
    busy = false;
  }
}

async function tick() {
  if (!ENABLED || busy) return;
  ensureBundledProfiles(DATA_DIR);
  const recovered = recoverStaleClaims(DATA_DIR);
  if (recovered) console.warn(JSON.stringify({ event: 'collector_stale_claims_recovered', count: recovered }));
  const queued = claimNextRun(DATA_DIR);
  if (queued) { await runOne(queued.profileId, 'manual_queue', queued.id); return; }
  const now = new Date();
  const profiles = listProfiles(DATA_DIR);
  for (const profile of profiles) {
    const state = readJson(`${DATA_DIR}/automation/profiles/${profile.profileId}/state.json`, {});
    if (scheduleDue(profile, state, now)) {
      markScheduleRun(profile.profileId, now.toISOString().slice(0, 10));
      await runOne(profile.profileId, 'scheduled');
      return;
    }
  }
}

async function main() {
  ensureBundledProfiles(DATA_DIR);
  const recovered = recoverStaleClaims(DATA_DIR);
  createStatus(DATA_DIR, { worker: { state: ENABLED ? 'idle' : 'disabled', startedAt: new Date().toISOString(), pollSeconds: POLL_SECONDS, recoveredStaleClaims: recovered } });
  console.log(JSON.stringify({ event: 'collector_worker_started', dataDir: DATA_DIR, enabled: ENABLED, pollSeconds: POLL_SECONDS }));
  if (ENABLED && RUN_ON_START) {
    const profiles = listProfiles(DATA_DIR).filter((profile) => profile.enabled);
    if (profiles.length) await runOne(profiles[0].profileId, 'startup');
  }
  await tick();
  setInterval(() => { tick().catch((error) => console.error(JSON.stringify({ event: 'collector_tick_failed', error: String(error.message || error) }))); }, POLL_SECONDS * 1000);
}

main().catch((error) => { console.error(error); process.exit(1); });
