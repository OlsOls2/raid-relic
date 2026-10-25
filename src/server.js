import { createServer } from 'node:http';
import { createRuntime } from './runtime.js';
import { attachOverlaySockets } from './overlay-sockets.js';

const port = Number(process.env.PORT ?? 5191);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const runtime = await createRuntime(process.env);
const server = createServer(runtime.handler);
const sockets = runtime.overlayFeed ? attachOverlaySockets(server, runtime.overlayFeeds ?? runtime.overlayFeed, { origins: runtime.overlayOrigins, allowRead: runtime.allowPublicRead }) : null;
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { sockets?.close(); server.close(); });
