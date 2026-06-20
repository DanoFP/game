const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50; // 20 Hz

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const rooms = new Map(); // roomId -> Map<playerId, player>
let nextId = 1;

// ── Static file server ───────────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]; // strip query string
  const filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function roomSnapshot(room) {
  const out = {};
  for (const [id, p] of room) {
    out[id] = { name: p.name, color: p.color, inGame: p.inGame };
  }
  return out;
}

function broadcastRoomUpdate(room) {
  const msg = JSON.stringify({ type: 'room_update', players: roomSnapshot(room) });
  for (const p of room.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function broadcastGame(room, data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [id, p] of room) {
    if (id !== excludeId && p.inGame && p.ws.readyState === 1) p.ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const roomId = params.get('room');
  const name = (params.get('name') || 'Player').slice(0, 16).trim() || 'Player';

  if (!roomId) { ws.close(1008, 'Missing room'); return; }

  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  const room = rooms.get(roomId);

  const id = String(nextId++);
  const color = COLORS[(nextId - 2) % COLORS.length];

  room.set(id, { ws, name, color, inGame: false, x: 0, y: 0, z: 0, ry: 0 });

  // Send initial room state to the new player
  send(ws, { type: 'room_state', id, color, players: roomSnapshot(room) });

  // Notify everyone
  broadcastRoomUpdate(room);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const p = room.get(id);
      if (!p) return;

      if (msg.type === 'enter_game') {
        p.inGame = true;
        p.x = (Math.random() - 0.5) * 20;
        p.y = 0;
        p.z = (Math.random() - 0.5) * 20;
        p.ry = 0;

        // Send game init to this player (all currently in-game players)
        const others = {};
        for (const [pid, op] of room) {
          if (pid !== id && op.inGame) {
            others[pid] = { name: op.name, color: op.color, x: op.x, y: op.y, z: op.z, ry: op.ry };
          }
        }
        send(ws, { type: 'game_init', id, color, name, x: p.x, y: p.y, z: p.z, players: others });

        // Announce to other in-game players
        broadcastGame(room, { type: 'join', id, name, color, x: p.x, y: p.y, z: p.z }, id);

        // Update lobby for everyone (shows in-game status)
        broadcastRoomUpdate(room);

      } else if (msg.type === 'move') {
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.ry = msg.ry;
      }
    } catch {}
  });

  ws.on('close', () => {
    const p = room.get(id);
    room.delete(id);

    if (room.size === 0) {
      rooms.delete(roomId);
    } else {
      if (p && p.inGame) broadcastGame(room, { type: 'leave', id });
      broadcastRoomUpdate(room);
    }

    console.log(`[${roomId}] ${name}(${id}) left. Size: ${room.size}`);
  });

  console.log(`[${roomId}] ${name}(${id}) joined. Size: ${room.size}`);
});

// ── State broadcast at 20 Hz (in-game players only) ──────────────────────────
setInterval(() => {
  for (const room of rooms.values()) {
    const inGame = [...room.entries()].filter(([, p]) => p.inGame);
    if (inGame.length === 0) continue;

    const state = {};
    for (const [id, p] of inGame) state[id] = { x: p.x, y: p.y, z: p.z, ry: p.ry };
    const msg = JSON.stringify({ type: 'state', players: state });

    for (const [, p] of inGame) {
      if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
