import { createServer } from 'node:http';
import { createMemoryState } from '../src/state.js';
import { createOverlayFeed } from '../src/overlay-feed.js';
import { createApp } from '../src/app.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';

export async function createOverlayFixture({ seed = false, socketOptions = {} } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Local simulator forbidden in production');
  const memory = createMemoryState();
  const feed = createOverlayFeed(memory, '111', { simulator: true });
  const app = createApp({ secret: 'synthetic-overlay-test-secret', state: feed.store, overlayFeed: feed,
    chatContext: { streamerId: '111', botId: '222' } });
  const admin = { broadcasterId: '111', chatterId: '111' };
  if (seed) {
    await app.marks.setKeeperContext('111', { streamId: 'local-simulator-session', keeperId: '111', optedIn: true, holdsRelic: true, blockedUserIds: [] });
    for (const [i, text] of ['moon', 'amber', '星', 'crystal', 'archive', '💎', 'ember', 'orbit'].entries()) {
      await feed.store.accept({ id: `simulator-${i}`, now: Date.now(), expiresAt: Date.now() + 600000,
        chat: { broadcasterId: '111', chatterId: String(90000 + i), markAction: { type: 'mark', text } } });
      await app.marks.approve('111', admin, `m${i + 1}`);
    }
  }
  const server = createServer(app.handler);
  const sockets = attachOverlaySockets(server, feed, { origins: ['http://127.0.0.1:5191', 'http://localhost:5191'], ...socketOptions });
  return { app, memory, feed, admin, server, sockets,
    async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); }); },
    async close() { sockets.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); },
  };
}
