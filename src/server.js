import { createServer } from 'node:http';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 5191);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createServer(createApp({ secret: process.env.TWITCH_EVENTSUB_SECRET }).handler);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0');
