/**
 * Entry point: a tiny static file server for the client plus a WebSocket
 * endpoint (/ws) for real-time play. No framework needed.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { RoomManager } from './rooms/RoomManager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = {
  '/shared/': path.join(ROOT, 'shared'),
  '/': path.join(ROOT, 'public'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const manager = new RoomManager();

/** Resolve a URL path to a file inside one of the static roots (no traversal). */
function resolveStatic(urlPath) {
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(prefix.length)) || 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...manager.stats() }));
  }

  let file = resolveStatic(url.pathname);
  try {
    if (!file) throw new Error('bad path');
    const info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) file = path.join(ROOT, 'public', 'index.html'); // SPA fallback
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayloadBytes });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => manager.handleMessage(ws, data.toString()));
  ws.on('close', () => manager.onDisconnect(ws));
  ws.on('error', () => {});
});

// Heartbeat: terminate dead sockets so presence stays accurate.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, config.heartbeatMs);
wss.on('close', () => clearInterval(heartbeat));

server.listen(config.port, config.host, () => {
  console.log(`🎲 Ludo Royale running at http://localhost:${config.port}`);
});
