import test from 'node:test';
import assert from 'node:assert/strict';
import { vmDailyCheck } from '../ops/vm-daily-check.mjs';
import { observationAllowed } from '../ops/daily-check.mjs';
import { createTokenCipher, hash } from '../src/crypto.js';
const start = Date.parse('2026-10-26T00:00:00Z'),
  end = Date.parse('2026-11-03T00:00:00Z');
test('operator once/date/dry-run guards precede every command, credential, SDK and HTTP operation', async () => {
  let touches = 0;
  const no = async () => {
    touches++;
    throw Error('never');
  };
  for (const [once, at] of [
    [false, start],
    [true, start - 1],
    [true, end],
    [true, NaN],
  ]) {
    const r = await vmDailyCheck({ once, now: () => at, command: no, readGrant: no, request: no });
    assert.equal(r.status, 'not-run');
  }
  assert.equal(
    (
      await vmDailyCheck({
        once: true,
        dryRun: true,
        now: () => start,
        command: no,
        readGrant: no,
        request: no,
      })
    ).status,
    'dry-run',
  );
  assert.equal(touches, 0);
  assert.equal(observationAllowed(true, end - 1), true);
  assert.equal(observationAllowed(true, end), false);
});
function adapter(scopes) {
  const commandCalls = [],
    requests = [],
    reads = [],
    origin = 'https://raid-relic-760724762396.us-central1.run.app',
    client = 'publicclient',
    bot = '1591804828',
    keepers = ['1591805230', '1591806023'],
    key = Buffer.alloc(32, 7).toString('base64');
  const env = Object.entries({
    TWITCH_CLIENT_ID: client,
    TWITCH_BOT_ID: bot,
    OVERLAY_ORIGIN: origin,
    EVENTSUB_CALLBACK_URL: origin + '/eventsub',
    KEEPER_CHANNEL_IDS: keepers.join(','),
    P7_BOT_ACTIONS_ENABLED: 'true',
  }).map(([name, value]) => ({ name, value }));
  for (const name of ['TWITCH_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'])
    env.push({
      name,
      valueFrom: { secretKeyRef: { name: name.toLowerCase().replaceAll('_', '-'), key: '1' } },
    });
  const command = async (args) => {
    commandCalls.push(args);
    if (args[1] === 'services')
      return JSON.stringify({
        status: {
          traffic: [
            { percent: 100, revisionName: 'raid-relic-current' },
            { percent: 0, revisionName: 'raid-relic-preview' },
          ],
        },
        spec: { template: { metadata: { name: 'raid-relic-preview' } } },
      });
    if (args[1] === 'revisions') {
      assert.equal(args[3], 'raid-relic-current');
      return JSON.stringify({ spec: { containers: [{ env }] } });
    }
    return args.includes('token-encryption-key') ? ' \n' + key + '\n' : ' synthetic-secret\n';
  };
  const readGrant = async (project, id, guard) => {
    guard();
    reads.push(id);
    assert.equal(id, hash('bot'));
    return createTokenCipher(key).seal(
      { access_token: 'synthetic-existing' },
      `${client}:bot:${bot}`,
    );
  };
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/health')) return { status: 200, data: { status: 'ok' } };
    if (url.endsWith('/validate'))
      return { status: 200, data: { client_id: client, user_id: bot, expires_in: 60, scopes } };
    if (url.endsWith('/token')) {
      assert.equal(new URLSearchParams(options.body).get('grant_type'), 'client_credentials');
      assert.equal(new URLSearchParams(options.body).get('client_secret'), 'synthetic-secret');
      return { status: 200, data: { access_token: 'synthetic-app' } };
    }
    return {
      status: 200,
      data: {
        pagination: {},
        data: keepers
          .flatMap((id) => [
            { type: 'stream.online', condition: { broadcaster_user_id: id } },
            { type: 'stream.offline', condition: { broadcaster_user_id: id } },
            {
              type: 'channel.raid',
              condition: { from_broadcaster_user_id: id, to_broadcaster_user_id: '' },
            },
            { type: 'channel.raid', condition: { to_broadcaster_user_id: id } },
            { type: 'channel.chat.message', condition: { broadcaster_user_id: id, user_id: bot } },
          ])
          .map((s) => ({
            ...s,
            version: '1',
            status: 'enabled',
            transport: { method: 'webhook', callback: origin + '/eventsub' },
          })),
      },
    };
  };
  return { command, readGrant, request, commandCalls, requests, reads };
}
const base = ['user:read:chat', 'user:write:chat', 'user:bot'],
  optional = [
    'moderator:manage:announcements',
    'moderator:manage:chat_messages',
    'moderator:manage:shoutouts',
    'user:read:moderated_channels',
  ];
test('current100 revision only, hashed bot grant read, seven scopes when P7 is active; no mutation/refresh', async () => {
  for (const scopes of [base, [...base, ...optional]]) {
    const a = adapter(scopes),
      r = await vmDailyCheck({ once: true, now: () => start, ...a });
    assert.equal(r.status, scopes.length === 7 ? 'ok' : 'attention');
    assert.equal(a.commandCalls.length, 4);
    assert.deepEqual(a.reads, [hash('bot')]);
    assert.equal(a.requests.length, 4);
    assert.equal(a.requests.filter((r) => r.options?.method === 'POST').length, 1);
    assert.doesNotMatch(JSON.stringify(r), /synthetic|secret|ciphertext|Authorization/);
  }
});
test('cutoff reached during metadata prevents subsequent secret/SDK/provider access', async () => {
  const a = adapter([...base, ...optional]);
  let at = start;
  const command = async (args) => {
    const result = await a.command(args);
    at = end;
    return result;
  };
  const r = await vmDailyCheck({ once: true, now: () => at, ...a, command });
  assert.equal(r.status, 'attention');
  assert.equal(a.commandCalls.length, 1);
  assert.equal(a.reads.length, 0);
  assert.equal(a.requests.length, 0);
});

test('unexpected secret resource is rejected before any secret/grant/provider access', async () => {
  const a = adapter([...base, ...optional]),
    command = async (args) => {
      const text = await a.command(args);
      return args[1] === 'revisions'
        ? text.replace('twitch-client-secret', 'unrelated-secret')
        : text;
    };
  const result = await vmDailyCheck({ once: true, now: () => start, ...a, command });
  assert.equal(result.status, 'attention');
  assert.equal(a.commandCalls.length, 2);
  assert.equal(a.reads.length, 0);
  assert.equal(a.requests.length, 0);
});
