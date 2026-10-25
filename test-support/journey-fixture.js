// Explicit local simulator; never imported into production. No Twitch HTTP.
import { createServer } from 'node:http';
import { createFirestoreStore } from '../src/store.js';
import { createMemoryState } from '../src/state.js';
import { createOverlayFeed } from '../src/overlay-feed.js';
import { createApp } from '../src/app.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
export async function createJourneyFixture({ seed = true, firestoreClient } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Local simulator forbidden in production');
  const source = '1591805230', target = '333', bot = '222';
  const options = { lifecycle: { channels: [source, target] } };
  const memory = firestoreClient ? createFirestoreStore(firestoreClient, options) : createMemoryState(options);
  const feed = createOverlayFeed(memory, source, { simulator: true }); const state = feed.store;
  const app = createApp({ secret: 'synthetic-journey-test-secret', state, overlayFeed: feed, chatContext: { streamerId: source, keeperIds: [source, target], botId: bot } });
  let seq = 0;
  const event = async (data, time = Date.now()) => state.accept({ id: `sim-journey-${++seq}`, now: time, sentAt: time, expiresAt: time + 600000, ...data });
  const chat = (host, user, action, time) => event({ chat: { broadcasterId: host, chatterId: user, markAction: action } }, time);
  if (seed) {
    const time = Date.now() - 3000;
    for (const [host, id] of [[source, '9001'], [target, '9002']]) {
      await event({ lifecycle: { host, type: 'online', streamId: id, startedAt: time, sentAt: time } }, time);
      await chat(host, host, { type: 'keep' }, time);
    }
    for (const [i, text] of ['moon', '星', 'amber', '💎'].entries()) {
      await chat(source, String(9000 + i), { type: 'mark', text }, time);
      await chat(source, source, { type: 'approve', markId: `m${i + 1}` }, time);
    }
    await event({ raid: { from_broadcaster_user_id: source, to_broadcaster_user_id: target, viewers: 1 } }, time + 1);
    await chat(source, '8001', { type: 'offer' }, time + 1); await chat(target, '8002', { type: 'accept' }, time + 1);
    await event({ raid: { from_broadcaster_user_id: target, to_broadcaster_user_id: source, viewers: 4 } });
  }
  const server = createServer(app.handler); const sockets = attachOverlaySockets(server, feed, { origins: ['http://127.0.0.1:5191', 'http://localhost:5191'], allowRead: app.allowPublicRead });
  return { app, feed, memory, state, source, target, chat, event, server,
    async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); }); },
    async close() { sockets.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); },
  };
}
