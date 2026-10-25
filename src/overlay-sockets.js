import { WebSocketServer, WebSocket } from 'ws';

export function attachOverlaySockets(server, feed, { origins, maxClients = 16, heartbeatMs = 15000, allowRead = () => true } = {}) {
  if (!Array.isArray(origins) || !origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Exact overlay origins required');
  const feeds = feed.channel ? { [feed.channel]: feed } : feed;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const upgrade = (req, socket, head) => {
    const channel = /^\/ws\/(\d{1,32})$/.exec(req.url)?.[1];
    const selected = feeds[channel];
    if (!selected || !origins.includes(req.headers.origin) || req.headers['sec-websocket-protocol'] || wss.clients.size >= maxClients) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    if (!allowRead()) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, selected));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', (ws, selected) => {
    ws.alive = true; let lastRevision = -1;
    const send = snapshot => {
      if (ws.readyState !== WebSocket.OPEN || snapshot.revision <= lastRevision) return;
      const data = JSON.stringify(snapshot);
      if (Buffer.byteLength(data) > 131072 || ws.bufferedAmount > 262144) { ws.terminate(); return; }
      lastRevision = snapshot.revision; ws.send(data);
    };
    const unsubscribe = selected.subscribe(send);
    ws.on('close', unsubscribe);
    ws.on('error', () => {});
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', () => ws.close(1008, 'Read-only connection'));
    selected.snapshot().then(send).catch(() => ws.terminate());
  });
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"heartbeat"}');
    }
  }, heartbeatMs);
  timer.unref();
  return { clients: wss.clients, close() {
    clearInterval(timer); server.off('upgrade', upgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  } };
}
