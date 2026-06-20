const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50; // 20 Hz

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const players = new Map(); // id -> { ws, x, y, z, ry, color }
let nextId = 1;

// --- Static file server ---
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [id, p] of players) {
    if (id !== excludeId && p.ws.readyState === 1) p.ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  const id = String(nextId++);
  const color = COLORS[(nextId - 2) % COLORS.length];
  const spawn = { x: (Math.random() - 0.5) * 20, y: 0, z: (Math.random() - 0.5) * 20, ry: 0 };

  players.set(id, { ws, ...spawn, color });

  // Init: send this player their id, color, spawn pos, and all current players
  const others = {};
  for (const [pid, p] of players) {
    if (pid !== id) others[pid] = { x: p.x, y: p.y, z: p.z, ry: p.ry, color: p.color };
  }
  send(ws, { type: 'init', id, color, ...spawn, players: others });

  // Notify others
  broadcast({ type: 'join', id, color, ...spawn }, id);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'move') {
        const p = players.get(id);
        if (!p) return;
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.ry = msg.ry;
      }
    } catch {}
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
    console.log(`Player ${id} left. Online: ${players.size}`);
  });

  console.log(`Player ${id} joined. Online: ${players.size}`);
});

// --- State broadcast at 20 Hz ---
setInterval(() => {
  if (players.size === 0) return;
  const state = {};
  for (const [id, p] of players) state[id] = { x: p.x, y: p.y, z: p.z, ry: p.ry };
  const msg = JSON.stringify({ type: 'state', players: state });
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
