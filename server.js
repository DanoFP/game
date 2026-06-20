const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TICK_MS = 50; // 20 Hz
const VALID_MAPS = ['field', 'city', 'spaceship'];

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
// rooms: roomId -> { players: Map<id, player>, map: string }
const rooms = new Map();
let nextId = 1;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { players: new Map(), map: 'field' });
  return rooms.get(roomId);
}

function roomSnapshot(room) {
  const out = {};
  for (const [id, p] of room.players) {
    out[id] = { name: p.name, color: p.color, inGame: p.inGame };
  }
  return out;
}

function broadcastRoomUpdate(room) {
  const msg = JSON.stringify({ type: 'room_update', map: room.map, players: roomSnapshot(room) });
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function broadcastGame(room, data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [id, p] of room.players) {
    if (id !== excludeId && p.inGame && p.ws.readyState === 1) p.ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const roomId = params.get('room');
  const name = (params.get('name') || 'Player').slice(0, 16).trim() || 'Player';

  if (!roomId) { ws.close(1008, 'Missing room'); return; }

  const room = getRoom(roomId);
  const { players } = room;

  const id = String(nextId++);
  const color = COLORS[(nextId - 2) % COLORS.length];

  players.set(id, { ws, name, color, inGame: false, x: 0, y: 0, z: 0, ry: 0 });

  send(ws, { type: 'room_state', id, color, map: room.map, players: roomSnapshot(room) });
  broadcastRoomUpdate(room);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const p = players.get(id);
      if (!p) return;

      if (msg.type === 'set_map') {
        if (VALID_MAPS.includes(msg.map)) {
          room.map = msg.map;
          broadcastRoomUpdate(room);
        }

      } else if (msg.type === 'enter_game') {
        // Client sends its confirmed map selection — apply it before building game_init
        if (msg.map && VALID_MAPS.includes(msg.map)) room.map = msg.map;
        p.inGame = true;
        p.x = (Math.random() - 0.5) * 20;
        p.y = 0;
        p.z = (Math.random() - 0.5) * 20;
        p.ry = 0;

        const others = {};
        for (const [pid, op] of players) {
          if (pid !== id && op.inGame) {
            others[pid] = { name: op.name, color: op.color, x: op.x, y: op.y, z: op.z, ry: op.ry };
          }
        }
        send(ws, { type: 'game_init', id, color, name, map: room.map, x: p.x, y: p.y, z: p.z, players: others });

        broadcastGame(room, { type: 'join', id, name, color, x: p.x, y: p.y, z: p.z }, id);
        broadcastRoomUpdate(room);

      } else if (msg.type === 'move') {
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.ry = msg.ry;
      }
    } catch {}
  });

  ws.on('close', () => {
    const p = players.get(id);
    players.delete(id);

    if (players.size === 0) {
      rooms.delete(roomId);
    } else {
      if (p && p.inGame) broadcastGame(room, { type: 'leave', id });
      broadcastRoomUpdate(room);
    }
    console.log(`[${roomId}] ${name}(${id}) left. Size: ${players.size}`);
  });

  console.log(`[${roomId}] ${name}(${id}) joined. Size: ${players.size}`);
});

// State broadcast at 20 Hz
setInterval(() => {
  for (const room of rooms.values()) {
    const inGame = [...room.players.entries()].filter(([, p]) => p.inGame);
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
