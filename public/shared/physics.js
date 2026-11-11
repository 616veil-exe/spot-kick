// Deterministic ball physics, shared by server (authority) and clients (visuals).
// Units: metres / seconds. Ball starts on the penalty spot (0,R,0), goal line at z = -11.
export const R = 0.11, PR = 0.06, HALF = 3.66, BAR = 2.44;
export const GOAL_Z = -11, KEEPER_Z = -10.85, NET_BACK = -13;
export const ZONES = [
  { x: -2.7, y: 1.9 }, { x: 0, y: 1.9 }, { x: 2.7, y: 1.9 },
  { x: -2.7, y: 0.75 }, { x: 0, y: 0.95 }, { x: 2.7, y: 0.75 },
];
export const KEEPER_START = { x: 0, y: 0.95 };
export const KEEPER_REACH = { rx: 0.95, ry: 0.85 };
export const DIVE_TIME = 0.5, REACT = 0.1;

const G = 9.81, KD = 0.5 * 1.2 * 0.25 * Math.PI * R * R / 0.43, MAG = 0.006, SPIN = 70;

export const errSigma = (power) => 0.08 + 0.40 * power * power * power;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function keeperPos(zone, t) {
  const z = ZONES[zone];
  let p = (t - REACT) / DIVE_TIME;
  p = p < 0 ? 0 : p > 1 ? 1 : p;
  const e = 1 - (1 - p) * (1 - p);
  return { x: KEEPER_START.x + (z.x - KEEPER_START.x) * e, y: KEEPER_START.y + (z.y - KEEPER_START.y) * e, p };
}

function airStep(s, dt) {
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz), k = KD * sp;
  s.vx += (-k * s.vx + MAG * s.wy * s.vz) * dt;
  s.vy += (-G - k * s.vy) * dt;
  s.vz += (-k * s.vz - MAG * s.wy * s.vx) * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  s.wy -= s.wy * 0.1 * dt;
}

function launchVel(ax, ay, speed) {
  const dx = ax, dy = ay - R, dz = GOAL_Z, l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return [dx / l * speed, dy / l * speed, dz / l * speed];
}

function flight(v, curve, record) {
  const s = { x: 0, y: R, z: 0, vx: v[0], vy: v[1], vz: v[2], wy: -curve * SPIN };
  const dt = 1 / 240, pts = record ? [0, R, 0] : null;
  let t = 0;
  for (let i = 0; i < 2400; i++) {
    const px = s.x, py = s.y, pz = s.z;
    airStep(s, dt); t += dt;
    if (pts && i % 6 === 0) pts.push(s.x, s.y, s.z);
    if (s.z <= GOAL_Z) {
      const f = (pz - GOAL_Z) / (pz - s.z);
      const x = px + (s.x - px) * f, y = py + (s.y - py) * f;
      if (pts) pts.push(x, y, GOAL_Z);
      return { x, y, t, pts };
    }
  }
  return { x: s.x, y: s.y, t, pts };
}

// Finds the launch velocity so the ball (with drag, gravity and curve) arrives at (tx,ty) on the goal line.
export function solveLaunch(tx, ty, speed, curve) {
  let ax = tx, ay = ty, v = launchVel(ax, ay, speed);
  for (let i = 0; i < 10; i++) {
    const h = flight(v, curve, false), ex = h.x - tx, ey = h.y - ty;
    if (Math.abs(ex) < 0.004 && Math.abs(ey) < 0.004) break;
    ax -= ex; ay -= ey; v = launchVel(ax, ay, speed);
  }
  return v;
}

export function previewPath(tx, ty, speed, curve) {
  return flight(solveLaunch(tx, ty, speed, curve), curve, true).pts;
}

function bounceN(s, nx, ny, nz, e) {
  const vn = s.vx * nx + s.vy * ny + s.vz * nz;
  if (vn < 0) { const j = (1 + e) * vn; s.vx -= j * nx; s.vy -= j * ny; s.vz -= j * nz; }
}

// p = { tx, ty, speed, curve, zone, seed }
export function simulate(p) {
  const rng = mulberry32(p.seed | 0);
  const v = solveLaunch(p.tx, p.ty, p.speed, p.curve);
  const s = { x: 0, y: R, z: 0, vx: v[0], vy: v[1], vz: v[2], wy: -p.curve * SPIN };
  const dt = 1 / 240, frames = [0, R, 0], events = [];
  const lim = R + PR;
  let t = 0, touched = null, tTouch = null, outcome = null, tDecide = null;
  let keeperDone = false, inNet = false, decided = false, netHit = false, rest = 0;

  for (let i = 0; i < 240 * 6; i++) {
    const pz = s.z;
    airStep(s, dt); t += dt;

    if (s.y < R) {
      s.y = R;
      if (s.vy < 0) {
        const imp = -s.vy;
        if (imp > 1) { s.vy = imp * 0.62; s.vx *= 0.92; s.vz *= 0.92; } else s.vy = 0;
      }
    }
    if (s.y <= R + 0.0005) { const f = 1 - 1.6 * dt; s.vx *= f; s.vz *= f; }

    if (!inNet && !decided) {
      for (const sx of [-HALF, HALF]) {
        const dx = s.x - sx, dz = s.z - GOAL_Z, d2 = dx * dx + dz * dz;
        if (d2 < lim * lim && s.y < BAR + 0.02) {
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, nz = dz / d;
          s.x = sx + nx * lim; s.z = GOAL_Z + nz * lim;
          bounceN(s, nx, 0, nz, 0.55);
          if (!touched) { touched = 'post'; tTouch = t; }
          events.push({ t, type: 'post' });
        }
      }
      const dy = s.y - BAR, dz = s.z - GOAL_Z, d2 = dy * dy + dz * dz;
      if (Math.abs(s.x) < HALF && d2 < lim * lim) {
        const d = Math.sqrt(d2) || 1e-6, ny = dy / d, nz = dz / d;
        s.y = BAR + ny * lim; s.z = GOAL_Z + nz * lim;
        bounceN(s, 0, ny, nz, 0.55);
        if (!touched) { touched = 'bar'; tTouch = t; }
        events.push({ t, type: 'post' });
      }
    }

    if (!keeperDone && pz > KEEPER_Z && s.z <= KEEPER_Z) {
      keeperDone = true;
      const kp = keeperPos(p.zone, t);
      const dx = (s.x - kp.x) / KEEPER_REACH.rx, dy = (s.y - kp.y) / KEEPER_REACH.ry;
      if (dx * dx + dy * dy <= 1 && !decided) {
        s.vz = Math.abs(s.vz) * 0.3;
        s.vx = (s.x - kp.x) * 2.5 + (rng() - 0.5) * 3;
        s.vy = 1.5 + rng() * 2.5;
        outcome = 'save'; tDecide = t; decided = true;
        events.push({ t, type: 'save' });
      }
    }

    if (!decided && s.z <= GOAL_Z - R) {
      decided = true; tDecide = t;
      if (Math.abs(s.x) < HALF && s.y < BAR) { outcome = 'goal'; inNet = true; events.push({ t, type: 'goal' }); }
      else outcome = touched || 'miss';
    }

    if (inNet) {
      const dmp = 1 - 4 * dt;
      s.vx *= dmp; s.vy *= dmp; s.vz *= dmp;
      if (s.z < NET_BACK + R) {
        s.z = NET_BACK + R;
        if (s.vz < 0) {
          if (!netHit) { netHit = true; events.push({ t, type: 'net', x: s.x, y: s.y, amp: Math.min(0.6, Math.max(0.12, -s.vz * 0.035)) }); }
          s.vz = -s.vz * 0.08;
        }
      }
      if (s.x > HALF - R) { s.x = HALF - R; s.vx = -s.vx * 0.1; }
      if (s.x < -HALF + R) { s.x = -HALF + R; s.vx = -s.vx * 0.1; }
      if (s.y > BAR - R) { s.y = BAR - R; s.vy = -s.vy * 0.1; }
      if (s.z > GOAL_Z - R) { s.z = GOAL_Z - R; s.vz = -Math.abs(s.vz) * 0.1; }
    }

    if (i % 4 === 3) frames.push(s.x, s.y, s.z);

    const sp2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    if (sp2 < 0.04 && s.y < R + 0.01) { rest += dt; if (rest > 0.5) break; } else rest = 0;
    if (s.z > 25 || s.z < -30) break;
  }
  if (!outcome) {
    outcome = touched || 'miss';
    tDecide = tTouch != null ? tTouch + 0.5 : t;
  }
  if (outcome !== 'goal' && outcome !== 'save' && tDecide < 0.5) tDecide = 0.5;
  return { frames: new Float32Array(frames), outcome, tDecide, events, tEnd: t };
}
