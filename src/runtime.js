import { wanderPolicy } from './wander-state.js';
import { createWander } from './wander.js';
import { createReceiving, configuredKeeperNetwork, RECEIVING_KEEPERS } from './receiving.js';
import { markReviewPolicy } from './marks.js';
import { createP7, p7Config } from './p7.js';
import { createMarkShares, createShareReplies } from './my-marks.js';
import { createForge } from './forge.js';
import { randomUUID } from 'node:crypto';
import { createChronicle } from './chronicle.js';
import { createClaimAcks, createBotReplyQueue } from './claim-ack.js';
import { createApp } from './app.js';
import { createMemoryState } from './state.js';
import { createMemoryAuthStore, createFirestoreStore } from './store.js';
import { createOAuth, httpTransport } from './oauth.js';
import { createBot } from './bot.js';
import { createPilot } from './pilot.js';
import { createOverlayHub } from './overlay-feed.js';
import { validateReleaseCommit } from './release.js';
import { createSubscriptionManager } from './subscriptions.js';
import { createSendOff } from './send-off.js';

export const PROJECT_ID = 'raid-relic-hackathon';
export async function createRuntime(
  env,
  {
    firestoreClient,
    transport,
    chronicleHTTP,
    forgeHTTP,
    p7HTTP,
    now = Date.now,
    simulator = false,
    loadSDK = () => import('@google-cloud/firestore'),
  } = {},
) {
  const production = env.NODE_ENV === 'production';
  if (production && simulator) throw new Error('Simulator forbidden in production');
  const releaseCommit = validateReleaseCommit(env.RELEASE_COMMIT, { required: production });
  if (env.P5_PREVIEW_READ_ONLY && !['true', 'false'].includes(env.P5_PREVIEW_READ_ONLY))
    throw Error('Explicit preview gate required');
  const previewReadOnly = env.P5_PREVIEW_READ_ONLY === 'true';
  const raidPilot = env.RAID_PILOT_ENABLED === 'true';
  const requestedP7 = p7Config(env),
    p7Flags = {
      ...requestedP7,
      enabled: requestedP7.enabled && raidPilot && env.OAUTH_ENABLED === 'true' && !previewReadOnly,
    };
  if (env.RAID_PILOT_ENABLED && !['true', 'false'].includes(env.RAID_PILOT_ENABLED))
    throw new Error('Explicit pilot gate required');
  if (env.SEEKERS_ENABLED && !['true', 'false'].includes(env.SEEKERS_ENABLED))
    throw Error('Explicit Seekers gate required');
  const seekersEnabled = env.SEEKERS_ENABLED === 'true';
  if (seekersEnabled && !raidPilot) throw Error('Seekers require the authorised Keeper pilot');
  const wander = wanderPolicy(env);
  if (wander.enabled && (!seekersEnabled || !raidPilot))
    throw Error('Wander requires the authorised Seeker pilot');
  const reviewPolicy = markReviewPolicy(env);
  let state;
  let store;
  if (env.PILOT_KEEPERS_JSON !== undefined && !raidPilot)
    throw Error('Keeper mapping requires the authorised pilot');
  const keeperNames =
    raidPilot || env.PILOT_KEEPERS_JSON !== undefined
      ? configuredKeeperNetwork(env.PILOT_KEEPERS_JSON, {
          home: env.TWITCH_STREAMER_ID,
          bot: env.TWITCH_BOT_ID,
        })
      : RECEIVING_KEEPERS;
  const keeperIds =
    env.PILOT_KEEPERS_JSON !== undefined
      ? Object.keys(keeperNames)
      : env.KEEPER_CHANNEL_IDS
        ? env.KEEPER_CHANNEL_IDS.split(',')
        : [env.TWITCH_STREAMER_ID];
  if (
    new Set(keeperIds).size !== keeperIds.length ||
    ((raidPilot || env.KEEPER_CHANNEL_IDS) &&
      !keeperIds.every((id) => Object.hasOwn(keeperNames, id))) ||
    (env.PILOT_KEEPERS_JSON !== undefined &&
      env.KEEPER_CHANNEL_IDS &&
      (env.KEEPER_CHANNEL_IDS.split(',').length !== keeperIds.length ||
        !env.KEEPER_CHANNEL_IDS.split(',').every((id) => keeperIds.includes(id))))
  )
    throw Error('Keeper allowlist rejected');
  if (
    raidPilot &&
    (env.OAUTH_ENABLED !== 'true' ||
      !Object.keys(keeperNames).every((id) => keeperIds.includes(id)))
  )
    throw Error('Pilot needs all configured Keepers and OAuth controls');
  if (
    raidPilot &&
    (new URL(env.OAUTH_REDIRECT_URI).pathname !== '/auth/callback' ||
      new URL(env.EVENTSUB_CALLBACK_URL).origin !== new URL(env.OAUTH_REDIRECT_URI).origin)
  )
    throw new Error('Pilot callback configuration mismatch');
  if (env.P9_STREAK_ENABLED && !['true', 'false'].includes(env.P9_STREAK_ENABLED))
    throw Error('Explicit streak gate required');
  const lifecycle =
    env.OAUTH_ENABLED === 'true'
      ? {
          channels: keeperIds,
          streakEnabled: env.P9_STREAK_ENABLED === 'true',
          seekersEnabled,
          ...(raidPilot
            ? {
                logins: Object.fromEntries(
                  Object.entries(keeperNames).map(([id, login]) => [login, id]),
                ),
              }
            : {}),
        }
      : undefined;
  if (env.STATE_STORE === 'firestore') {
    if (env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID || env.FIRESTORE_EMULATOR_HOST)
      throw new Error('Firestore project configuration rejected');
    const db = firestoreClient ?? new (await loadSDK()).Firestore({ projectId: PROJECT_ID });
    state = store = createFirestoreStore(db, {
      lifecycle,
      p7Enabled: p7Flags.enabled,
      reviewPolicy,
      wander,
    });
  } else {
    if (production || env.STATE_STORE !== 'memory')
      throw new Error('Select STATE_STORE explicitly; production requires Firestore');
    state = createMemoryState({ lifecycle, p7Enabled: p7Flags.enabled, reviewPolicy, wander });
    store = createMemoryAuthStore();
  }
  if (
    !env.TWITCH_EVENTSUB_SECRET ||
    env.TWITCH_EVENTSUB_SECRET.length < 10 ||
    env.TWITCH_EVENTSUB_SECRET.length > 100
  )
    throw new Error('Webhook secret required');
  let oauth;
  let bot;
  let subscriptions;
  if (env.OAUTH_ENABLED === 'true') {
    oauth = createOAuth({
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      redirectUri: env.OAUTH_REDIRECT_URI,
      redirectAllowlist: (env.OAUTH_REDIRECT_ALLOWLIST ?? '').split(','),
      streamerId: env.TWITCH_STREAMER_ID,
      botId: env.TWITCH_BOT_ID,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY,
      keeperIds,
      store,
      transport,
      production,
      now,
    });
    bot = createBot({
      oauth,
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      streamerId: env.TWITCH_STREAMER_ID,
      botId: env.TWITCH_BOT_ID,
      callbackUrl: env.EVENTSUB_CALLBACK_URL,
      webhookSecret: env.TWITCH_EVENTSUB_SECRET,
      transport,
    });
    if (production) bot.chatSubscription();
    subscriptions = createSubscriptionManager({
      oauth,
      bot,
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      streamerId: env.TWITCH_STREAMER_ID,
      transport,
    });
  } else if (production || env.OAUTH_ENABLED !== 'false')
    throw new Error('Select OAUTH_ENABLED explicitly; production requires OAuth configuration');
  const receiving = createReceiving({
    keepers: keeperNames,
    streamerId: env.TWITCH_STREAMER_ID,
    enabled: seekersEnabled && raidPilot,
    state,
    store,
    oauth,
    clientId: env.TWITCH_CLIENT_ID,
    botId: env.TWITCH_BOT_ID,
    transport: transport ?? httpTransport,
    now,
  });
  let overlayFeed;
  let overlayFeeds;
  if (env.TWITCH_STREAMER_ID) {
    if (
      production &&
      (!env.OVERLAY_ORIGIN ||
        new URL(env.OVERLAY_ORIGIN).origin !== env.OVERLAY_ORIGIN ||
        !env.OVERLAY_ORIGIN.startsWith('https://'))
    )
      throw new Error('Exact HTTPS overlay origin required');
    const hub = createOverlayHub(state, raidPilot ? keeperIds : [env.TWITCH_STREAMER_ID], {
      now,
      simulator,
      logins: keeperNames,
    });
    overlayFeeds = hub.feeds;
    overlayFeed = overlayFeeds[env.TWITCH_STREAMER_ID];
    state = hub.store;
  }
  const sendOff = oauth
    ? createSendOff({
        state,
        oauth,
        clientId: env.TWITCH_CLIENT_ID,
        streamerId: env.TWITCH_STREAMER_ID,
        transport,
        now,
      })
    : undefined;
  const shares = oauth
    ? createMarkShares({
        key: env.TOKEN_ENCRYPTION_KEY,
        channels: keeperIds,
        origin: new URL(env.OAUTH_REDIRECT_URI).origin,
        now,
      })
    : undefined;
  let replies;
  const bots = {};
  let pilot, claimAcks, scoreAcks, p7;
  const replySchedule = createBotReplyQueue();
  const sends = {};
  const subscriptionManagers = {};
  if (raidPilot) {
    for (const id of keeperIds) {
      const scoped = {
        accessToken: (role, options) =>
          role === 'streamer'
            ? oauth.accessTokenForKeeper(id, options)
            : oauth.accessToken(role, options),
      };
      const channelBot = createBot({
        oauth: scoped,
        clientId: env.TWITCH_CLIENT_ID,
        clientSecret: env.TWITCH_CLIENT_SECRET,
        streamerId: id,
        botId: env.TWITCH_BOT_ID,
        callbackUrl: env.EVENTSUB_CALLBACK_URL,
        webhookSecret: env.TWITCH_EVENTSUB_SECRET,
        transport,
      });
      bots[id] = channelBot;
      subscriptionManagers[id] = createSubscriptionManager({
        oauth: scoped,
        bot: channelBot,
        clientId: env.TWITCH_CLIENT_ID,
        clientSecret: env.TWITCH_CLIENT_SECRET,
        streamerId: id,
        transport,
      });
      sends[id] = createSendOff({
        state,
        oauth: scoped,
        clientId: env.TWITCH_CLIENT_ID,
        streamerId: id,
        transport,
        now,
        authorize: (source, target) => pilot.authorizeSend(source, target),
      });
    }
    scoreAcks = createClaimAcks({
      state: { claimAckStep: (...args) => state.scoreAckStep(...args) },
      bots,
      now,
      commandReplies: true,
      schedule: replySchedule,
    });
    p7 = createP7({
      flags: p7Flags,
      state,
      oauth,
      clientId: env.TWITCH_CLIENT_ID,
      clientSecret: env.TWITCH_CLIENT_SECRET,
      botId: env.TWITCH_BOT_ID,
      keeperIds,
      logins: keeperNames,
      transport: p7HTTP,
      now,
    });
    claimAcks = createClaimAcks({
      state,
      bots,
      now,
      schedule: replySchedule,
      ...(p7.enabled ? { p7 } : {}),
    });
    const chronicle = createChronicle({
      state,
      enabled: env.CHRONICLE_ENABLED === 'true',
      allowPaid: env.CHRONICLE_ALLOW_PAID === 'true',
      key: env.OPENAI_API_KEY,
      transport: chronicleHTTP,
      claimId: randomUUID,
    });
    const forge = createForge({
      state,
      enabled: env.CHRONICLE_ENABLED === 'true',
      allowPaid: env.CHRONICLE_ALLOW_PAID === 'true',
      key: env.OPENAI_API_KEY,
      transport: forgeHTTP,
      claimId: randomUUID,
      simulator,
    });
    replies = createShareReplies({ state, shares, bots, now });
    pilot = createPilot({
      keepers: keeperNames,
      receiving,
      p7,
      replies,
      forge,
      chronicle,
      state,
      store,
      oauth,
      subscriptions: subscriptionManagers,
      sends,
      now,
      simulator,
      clientId: env.TWITCH_CLIENT_ID,
      transport,
    });
    oauth.control.bindPilot(pilot);
  }
  const wanderService = createWander({
    keepers: keeperNames,
    policy: wander,
    key: env.TOKEN_ENCRYPTION_KEY,
    state,
    oauth,
    bots,
    botId: env.TWITCH_BOT_ID,
    clientId: env.TWITCH_CLIENT_ID,
    transport: transport ?? httpTransport,
    now,
  });
  return {
    ...createApp({
      keeperNames,
      wander: wanderService,
      receiving,
      previewReadOnly,
      scoreAcks,
      claimAcks,
      shares,
      replies,
      banAuthorized: async (host) => {
        const proof = (await store.getJob(host))?.banCapability;
        return proof?.scope === 'channel:moderate' && proof.expiresAt > now();
      },
      secret: env.TWITCH_EVENTSUB_SECRET,
      state,
      oauth,
      overlayFeed,
      overlayFeeds,
      raidPilot,
      now,
      releaseCommit: releaseCommit ?? undefined,
      chatContext: oauth
        ? { streamerId: env.TWITCH_STREAMER_ID, botId: env.TWITCH_BOT_ID, keeperIds }
        : undefined,
    }),
    claimAcks,
    receiving,
    wander: wanderService,
    p7,
    oauth,
    bot,
    store,
    subscriptions,
    sendOff,
    overlayFeed,
    overlayFeeds,
    pilot,
    shares,
    replies,
    subscriptionManagers,
    sends,
    overlayOrigins: production
      ? [env.OVERLAY_ORIGIN].filter(Boolean)
      : ['http://localhost:5191', 'http://127.0.0.1:5191'],
  };
}
