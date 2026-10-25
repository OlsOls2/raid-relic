import { createApp } from './app.js';
import { createMemoryState } from './state.js';
import { createMemoryAuthStore, createFirestoreStore } from './store.js';
import { createOAuth } from './oauth.js';
import { createBot } from './bot.js';
import { createOverlayFeed } from './overlay-feed.js';
import { validateReleaseCommit } from './release.js';
import { createSubscriptionManager } from './subscriptions.js';
import { createSendOff } from './send-off.js';

export const PROJECT_ID = 'raid-relic-hackathon';
export async function createRuntime(env, { firestoreClient, transport, loadSDK = () => import('@google-cloud/firestore') } = {}) {
  const production = env.NODE_ENV === 'production';
  const releaseCommit = validateReleaseCommit(env.RELEASE_COMMIT, { required: production });
  let state; let store;
  const keeperIds = env.KEEPER_CHANNEL_IDS ? env.KEEPER_CHANNEL_IDS.split(',') : [env.TWITCH_STREAMER_ID];
  const lifecycle = env.OAUTH_ENABLED === 'true' ? { channels: keeperIds } : undefined;
  if (env.STATE_STORE === 'firestore') {
    if (env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID || env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore project configuration rejected');
    const db = firestoreClient ?? new (await loadSDK()).Firestore({ projectId: PROJECT_ID });
    state = store = createFirestoreStore(db, { lifecycle });
  } else {
    if (production || env.STATE_STORE !== 'memory') throw new Error('Select STATE_STORE explicitly; production requires Firestore');
    state = createMemoryState({ lifecycle }); store = createMemoryAuthStore();
  }
  if (!env.TWITCH_EVENTSUB_SECRET || env.TWITCH_EVENTSUB_SECRET.length < 10 || env.TWITCH_EVENTSUB_SECRET.length > 100) throw new Error('Webhook secret required');
  let oauth; let bot; let subscriptions;
  if (env.OAUTH_ENABLED === 'true') {
    oauth = createOAuth({ clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET, redirectUri: env.OAUTH_REDIRECT_URI,
      redirectAllowlist: (env.OAUTH_REDIRECT_ALLOWLIST ?? '').split(','), streamerId: env.TWITCH_STREAMER_ID, botId: env.TWITCH_BOT_ID,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY, store, transport, production });
    bot = createBot({ oauth, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET, streamerId: env.TWITCH_STREAMER_ID,
      botId: env.TWITCH_BOT_ID, callbackUrl: env.EVENTSUB_CALLBACK_URL, webhookSecret: env.TWITCH_EVENTSUB_SECRET, transport });
    if (production) bot.chatSubscription();
    subscriptions = createSubscriptionManager({ oauth, bot, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET,
      streamerId: env.TWITCH_STREAMER_ID, transport });
  } else if (production || env.OAUTH_ENABLED !== 'false') throw new Error('Select OAUTH_ENABLED explicitly; production requires OAuth configuration');
  let overlayFeed;
  if (env.TWITCH_STREAMER_ID) {
    if (production && (!env.OVERLAY_ORIGIN || new URL(env.OVERLAY_ORIGIN).origin !== env.OVERLAY_ORIGIN || !env.OVERLAY_ORIGIN.startsWith('https://'))) throw new Error('Exact HTTPS overlay origin required');
    overlayFeed = createOverlayFeed(state, env.TWITCH_STREAMER_ID); state = overlayFeed.store;
  }
  const sendOff = oauth ? createSendOff({ state, oauth, clientId: env.TWITCH_CLIENT_ID, streamerId: env.TWITCH_STREAMER_ID, transport }) : undefined;
  return { ...createApp({ secret: env.TWITCH_EVENTSUB_SECRET, state, oauth, overlayFeed, releaseCommit: releaseCommit ?? undefined,
    chatContext: oauth ? { streamerId: env.TWITCH_STREAMER_ID, botId: env.TWITCH_BOT_ID, keeperIds } : undefined }), oauth, bot, store, subscriptions, sendOff, overlayFeed,
    overlayOrigins: production ? [env.OVERLAY_ORIGIN].filter(Boolean) : ['http://localhost:5191', 'http://127.0.0.1:5191'] };
}
