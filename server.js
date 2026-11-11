import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { simulate, errSigma, mulberry32 } from './public/shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.get('/healthz', (_q, r) => r.send('ok'));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const PICK_MS = 15000, ANIM_MS = 7500;
const rooms = new Map();

const clamp = (v, a, b, d = a) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = (rng) => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
const token = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0]; } while (rooms.has(c));
  return c;
}

function makeRoom() {
  const r = {
    code: newCode(), players: [null, null], phase: 'lobby', first: Math.random() < 0.5 ? 0 : 1,
    k: [0, 0], s: [0, 0], hist: [[], []], picks: { aim: null, dive: null },
    timer: null, deadline: 0, winner: -1, rematch: [false, false], touched: Date.now(),
  };
  rooms.set(r.code, r);
  return r;
}

const kickerOf = (r) => ((r.k[0] + r.k[1]) % 2 === 0 ? r.first : 1 - r.first);

function checkWinner(r) {
  const [a, b] = r.k, [sa, sb] = r.s;
  if (a <= 5 && b <= 5) {
    if (sa > sb + (5 - b)) return 0;
    if (sb > sa + (5 - a)) return 1;
    return -1;
  }
  if (a === b && sa !== sb) return sa > sb ? 0 : 1;
  return -1;
}

function snapshot(r, idx) {
  const ki = kickerOf(r);
  return {
    code: r.code, phase: r.phase, you: idx,
    names: r.players.map((p) => (p ? p.name : null)),
    connected: r.players.map((p) => !!(p && p.connected)),
    scores: r.s, hist: r.hist, kicker: ki, kicksTaken: r.k,
    shotNo: Math.floor((r.k[0] + r.k[1]) / 2) + 1,
    sudden: r.k[0] >= 5 && r.k[1] >= 5,
    left: r.phase === 'pick' ? Math.max(0, r.deadline - Date.now()) : 0,
    locked: r.phase === 'pick' ? (idx === ki ? !!r.picks.aim : r.picks.dive != null) : false,
    winner: r.winner, rematch: r.rematch,
  };
}

function emitState(r) {
  r.players.forEach((p, i) => { if (p && p.sid) io.to(p.sid).emit('state', snapshot(r, i)); });
}

function startRound(r) {
  r.phase = 'pick';
  r.picks = { aim: null, dive: null };
  r.deadline = Date.now() + PICK_MS;
  clearTimeout(r.timer);
  r.timer = setTimeout(() => resolve(r), PICK_MS + 250);
  emitState(r);
}

function resolve(r) {
  if (r.phase !== 'pick') return;
  clearTimeout(r.timer);
  const ki = kickerOf(r), a = r.picks.aim;
  const power = a ? a.power : 0.55, curve = a ? a.curve : 0;
  let tx = a ? a.tx : rnd(-2.8, 2.8), ty = a ? a.ty : rnd(0.4, 2.0);
  const seed = (Math.random() * 2147483647) | 0, rng = mulberry32(seed ^ 0x9e3779b9);
  const sg = errSigma(power);
  tx = clamp(tx + gauss(rng) * sg, -5.5, 5.5);
  ty = clamp(ty + gauss(rng) * sg * 0.8, 0.12, 3.6);
  const zone = r.picks.dive != null ? r.picks.dive : Math.floor(Math.random() * 6);
  const params = { tx, ty, speed: 17 + 15 * power, curve, zone, seed };
  const sim = simulate(params);

  r.k[ki]++;
  if (sim.outcome === 'goal') r.s[ki]++;
  r.hist[ki].push(sim.outcome === 'goal' ? 'G' : 'X');
  r.winner = checkWinner(r);
  r.phase = 'anim';
  r.players.forEach((p, i) => {
    if (p && p.sid) io.to(p.sid).emit('shot', { kicker: ki, params, outcome: sim.outcome, snap: snapshot(r, i) });
  });
  r.timer = setTimeout(() => {
    if (r.winner >= 0) { r.phase = 'over'; r.rematch = [false, false]; emitState(r); }
    else startRound(r);
  }, ANIM_MS);
}

function destroyRoom(r, msg) {
  clearTimeout(r.timer);
  r.players.forEach((p) => { if (p && p.sid) io.to(p.sid).emit('closed', msg); });
  rooms.delete(r.code);
}

io.on('connection', (socket) => {
  const ctx = () => {
    const r = rooms.get(socket.data.code);
    return r ? { r, i: socket.data.idx } : null;
  };
  const attach = (r, i) => {
    socket.data.code = r.code; socket.data.idx = i;
    r.players[i].sid = socket.id; r.players[i].connected = true; r.players[i].dcAt = 0;
    socket.join(r.code); r.touched = Date.now();
  };

  socket.on('create', ({ name } = {}, ack) => {
    const r = makeRoom();
    r.players[0] = { name: String(name || 'Player 1').slice(0, 14), token: token(), sid: null, connected: false };
    attach(r, 0);
    ack?.({ ok: true, code: r.code, token: r.players[0].token, idx: 0 });
    emitState(r);
  });

  socket.on('join', ({ code, name } = {}, ack) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return ack?.({ ok: false, error: 'Room not found. Check the code.' });
    if (r.players[1]) return ack?.({ ok: false, error: 'This room is already full.' });
    r.players[1] = { name: String(name || 'Player 2').slice(0, 14), token: token(), sid: null, connected: false };
    attach(r, 1);
    ack?.({ ok: true, code: r.code, token: r.players[1].token, idx: 1 });
    startRound(r);
  });

  socket.on('rejoin', ({ code, token: tk } = {}, ack) => {
    const r = rooms.get(String(code || '').toUpperCase());
    const i = r ? r.players.findIndex((p) => p && p.token === tk) : -1;
    if (i < 0) return ack?.({ ok: false });
    attach(r, i);
    ack?.({ ok: true, code: r.code, idx: i });
    emitState(r);
  });

  socket.on('aim', (d = {}, ack) => {
    const c = ctx(); if (!c || c.r.phase !== 'pick' || c.i !== kickerOf(c.r) || c.r.picks.aim) return;
    c.r.picks.aim = {
      tx: clamp(d.tx, -4.8, 4.8, 0), ty: clamp(d.ty, 0.15, 3.5, 1.2),
      power: clamp(d.power, 0, 1, 0.5), curve: clamp(d.curve, -1, 1, 0),
    };
    ack?.({ ok: true });
    if (c.r.picks.dive != null) resolve(c.r); else emitState(c.r);
  });

  socket.on('dive', (d = {}, ack) => {
    const c = ctx(); if (!c || c.r.phase !== 'pick' || c.i === kickerOf(c.r) || c.r.picks.dive != null) return;
    const z = Math.floor(+d.zone);
    if (!(z >= 0 && z <= 5)) return;
    c.r.picks.dive = z;
    ack?.({ ok: true });
    if (c.r.picks.aim) resolve(c.r); else emitState(c.r);
  });

  socket.on('rematch', () => {
    const c = ctx(); if (!c || c.r.phase !== 'over') return;
    c.r.rematch[c.i] = true;
    if (c.r.rematch[0] && c.r.rematch[1]) {
      Object.assign(c.r, { k: [0, 0], s: [0, 0], hist: [[], []], winner: -1, first: 1 - c.r.first, rematch: [false, false] });
      startRound(c.r);
    } else emitState(c.r);
  });

  socket.on('leave', () => {
    const c = ctx(); if (!c) return;
    destroyRoom(c.r, 'Your opponent left the room.');
  });

  socket.on('disconnect', () => {
    const c = ctx(); if (!c) return;
    const p = c.r.players[c.i];
    if (p && p.sid === socket.id) { p.connected = false; p.dcAt = Date.now(); emitState(c.r); }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const gone = r.players.filter((p) => p && !p.connected);
    const stale = gone.some((p) => p.dcAt && now - p.dcAt > 90000);
    if (stale || now - r.touched > 3 * 3600 * 1000) destroyRoom(r, 'Room closed: a player disconnected.');
  }
}, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Spot Kick running on :${PORT}`));
