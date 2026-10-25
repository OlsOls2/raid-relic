import { createApp } from './app.js';
import { createMemoryState } from './state.js';
import { createMemoryAuthStore, createFirestoreStore } from './store.js';
import { createOAuth } from './oauth.js';
import { createBot } from './bot.js';

export const PROJECT_ID = 'raid-relic-hackathon';
export async function createRuntime(env, { firestoreClient, transport, loadSDK = () => import('@google-cloud/firestore') } = {}) {
  const production = env.NODE_ENV === 'production';
  let state; let store;
  if (env.STATE_STORE === 'firestore') {
    if (env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID || env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore project configuration rejected');
    const db = firestoreClient ?? new (await loadSDK()).Firestore({ projectId: PROJECT_ID });
    state = store = createFirestoreStore(db);
  } else {
    if (production || env.STATE_STORE !== 'memory') throw new Error('Select STATE_STORE explicitly; production requires Firestore');
    state = createMemoryState(); store = createMemoryAuthStore();
  }
  if (!env.TWITCH_EVENTSUB_SECRET || env.TWITCH_EVENTSUB_SECRET.length < 10 || env.TWITCH_EVENTSUB_SECRET.length > 100) throw new Error('Webhook secret required');
  let oauth; let bot;
  if (env.OAUTH_ENABLED === 'true') {
    oauth = createOAuth({ clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET, redirectUri: env.OAUTH_REDIRECT_URI,
      redirectAllowlist: (env.OAUTH_REDIRECT_ALLOWLIST ?? '').split(','), streamerId: env.TWITCH_STREAMER_ID, botId: env.TWITCH_BOT_ID,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY, store, transport, production });
    bot = createBot({ oauth, clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET, streamerId: env.TWITCH_STREAMER_ID,
      botId: env.TWITCH_BOT_ID, callbackUrl: env.EVENTSUB_CALLBACK_URL, webhookSecret: env.TWITCH_EVENTSUB_SECRET, transport });
    if (production) bot.chatSubscription();
  } else if (production || env.OAUTH_ENABLED !== 'false') throw new Error('Select OAUTH_ENABLED explicitly; production requires OAuth configuration');
  return { ...createApp({ secret: env.TWITCH_EVENTSUB_SECRET, state, oauth,
    chatContext: oauth ? { streamerId: env.TWITCH_STREAMER_ID, botId: env.TWITCH_BOT_ID } : undefined }), oauth, bot, store };
}
