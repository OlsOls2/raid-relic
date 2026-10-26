// Operator-only fixed-canonical worker. Source author never executes this file.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { wanderSignature, WANDER_PURPOSE } from '../src/wander-auth.js';
const ORIGIN = 'https://raid-relic-760724762396.us-central1.run.app';
const PROJECT = 'raid-relic-hackathon',
  REGION = 'us-central1';
export async function wanderHTTP(url, options = {}) {
  if (![ORIGIN + '/health', ORIGIN + '/internal/wander/tick'].includes(url))
    throw Error('Fixed worker origin required');
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > 8192) throw Error('Bounded response');
    chunks.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    data = null;
  }
  return { status: response.status, data };
}
export async function wanderCommand(args) {
  const { stdout } = await promisify(execFile)('gcloud', args, {
    timeout: 8000,
    maxBuffer: 262144,
    encoding: 'utf8',
  });
  return stdout;
}
export async function wanderWorker({
  once = false,
  dryRun = false,
  request = wanderHTTP,
  command = wanderCommand,
  now = Date.now,
  nonce = () => randomBytes(16).toString('hex'),
} = {}) {
  if (!once) return { status: 'not-run', reason: 'explicit-once-required' };
  try {
    // No CLI, metadata, SDK or credential access before the canonical gate.
    const health = await request(ORIGIN + '/health');
    const h = health.data;
    if (
      health.status !== 200 ||
      h?.status !== 'ok' ||
      h.wander?.enabled !== true ||
      h.wander.kind !== 'non-raid' ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(h.releaseCommit ?? '')
    )
      return { status: 'not-run', reason: 'canonical-wander-unavailable' };
    if (dryRun) return { status: 'dry-run', credentialsRead: false };
    const service = JSON.parse(
      await command([
        'run',
        'services',
        'describe',
        'raid-relic',
        '--project',
        PROJECT,
        '--region',
        REGION,
        '--format=json',
      ]),
    );
    const serving = service.status?.traffic?.filter((t) => t.percent > 0);
    if (
      serving?.length !== 1 ||
      serving[0].percent !== 100 ||
      !/^raid-relic-[a-z0-9-]+$/.test(serving[0].revisionName)
    )
      throw Error('Current revision unavailable');
    const revision = JSON.parse(
      await command([
        'run',
        'revisions',
        'describe',
        serving[0].revisionName,
        '--project',
        PROJECT,
        '--region',
        REGION,
        '--format=json',
      ]),
    );
    const containers = revision.spec?.containers;
    if (
      !Array.isArray(containers) ||
      containers.length !== 1 ||
      !Array.isArray(containers[0].env) ||
      containers[0].env.length > 128
    )
      throw Error('Revision invalid');
    const env = containers[0].env;
    if (new Set(env.map((v) => v.name)).size !== env.length) throw Error('Duplicate configuration');
    const value = (name) => env.find((v) => v.name === name)?.value;
    if (
      value('RELEASE_COMMIT') !== h.releaseCommit ||
      value('WANDER_ENABLED') !== 'true' ||
      value('P5_PREVIEW_READ_ONLY') === 'true' ||
      value('OVERLAY_ORIGIN') !== ORIGIN ||
      value('EVENTSUB_CALLBACK_URL') !== ORIGIN + '/eventsub'
    )
      throw Error('Canonical configuration mismatch');
    const ref = env.find((v) => v.name === 'TOKEN_ENCRYPTION_KEY')?.valueFrom?.secretKeyRef;
    const full =
      /^projects\/(raid-relic-hackathon|760724762396)\/secrets\/(token-encryption-key)$/.exec(
        ref?.name ?? '',
      );
    if (
      !ref ||
      (!full && ref.name !== 'token-encryption-key') ||
      !/^(latest|[1-9]\d*)$/.test(ref.key ?? '')
    )
      throw Error('Expected key reference required');
    // Captured child stdout stays in memory; never argv/env/log/file key material.
    const key = (
      await command([
        'secrets',
        'versions',
        'access',
        ref.key,
        '--secret',
        'token-encryption-key',
        '--project',
        full ? full[1] : PROJECT,
      ])
    ).trim();
    const timestamp = now(),
      n = nonce();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !/^[a-f0-9]{32}$/.test(n))
      throw Error('Tick input invalid');
    const raw = Buffer.from(JSON.stringify({ purpose: WANDER_PURPOSE, timestamp, nonce: n }));
    const signature = wanderSignature(key, raw);
    const result = await request(ORIGIN + '/internal/wander/tick', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rr-wander-signature': signature },
      body: raw,
    });
    const statuses = [
      'waiting',
      'needs-work',
      'warning-queued',
      'warning-unconfirmed',
      'warned',
      'parked',
      'wandered',
      'busy',
      'duplicate',
      'superseded',
      'capability-unavailable',
      'capacity',
      'clock-or-tracker-unavailable',
      'unavailable',
    ];
    return result.status === 200 && statuses.includes(result.data?.status)
      ? { status: result.data.status }
      : { status: 'attention', reason: 'tick-unconfirmed-no-retry' };
  } catch {
    return { status: 'attention', reason: 'worker-unavailable-no-retry' };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--once', '--dry-run'].includes(a))) {
    console.log(JSON.stringify({ status: 'not-run', reason: 'unknown-option' }));
    process.exitCode = 1;
  } else {
    const result = await wanderWorker({
      once: args.includes('--once'),
      dryRun: args.includes('--dry-run'),
    });
    console.log(JSON.stringify(result));
    if (result.status === 'attention') process.exitCode = 1;
  }
}
