import * as THREE from 'three';
import { simulate, previewPath, keeperPos, errSigma, ZONES, R, GOAL_Z, HALF, BAR, NET_BACK, DIVE_TIME, REACT } from './shared/physics.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const KICK_T = 0.84;

/* ---------------- renderer / scene ---------------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let quality = localStorage.getItem('sk-q') || 'high';
const scene = new THREE.Scene();
const FOG = 0xe3b27c;
scene.fog = new THREE.Fog(FOG, 40, 150);
{
  const c = document.createElement('canvas'); c.width = 2; c.height = 512;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#1e3560'); gr.addColorStop(0.42, '#e3b27c'); gr.addColorStop(1, '#e3b27c');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 512);
  scene.background = new THREE.CanvasTexture(c);
}
const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
const camPos = new THREE.Vector3(0, 1.9, 4.6), camLook = new THREE.Vector3(0, 1, GOAL_Z);
let lookBase = { y: 1.0 };

scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3b6b45, 1.05));
const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
sun.position.set(6, 12, 8);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -14;
sun.shadow.camera.far = 40; sun.shadow.bias = -0.0004;
sun.target.position.set(0, 0, -4);
scene.add(sun, sun.target);

function applyQuality() {
  const hi = quality === 'high';
  renderer.setPixelRatio(hi ? Math.min(devicePixelRatio, 2) : 1);
  renderer.shadowMap.enabled = hi;
  sun.castShadow = hi;
  sun.shadow.mapSize.set(1024, 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  $('btnQ').textContent = 'Graphics: ' + quality;
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  cam.aspect = a;
  const hf = (40 * Math.PI) / 180;
  cam.fov = clamp((2 * Math.atan(Math.tan(hf / 2) / a) * 180) / Math.PI, 34, 72);
  cam.updateProjectionMatrix();
  const portrait = a < 0.9;
  camPos.y = portrait ? 2.3 : 1.9;
  lookBase.y = portrait ? 0.2 : 1.0;
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));

/* ---------------- textures ---------------- */
function pitchTexture() {
  const W = 2048, H = 1707, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), s = W / 60, X = (x) => (x + 30) * s, Z = (z) => (z + 18) * s;
  for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#2f8a4b' : '#369453'; g.fillRect(0, (i * H) / 10, W, H / 10 + 1); }
  g.strokeStyle = '#f4f1e6'; g.fillStyle = '#f4f1e6'; g.lineWidth = 0.12 * s;
  g.beginPath(); g.moveTo(X(-30), Z(GOAL_Z)); g.lineTo(X(30), Z(GOAL_Z)); g.stroke();
  g.strokeRect(X(-9.16), Z(GOAL_Z), 18.32 * s, 5.5 * s);
  g.strokeRect(X(-20.16), Z(GOAL_Z), 40.32 * s, 16.5 * s);
  g.beginPath(); g.arc(X(0), Z(0), 0.16 * s, 0, 7); g.fill();
  g.beginPath(); g.arc(X(0), Z(0), 9.15 * s, Math.PI / 2 - 0.93, Math.PI / 2 + 0.93); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function ballTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#16181c';
  const spots = [[0.05, .5], [.25, .5], [.45, .5], [.65, .5], [.85, .5], [.15, .2], [.35, .2], [.55, .2], [.75, .2], [.95, .2], [.15, .8], [.35, .8], [.55, .8], [.75, .8], [.95, .8]];
  for (const [u, v] of spots) {
    const x = u * 512, y = v * 256, sx = v === .5 ? 1 : 1.5;
    g.beginPath();
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; g.lineTo(x + Math.cos(a) * 26 * sx, y + Math.sin(a) * 26); }
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ---------------- world ---------------- */
const pitch = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 1 }));
pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0, 7); pitch.receiveShadow = true; scene.add(pitch);
const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x2c7a46, roughness: 1 }));
outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; scene.add(outer);
const board = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 0.3), new THREE.MeshStandardMaterial({ color: 0x14304a, roughness: 0.8 }));
board.position.set(0, 0.5, -19); scene.add(board);

const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
const goal = new THREE.Group(); scene.add(goal);
for (const sx of [-HALF, HALF]) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, BAR + 0.06, 16), white);
  p.position.set(sx, BAR / 2, GOAL_Z); p.castShadow = true; goal.add(p);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, BAR + 0.1, 8), white);
  back.position.set(sx, BAR / 2, NET_BACK); goal.add(back);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2, 8), white);
  arm.rotation.x = Math.PI / 2; arm.position.set(sx, BAR, (GOAL_Z + NET_BACK) / 2); goal.add(arm);
}
const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, HALF * 2 + 0.12, 16), white);
bar.rotation.z = Math.PI / 2; bar.position.set(0, BAR, GOAL_Z); bar.castShadow = true; goal.add(bar);

const nt = netTexture();
const netMat = (rx, ry) => { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05, fog: false }); };
const netBackGeo = new THREE.PlaneGeometry(HALF * 2, BAR, 36, 12);
const netBack = new THREE.Mesh(netBackGeo, netMat(30, 10)); netBack.position.set(0, BAR / 2, NET_BACK); goal.add(netBack);
const netBase = Float32Array.from(netBackGeo.attributes.position.array);
const netTop = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 2), netMat(30, 8)); netTop.rotation.x = Math.PI / 2; netTop.position.set(0, BAR, (GOAL_Z + NET_BACK) / 2); goal.add(netTop);
for (const sx of [-HALF, HALF]) {
  const sn = new THREE.Mesh(new THREE.PlaneGeometry(2, BAR), netMat(8, 10)); sn.rotation.y = Math.PI / 2; sn.position.set(sx, BAR / 2, (GOAL_Z + NET_BACK) / 2); goal.add(sn);
}
let ripple = null;
function updateNet(now) {
  if (!ripple) return;
  const tau = (now - ripple.t0) / 1000, pos = netBackGeo.attributes.position;
  const decay = Math.exp(-3 * tau), done = tau > 1.8;
  for (let i = 0; i < pos.count; i++) {
    const bx = netBase[i * 3], by = netBase[i * 3 + 1];
    const dx = bx - ripple.x, dy = by + BAR / 2 - ripple.y; // plane is centred at BAR/2
    const w = Math.exp(-(dx * dx + dy * dy) * 1.4);
    pos.setZ(i, done ? 0 : -ripple.amp * w * decay * (0.6 + 0.4 * Math.cos(16 * tau)));
  }
  pos.needsUpdate = true;
  if (done) ripple = null;
}

const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55 }));
ball.castShadow = true; scene.add(ball);

/* ---------------- humanoid model ---------------- */
function makeHuman(o) {
  const M = (c, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const m = { shirt: M(o.shirt), shorts: M(o.shorts), socks: M(o.socks), skin: M(o.skin, 0.6), hair: M(o.hair, 0.9), boot: M(o.boots, 0.5), glove: M(o.glove || o.skin, 0.6) };
  const cap = (r, l, mat) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), mat); x.castShadow = true; return x; };
  const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.93; root.add(hips);
  const pelvis = cap(0.125, 0.12, m.shorts); pelvis.rotation.z = Math.PI / 2; pelvis.position.y = 0.02; hips.add(pelvis);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = cap(0.15, 0.3, m.shirt); chest.position.y = 0.3; chest.scale.z = 0.7; torso.add(chest);
  const head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 14), m.skin); skull.castShadow = true; head.add(skull);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.114, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), m.hair); hair.rotation.x = -0.35; head.add(hair);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), m.skin); neck.position.y = -0.1; head.add(neck);
  const arm = (sx) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.215, 0.55, 0); torso.add(sh);
    const up = cap(0.05, 0.2, m.shirt); up.position.y = -0.15; sh.add(up);
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    const fo = cap(0.042, 0.18, m.skin); fo.position.y = -0.13; el.add(fo);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(o.glove ? 0.075 : 0.055, 12, 10), m.glove); hd.position.y = -0.27; hd.castShadow = true; el.add(hd);
    return [sh, el];
  };
  const leg = (sx) => {
    const lg = new THREE.Group(); lg.position.set(sx * 0.1, 0, 0); hips.add(lg);
    const th = cap(0.072, 0.3, m.skin); th.position.y = -0.23; lg.add(th);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.1, 0.22, 12), m.shorts); sh.position.y = -0.12; sh.castShadow = true; lg.add(sh);
    const kn = new THREE.Group(); kn.position.y = -0.46; lg.add(kn);
    const sn = cap(0.058, 0.3, m.socks); sn.position.y = -0.22; kn.add(sn);
    const ft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.27), m.boot); ft.position.set(0, -0.46, -0.05); ft.castShadow = true; kn.add(ft);
    return [lg, kn];
  };
  const [armL, elbowL] = arm(-1), [armR, elbowR] = arm(1), [legL, kneeL] = leg(-1), [legR, kneeR] = leg(1);
  return { root, hips, torso, head, armL, elbowL, armR, elbowR, legL, kneeL, legR, kneeR };
}
function zero(k) {
  for (const n of ['hips', 'torso', 'head', 'armL', 'elbowL', 'armR', 'elbowR', 'legL', 'kneeL', 'legR', 'kneeR']) k[n].rotation.set(0, 0, 0);
  k.hips.position.y = 0.93; k.root.position.y = 0;
}
const skin = 0xd9a47c, skin2 = 0x8d5a3b;
const kickers = [
  makeHuman({ shirt: 0x2f7be0, shorts: 0xffffff, socks: 0x2f7be0, skin, hair: 0x2a1c12, boots: 0x111111 }),
  makeHuman({ shirt: 0xd9342b, shorts: 0xffffff, socks: 0xd9342b, skin: skin2, hair: 0x111111, boots: 0x111111 }),
];
const keeper = makeHuman({ shirt: 0xd8e22a, shorts: 0x1b1b1b, socks: 0x1b1b1b, skin, hair: 0x3a2a1a, boots: 0x1b1b1b, glove: 0xff7a1a });
kickers.forEach((k) => scene.add(k.root)); scene.add(keeper.root);
keeper.root.position.set(0, 0, KEEPER_Z());
function KEEPER_Z() { return -10.85; }
const RUN_START = new THREE.Vector3(-1.7, 0, 2.7), RUN_END = new THREE.Vector3(-0.27, 0, 0.42);

function poseKeeperIdle(now) {
  const k = keeper; zero(k);
  const s = Math.sin(now / 420) * 0.04;
  k.root.position.set(0, -0.08 + s * 0.3, KEEPER_Z()); k.root.rotation.set(0, 0, 0);
  k.legL.rotation.set(0.3, 0, -0.16); k.legR.rotation.set(0.3, 0, 0.16);
  k.kneeL.rotation.x = -0.55; k.kneeR.rotation.x = -0.55;
  k.torso.rotation.x = -0.18;
  k.armL.rotation.set(0, 0, -0.65); k.armR.rotation.set(0, 0, 0.65);
  k.elbowL.rotation.x = 0.5; k.elbowR.rotation.x = 0.5;
}
function poseKeeperDive(tb, zone) {
  const k = keeper, kp = keeperPos(zone, tb);
  zero(k);
  const tilt = -(kp.x / 2.7) * 1.25;
  k.root.position.set(kp.x, Math.max(-0.1, (kp.y - 0.93) * 0.95), KEEPER_Z());
  k.hips.rotation.z = tilt;
  const up = smooth(kp.p * 1.4);
  k.armL.rotation.z = lerp(-0.65, -2.8, up); k.armR.rotation.z = lerp(0.65, 2.8, up);
  k.legL.rotation.set(0.2, 0, -0.2); k.legR.rotation.set(0.1, 0, 0.2);
  k.kneeL.rotation.x = -0.3;
}
function poseKicker(k, T, outcome, decided) {
  zero(k);
  const u = clamp(T / 0.72, 0, 1), e = u * (2 - u);
  const x = lerp(RUN_START.x, RUN_END.x, e), z = lerp(RUN_START.z, RUN_END.z, e);
  k.root.position.set(x, 0, z);
  const heading = Math.atan2(-(RUN_END.x - RUN_START.x), -(RUN_END.z - RUN_START.z));
  k.root.rotation.y = lerp(heading, 0, smooth((T - 0.55) / 0.25));
  const run = T < 0.62;
  if (run) {
    const ph = T * 15, sw = Math.sin(ph) * 0.85 * (0.4 + 0.6 * Math.min(1, T * 4));
    k.legL.rotation.x = sw; k.legR.rotation.x = -sw;
    k.kneeL.rotation.x = -Math.max(0, -Math.sin(ph)) * 1.1; k.kneeR.rotation.x = -Math.max(0, Math.sin(ph)) * 1.1;
    k.armL.rotation.x = -sw * 0.8; k.armR.rotation.x = sw * 0.8; k.elbowL.rotation.x = k.elbowR.rotation.x = 0.9;
    k.torso.rotation.x = -0.18; k.hips.position.y = 0.93 + Math.abs(Math.sin(ph)) * 0.03;
  } else {
    const wu = smooth((T - 0.62) / 0.18), ct = smooth((T - 0.8) / 0.08);
    const back = lerp(0, -0.95, wu), swing = lerp(back, 1.15, ct);
    k.legR.rotation.x = swing; k.kneeR.rotation.x = lerp(lerp(0, -1.25, wu), -0.12, ct);
    k.legL.rotation.x = 0.12; k.kneeL.rotation.x = -0.18;
    k.armL.rotation.z = -0.75; k.armR.rotation.z = 0.75; k.elbowL.rotation.x = k.elbowR.rotation.x = 0.4;
    k.torso.rotation.x = -0.12 - 0.08 * ct; k.hips.rotation.y = 0.15 * ct;
  }
  if (decided) {
    const c = clamp((T - KICK_T - decided) / 0.3, 0, 1);
    if (outcome === 'goal') {
      k.legR.rotation.x = lerp(k.legR.rotation.x, 0.1, c); k.kneeR.rotation.x = lerp(k.kneeR.rotation.x, 0, c);
      k.armL.rotation.set(0, 0, lerp(-0.75, -2.7, c)); k.armR.rotation.set(0, 0, lerp(0.75, 2.7, c));
      k.root.position.y = Math.abs(Math.sin((T - KICK_T - decided) * 6)) * 0.18 * c;
    } else {
      k.head.rotation.x = 0.45 * c; k.torso.rotation.x -= 0.1 * c;
      k.armL.rotation.set(-1.9 * c, 0, -0.2); k.armR.rotation.set(-1.9 * c, 0, 0.2); k.elbowL.rotation.x = k.elbowR.rotation.x = 1.6 * c;
    }
  }
}
function idleKicker(k, now) {
  zero(k); k.root.position.copy(RUN_START); k.root.rotation.y = Math.atan2(-(RUN_END.x - RUN_START.x), -(RUN_END.z - RUN_START.z));
  const s = Math.sin(now / 500) * 0.02; k.torso.rotation.x = -0.1 + s; k.armL.rotation.z = -0.12; k.armR.rotation.z = 0.12; k.elbowL.rotation.x = k.elbowR.rotation.x = 0.3;
  k.legL.rotation.x = 0.1; k.legR.rotation.x = -0.1;
}

/* ---------------- aim helpers ---------------- */
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
const errRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), ringMat); errRing.renderOrder = 10;
const dot = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.08, 24), ringMat); dot.renderOrder = 10;
const aimGroup = new THREE.Group(); aimGroup.add(errRing, dot); aimGroup.visible = false; scene.add(aimGroup);
const PATH_MAX = 300, pathGeo = new THREE.BufferGeometry();
pathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_MAX * 3), 3));
const pathLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthTest: false }));
pathLine.renderOrder = 9; pathLine.frustumCulled = false; pathLine.visible = false; scene.add(pathLine);
const zoneMarker = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthTest: false }));
zoneMarker.renderOrder = 8; zoneMarker.visible = false; scene.add(zoneMarker);

const aim = { x: 0.8, y: 1.5 };
function updatePreview() {
  const power = $('power').value / 100, curve = $('curve').value / 100;
  const pts = previewPath(aim.x, aim.y, 17 + 15 * power, curve);
  const n = Math.min(PATH_MAX, pts.length / 3), arr = pathGeo.attributes.position.array;
  for (let i = 0; i < n * 3; i++) arr[i] = pts[i];
  pathGeo.setDrawRange(0, n); pathGeo.attributes.position.needsUpdate = true;
  const sg = errSigma(power);
  errRing.scale.set(sg, sg, 1); errRing.position.set(aim.x, aim.y, GOAL_Z + 0.1); dot.position.copy(errRing.position);
}
const ray = new THREE.Raycaster(), gplane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -GOAL_Z), tmp = new THREE.Vector3();
let dragging = false;
function aimFrom(e) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, cam);
  if (ray.ray.intersectPlane(gplane, tmp)) { aim.x = clamp(tmp.x, -4.7, 4.7); aim.y = clamp(tmp.y, 0.15, 3.4); updatePreview(); }
}
const canAim = () => S && S.phase === 'pick' && S.you === S.kicker && !S.locked && !anim;
canvas.addEventListener('pointerdown', (e) => { if (!canAim()) return; dragging = true; canvas.setPointerCapture(e.pointerId); aimFrom(e); });
canvas.addEventListener('pointermove', (e) => { if (dragging && canAim()) aimFrom(e); });
canvas.addEventListener('pointerup', () => { dragging = false; });
$('power').addEventListener('input', updatePreview);
$('curve').addEventListener('input', updatePreview);

/* ---------------- audio ---------------- */
let ac = null, muted = localStorage.getItem('sk-m') === '1';
const AC = () => { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
function tone(f, d, type = 'sine', v = 0.2, f2) {
  if (muted) return; const a = AC(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g).connect(a.destination); o.start(t); o.stop(t + d);
}
function noise(d, v, freq) {
  if (muted) return; const a = AC(), n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = v;
  s.buffer = b; s.connect(f).connect(g).connect(a.destination); s.start();
}
const sfx = {
  kick() { tone(140, 0.12, 'sine', 0.5, 50); noise(0.06, 0.3, 1800); },
  post() { tone(880, 0.5, 'triangle', 0.3); tone(1320, 0.3, 'sine', 0.15); },
  net() { noise(0.5, 0.25, 900); },
  save() { noise(0.12, 0.35, 1200); tone(200, 0.1, 'sine', 0.3, 100); },
  whistle() { tone(2900, 0.3, 'square', 0.07); },
  cheer() { noise(1.6, 0.18, 2200); },
  groan() { tone(220, 0.6, 'sawtooth', 0.05, 140); },
};
function setMuteLabel() { $('btnMute').textContent = muted ? 'Sound off' : 'Sound on'; }
$('btnMute').onclick = () => { muted = !muted; localStorage.setItem('sk-m', muted ? '1' : '0'); setMuteLabel(); };
$('btnQ').onclick = () => { quality = quality === 'high' ? 'low' : 'high'; localStorage.setItem('sk-q', quality); applyQuality(); };

/* ---------------- game state / network ---------------- */
const socket = io();
let S = null, me = JSON.parse(localStorage.getItem('sk-me') || 'null'), anim = null, timerEnd = 0, selZone = -1, bannerT = 0;
const params = new URLSearchParams(location.search);
$('name').value = localStorage.getItem('sk-name') || '';
if (params.get('room')) $('code').value = params.get('room').toUpperCase().slice(0, 4);

const nm = () => { const n = $('name').value.trim() || 'Player'; localStorage.setItem('sk-name', n); return n; };
$('btnCreate').onclick = () => { AC(); $('homeMsg').textContent = 'Creating…'; socket.emit('create', { name: nm() }, (a) => onJoined(a)); };
$('btnJoin').onclick = () => {
  AC(); const c = $('code').value.trim().toUpperCase();
  if (c.length !== 4) { $('homeMsg').textContent = 'Enter the 4-letter room code.'; return; }
  $('homeMsg').textContent = 'Joining…'; socket.emit('join', { code: c, name: nm() }, (a) => onJoined(a));
};
function onJoined(a) {
  if (!a || !a.ok) { $('homeMsg').textContent = (a && a.error) || 'Could not connect.'; return; }
  me = { code: a.code, token: a.token, idx: a.idx }; localStorage.setItem('sk-me', JSON.stringify(me)); $('homeMsg').textContent = '';
}
$('btnCopy').onclick = async () => {
  const url = `${location.origin}/?room=${me.code}`;
  try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = 'Link copied'; } catch { prompt('Copy this link', url); }
  setTimeout(() => ($('btnCopy').textContent = 'Copy invite link'), 1800);
};
const leave = () => { socket.emit('leave'); clearMe(); location.href = '/'; };
$('btnLeave').onclick = leave; $('btnLobbyLeave').onclick = leave;
$('btnRematch').onclick = () => { socket.emit('rematch'); $('btnRematch').disabled = true; $('overMsg').textContent = 'Waiting for your opponent…'; };
function clearMe() { me = null; localStorage.removeItem('sk-me'); }

socket.on('connect', () => {
  if (me) socket.emit('rejoin', { code: me.code, token: me.token }, (a) => { if (!a || !a.ok) { clearMe(); showHome(); } });
});
socket.on('closed', (msg) => { clearMe(); S = null; anim = null; showHome(msg); });
socket.on('state', applyState);
socket.on('shot', startShot);

function showHome(msg) {
  ['lobby', 'over', 'hud', 'bottom'].forEach((i) => ($(i).hidden = true));
  $('home').hidden = false; $('homeMsg').textContent = msg || ''; resetScene();
}

function applyState(st) {
  if (anim && st.phase === 'anim') { S = { ...S, connected: st.connected }; renderHUD(); return; }
  const prevPhase = S && S.phase, prevShot = S && S.shotNo;
  S = st; anim = null; $('home').hidden = true;
  $('lobby').hidden = st.phase !== 'lobby';
  if (st.phase === 'lobby') { $('roomCode').textContent = st.code; resetScene(); $('hud').hidden = true; $('bottom').hidden = true; return; }
  $('hud').hidden = false; $('bottom').hidden = false;
  timerEnd = performance.now() + st.left;
  if (st.phase === 'pick') {
    if (prevPhase !== 'pick' || prevShot !== st.shotNo) { resetScene(); selZone = -1; document.querySelectorAll('#zones button').forEach((b) => b.classList.remove('sel')); if (st.shotNo === 1 && st.kicksTaken[0] + st.kicksTaken[1] === 0) sfx.whistle(); }
    $('over').hidden = true;
  }
  if (st.phase === 'over') showOver();
  renderHUD(); renderPanel();
}

function renderHUD() {
  const s = S; if (!s) return;
  for (let i = 0; i < 2; i++) {
    $('n' + i).textContent = (s.names[i] || '…') + (i === s.you ? ' (you)' : '') + (s.connected[i] ? '' : ' · away');
    $('n' + i).parentElement.classList.toggle('me', i === s.you);
    const total = Math.max(5, s.hist[i].length); let h = '';
    for (let j = 0; j < total; j++) h += `<i class="${s.hist[i][j] || ''}"></i>`;
    $('d' + i).innerHTML = h;
  }
  $('score').textContent = `${s.scores[0]} – ${s.scores[1]}`;
  const kickerName = s.names[s.kicker] || '';
  $('sub').textContent = s.sudden ? 'Sudden death' : `Kick ${Math.min(5, s.shotNo)} of 5`;
  if (s.phase === 'pick') $('sub').textContent += ` · ${s.kicker === s.you ? 'you shoot' : kickerName + ' shoots'}`;
}
function renderPanel() {
  const s = S, pick = s.phase === 'pick', isK = s.you === s.kicker;
  $('kickPanel').hidden = !(pick && isK && !s.locked);
  $('keepPanel').hidden = !(pick && !isK && !s.locked);
  $('hint').hidden = !pick;
  $('hint').textContent = s.locked ? 'Locked in. Waiting for your opponent…' : isK ? 'Drag on the goal to aim. The ring shows your accuracy.' : 'Pick a zone and dive before the kick.';
  const showAim = pick && isK && !s.locked;
  aimGroup.visible = showAim; pathLine.visible = showAim;
  zoneMarker.visible = pick && !isK && !s.locked && selZone >= 0;
  if (showAim) updatePreview();
}
function showOver() {
  const s = S, win = s.winner === s.you;
  $('over').hidden = false; $('overTitle').textContent = win ? 'You win' : `${s.names[s.winner]} wins`;
  $('overTitle').style.color = win ? '#ffd23f' : '#f6f1e4';
  $('overScore').textContent = `${s.names[0]} ${s.scores[0]} – ${s.scores[1]} ${s.names[1]}`;
  $('btnRematch').disabled = !!s.rematch[s.you];
  $('overMsg').textContent = s.rematch[s.you] ? 'Waiting for your opponent…' : s.rematch[1 - s.you] ? 'Your opponent wants a rematch.' : '';
  if (win) sfx.cheer();
}
document.querySelectorAll('#zones button').forEach((b) => (b.onclick = () => {
  selZone = +b.dataset.z; document.querySelectorAll('#zones button').forEach((x) => x.classList.toggle('sel', x === b));
  const z = ZONES[selZone]; zoneMarker.position.set(z.x, z.y, GOAL_Z + 0.12); zoneMarker.visible = true;
}));
$('btnDive').onclick = () => { if (selZone < 0) { $('hint').textContent = 'Pick a dive zone first.'; return; } S.locked = true; socket.emit('dive', { zone: selZone }); renderPanel(); };
$('btnShoot').onclick = () => {
  AC(); S.locked = true;
  socket.emit('aim', { tx: aim.x, ty: aim.y, power: $('power').value / 100, curve: $('curve').value / 100 }); renderPanel();
};

const BANNER = { goal: ['GOAL!', '#52d273'], save: ['SAVED!', '#ffd23f'], post: ['OFF THE POST!', '#ffd23f'], bar: ['CROSSBAR!', '#ffd23f'], miss: ['MISSED!', '#ff5a4e'] };
function showBanner(o) { const [t, c] = BANNER[o] || BANNER.miss; const b = $('banner'); b.textContent = t; b.style.color = c; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2000); }

/* ---------------- shot playback ---------------- */
function resetScene() {
  anim = null; ball.position.set(0, R, 0); ball.quaternion.identity();
  ripple = null; netBackGeo.attributes.position.array.set(netBase); netBackGeo.attributes.position.needsUpdate = true;
  $('banner').classList.remove('on');
}
function startShot(msg) {
  AC(); $('kickPanel').hidden = true; $('keepPanel').hidden = true; $('hint').hidden = true;
  aimGroup.visible = pathLine.visible = zoneMarker.visible = false;
  resetScene();
  anim = { t0: performance.now(), sim: simulate(msg.params), msg, ev: 0, started: false, shown: false, last: new THREE.Vector3(0, R, 0), spin: -msg.params.curve * 70 };
  S = { ...S, kicker: msg.kicker };
}
function stepAnim(now) {
  const a = anim, T = (now - a.t0) / 1000, tb = T - KICK_T, k = kickers[a.msg.kicker];
  const decided = a.shown ? a.sim.tDecide : 0;
  poseKicker(k, T, a.msg.outcome, a.shown ? a.sim.tDecide : 0);
  kickers.forEach((o) => (o.root.visible = o === k));
  if (tb < 0) { poseKeeperIdle(now); return; }
  if (!a.started) { a.started = true; sfx.kick(); }
  poseKeeperDive(tb, a.msg.params.zone);
  const f = a.sim.frames, n = f.length / 3 - 1, idx = clamp(tb * 60, 0, n), i0 = Math.floor(idx), fr = idx - i0, i1 = Math.min(n, i0 + 1);
  ball.position.set(lerp(f[i0 * 3], f[i1 * 3], fr), lerp(f[i0 * 3 + 1], f[i1 * 3 + 1], fr), lerp(f[i0 * 3 + 2], f[i1 * 3 + 2], fr));
  const d = tmp.copy(ball.position).sub(a.last);
  if (d.lengthSq() > 1e-10) {
    const dist = d.length(), axis = new THREE.Vector3(0, 1, 0).cross(d.divideScalar(dist)).normalize();
    ball.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / R));
    if (ball.position.y > R + 0.05) ball.rotateY(a.spin * 0.016);
  }
  a.last.copy(ball.position);
  const evs = a.sim.events;
  while (a.ev < evs.length && evs[a.ev].t <= tb) {
    const e = evs[a.ev++];
    if (e.type === 'post') sfx.post(); else if (e.type === 'save') sfx.save();
    else if (e.type === 'goal') { sfx.net(); } else if (e.type === 'net') ripple = { t0: now, x: e.x, y: e.y, amp: e.amp };
  }
  if (!a.shown && tb >= a.sim.tDecide) {
    a.shown = true; S = a.msg.snap; renderHUD(); showBanner(a.msg.outcome);
    if (a.msg.outcome === 'goal') sfx.cheer(); else sfx.groan();
  }
}

/* ---------------- main loop ---------------- */
let last = performance.now(), slow = 0, frames = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (anim) stepAnim(now);
  else {
    const kr = S ? kickers[S.kicker === 1 ? 1 : 0] : kickers[0];
    kickers.forEach((o) => (o.root.visible = o === kr));
    idleKicker(kr, now); poseKeeperIdle(now);
  }
  updateNet(now);
  if (S && S.phase === 'pick') { const sec = Math.max(0, Math.ceil((timerEnd - now) / 1000)); $('timer').textContent = sec + 's'; } else $('timer').textContent = '';
  const tx = anim && anim.started ? ball.position.x * 0.35 : 0;
  camLook.x = lerp(camLook.x, tx, 1 - Math.exp(-dt * 3)); camLook.y = lookBase.y;
  cam.position.copy(camPos); cam.lookAt(camLook);
  renderer.render(scene, cam);
  if (++frames > 90 && frames < 240) { if (dt > 0.034) slow++; if (frames === 239 && slow > 90 && quality === 'high') { quality = 'low'; localStorage.setItem('sk-q', 'low'); applyQuality(); } }
  requestAnimationFrame(frame);
}
setMuteLabel(); applyQuality(); resetScene();
requestAnimationFrame(frame);
