'use strict';
(() => {
const $ = id => document.getElementById(id);
const cv = $('c'), cx = cv.getContext('2d');
const { sin, cos, atan2, hypot, min, max, abs, PI, random, floor, round, sqrt } = Math;
const TAU = PI * 2, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
const lerp = (a, b, t) => a + (b - a) * t, lerpA = (a, b, t) => a + wrap(b - a) * t;
const D = window.DEFS, { ROLES, RNAME, RSHORT, PORT_NAMES, TREE_OF, TREES, ABIL, NODE_COST, infCost, ETYPES, DIFFS, MTYPES, MK_COST, MK_NAMES } = D;
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5;
const RICON = ['✈', '⟫', '✚', '⚙', '◐', '⟪'];
const PLAYER_RED = '#ff3030', ENEMY_GREEN = '#39ff4a';
const MODE_N = ['DEFLECT', 'KINETIC'], MODE_C = ['#5fe0ff', '#ffaa33'];
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const ROLE_HELP = [
  'Steer by aiming (mouse/stick). Click = nose laser. You <b>cannot</b> change speed: that is the Engineer. If the Cockpit is destroyed the ship drifts straight ahead until it is repaired. Your vote counts extra on the star map.',
  'Aim + hold click to fire your starboard (right) turret. Your red bolts shoot down missiles and flak. If the port turret is destroyed you get a full 360° arc.',
  'Hold FIRE while the needle is inside the green band to repair the port named in your panel (~10 s). Pick a target with 1-6 (0 = hull) or tap it. When every port is at full health your drone launches automatically and follows your cursor.',
  'You alone control speed: W/S or wheel = throttle. 1/2/3 route a power pip to Engines/Weapons/Shields (4 = balanced). Engines destroyed = the ship slowly stalls until repaired.',
  'Aim to swing the deflector. Space / right-click flips mode: DEFLECT blocks green lasers, KINETIC blocks missiles and flak. Blocked shots feed ship energy.',
  'Aim + hold click to fire your port (left) turret. Your red bolts shoot down missiles and flak. If the starboard turret is destroyed you get a full 360° arc.'];
const COMMON = 'Your station destroyed? <b>Hold FIRE to self-patch</b>. <b>F</b> = lend a hand to repairs. <b>Q/E/R</b> = your abilities (buy them in the skill tree, U). <b>Tab</b> switch role · <b>H</b> help.';

// ---------- state ----------
let ws = null, me = { role: -1, cr: 0, tr: null, code: '', pid: 0 }, snaps = [], offset = null, lastSnap = null, cur = null;
let W = 0, H = 0, DPR = 1, Z = 1, camX = 0, camY = 0, shake = 0, flash = 0, flashC = '#f00';
const bolts = new Map(), parts = [];
let joined = false, prefRole = -1, wantedRoom = new URLSearchParams(location.search).get('room') || (location.pathname.match(/^\/r\/(\w+)/) || [])[1] || '';
let cid = localStorage.getItem('tss_cid'); if (!cid) { cid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('tss_cid', cid); }
$('name').value = localStorage.getItem('tss_name') || '';
if (wantedRoom) { $('joininfo').textContent = 'Joining private ship ' + wantedRoom.toUpperCase() + '. Bots keep the seats warm.'; $('go').textContent = 'JOIN SHIP ' + wantedRoom.toUpperCase() + ' ▶'; }

// ---------- audio ----------
const A = { ctx: null, master: null, sfx: null, mus: null, muted: localStorage.getItem('tss_mute') === '1', music: localStorage.getItem('tss_music') !== '0', last: {}, noise: null };
function audioInit() {
  if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
  try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const c = A.ctx;
  A.master = c.createGain(); A.master.gain.value = A.muted ? 0 : 0.8;
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
  A.master.connect(comp); comp.connect(c.destination);
  A.sfx = c.createGain(); A.sfx.gain.value = 0.55; A.sfx.connect(A.master);
  A.mus = c.createGain(); A.mus.gain.value = A.music ? 0.22 : 0; A.musF = c.createBiquadFilter(); A.musF.type = 'lowpass'; A.musF.frequency.value = 1400; A.musF.connect(A.mus); A.mus.connect(A.master);
  const len = c.sampleRate; A.noise = c.createBuffer(1, len, c.sampleRate); const d = A.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = random() * 2 - 1;
  musicStart();
}
function gate(k, ms) { const n = performance.now(); if (A.last[k] && n - A.last[k] < ms) return false; A.last[k] = n; return true; }
function panNode(x) { const p = A.ctx.createStereoPanner ? A.ctx.createStereoPanner() : null; if (p) { p.pan.value = clamp((x - camX) / 700, -0.9, 0.9); p.connect(A.sfx); return p; } return A.sfx; }
function tone(f, d, type = 'square', vol = 0.1, f2 = null, x = null, delay = 0) {
  if (!A.ctx || A.muted) return; const c = A.ctx, t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(max(20, f2), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + d);
  o.connect(g); g.connect(x == null ? A.sfx : panNode(x)); o.start(t); o.stop(t + d + 0.02);
}
function noise(d, vol = 0.2, f = 1200, f2 = 100, type = 'lowpass', x = null, delay = 0) {
  if (!A.ctx || A.muted) return; const c = A.ctx, t = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = A.noise; s.playbackRate.value = 0.7 + random() * 0.6;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(max(30, f2), t + d);
  const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
  s.connect(fl); fl.connect(g); g.connect(x == null ? A.sfx : panNode(x)); s.start(t, random() * 0.5); s.stop(t + d + 0.05);
}
const SFX = {
  laser(k, x) { if (k === 2) { if (gate('l2', 70)) tone(700, 0.11, 'sawtooth', 0.05, 160, x); } else if (k === 3) { if (gate('l3', 80)) tone(1800, 0.06, 'square', 0.025, 900, x); } else if (gate('l1', 45)) tone(1100 + random() * 150, 0.1, 'sawtooth', 0.035, 200, x); },
  elaser(t, x, ion) { if (ion) { if (gate('ion', 120)) { tone(180, 0.4, 'sawtooth', 0.09, 60, x); noise(0.3, 0.1, 900, 100, 'lowpass', x); } return; } if (t === 1) { if (gate('em', 120)) noise(0.25, 0.05, 600, 2400, 'bandpass', x); } else if (gate('el', 70)) tone(520, 0.12, 'square', 0.022, 150, x); },
  rocket(x) { if (gate('rk', 90)) noise(0.3, 0.07, 500, 3000, 'bandpass', x); },
  boom(sz, x) { if (!gate('boom' + sz, 50)) return; const d = 0.25 + sz * 0.25; noise(d, 0.18 + sz * 0.09, 2400, 50, 'lowpass', x); tone(110, d, 'sine', 0.22 + sz * 0.05, 26, x); },
  block(t, x) { if (gate('blk', 40)) tone(t ? 700 : 1100, 0.12, 'triangle', 0.07, t ? 1100 : 1600, x); },
  armor(x) { if (gate('arm', 60)) tone(300, 0.06, 'square', 0.03, 200, x); },
  hit() { if (gate('hit', 90)) { noise(0.35, 0.35, 3000, 200, 'lowpass'); tone(90, 0.3, 'square', 0.12, 40); } },
  alarm() { for (let i = 0; i < 3; i++) { tone(880, 0.12, 'square', 0.06, null, null, i * 0.26); tone(620, 0.12, 'square', 0.06, null, null, i * 0.26 + 0.13); } },
  fixed() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'triangle', 0.07, null, null, i * 0.06)); },
  coin() { if (gate('coin', 45)) { tone(1500, 0.06, 'square', 0.035); tone(2250, 0.08, 'square', 0.03, null, null, 0.05); } },
  core() { [880, 1320, 1760, 2640].forEach((f, i) => tone(f, 0.15, 'sine', 0.07, null, null, i * 0.05)); },
  flip(m) { tone(m ? 500 : 900, 0.15, 'sine', 0.08, m ? 1300 : 350); },
  bomb() { noise(0.3, 0.12, 400, 2000, 'bandpass'); tone(200, 0.3, 'sawtooth', 0.05, 80); },
  ui() { tone(1000, 0.05, 'square', 0.04, 1400); },
  pd(x) { if (gate('pd', 40)) tone(2400, 0.04, 'square', 0.03, 1200, x); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, 'square', 0.06, null, null, i * 0.1)); },
  lose() { [440, 349, 262, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.07, null, null, i * 0.16)); },
  wave() { tone(220, 0.5, 'sawtooth', 0.06, 880); tone(330, 0.5, 'sawtooth', 0.04, 1320); },
  launch() { tone(300, 0.25, 'triangle', 0.07, 1200); },
  ability() { tone(400, 0.2, 'sawtooth', 0.06, 1600); tone(800, 0.25, 'triangle', 0.05, 2400, null, 0.05); },
  buff() { [660, 880, 1100].forEach((f, i) => tone(f, 0.18, 'triangle', 0.06, null, null, i * 0.07)); },
  charge(x) { tone(120, 0.9, 'sawtooth', 0.05, 900, x); },
  pip() { tone(1300, 0.04, 'square', 0.03, 1700); },
};
// --- music: tiny step sequencer (A minor) ---
const MUS = { step: 0, next: 0, timer: null };
const BASS = [45, 0, 45, 45, 0, 45, 48, 0, 41, 0, 41, 41, 0, 41, 43, 0, 48, 0, 48, 48, 0, 48, 52, 0, 43, 0, 43, 43, 0, 47, 43, 0];
const ARP = [[57, 60, 64, 69], [53, 57, 60, 65], [60, 64, 67, 72], [55, 59, 62, 67]];
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
function musicStart() {
  if (MUS.timer) return; MUS.next = A.ctx.currentTime + 0.1;
  MUS.timer = setInterval(() => {
    const c = A.ctx; if (!c) return; const sp = 60 / 128 / 4;
    while (MUS.next < c.currentTime + 0.15) {
      const s = MUS.step % 32, t = MUS.next, bar = floor((MUS.step % 64) / 16);
      if (A.music && !A.muted) {
        const n = BASS[s]; if (n) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = mf(n - 12); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + sp * 1.8); o.connect(g); g.connect(A.musF); o.start(t); o.stop(t + sp * 2); }
        const ar = ARP[bar % 4], an = ar[(s * 3) % 4] + (s % 8 > 5 ? 12 : 0); { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = mf(an); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + sp * 0.9); o.connect(g); g.connect(A.musF); o.start(t); o.stop(t + sp); }
        if (s % 4 === 0) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(A.mus); o.start(t); o.stop(t + 0.22); }
        if (s % 2 === 1 || s % 8 === 4) { const sN = c.createBufferSource(); sN.buffer = A.noise; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = s % 8 === 4 ? 1500 : 7000; const g = c.createGain(); const v = s % 8 === 4 ? 0.22 : 0.06; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (s % 8 === 4 ? 0.14 : 0.04)); sN.connect(f); f.connect(g); g.connect(A.mus); sN.start(t, random()); sN.stop(t + 0.16); }
      }
      MUS.next += sp; MUS.step++;
    }
  }, 30);
}
function setMute(m) { A.muted = m; localStorage.setItem('tss_mute', m ? '1' : '0'); if (A.master) A.master.gain.value = m ? 0 : 0.8; $('b-mute').textContent = m ? '🔇' : '🔊'; }
function setMusic(m) { A.music = m; localStorage.setItem('tss_music', m ? '1' : '0'); if (A.mus) A.mus.gain.value = m ? 0.22 : 0; $('b-mus').style.opacity = m ? 1 : 0.4; }
setMute(A.muted); setMusic(A.music);

// ---------- particles ----------
function P(o) { if (parts.length > 1500) parts.shift(); parts.push(o); }
function sparks(x, y, n, col, sp = 300, life = 0.5, size = 2) { for (let i = 0; i < n; i++) { const a = random() * TAU, v = sp * (0.3 + random()); P({ k: 0, x, y, vx: cos(a) * v, vy: sin(a) * v, life: life * (0.5 + random()), max: life, s: size, c: col }); } }
function ring(x, y, r0, r1, life, col, w = 3) { P({ k: 1, x, y, r0, r1, life, max: life, c: col, w }); }
function explosion(x, y, sz, r) {
  const n = [8, 18, 30, 70, 110][sz] || 20, R = r || (10 + sz * 18);
  P({ k: 2, x, y, life: 0.16 + sz * 0.05, max: 0.16 + sz * 0.05, r: R * 1.6 + 20, c: '#fff' });
  ring(x, y, 4, R * 2 + 30, 0.35 + sz * 0.1, '#ffb050', 2 + sz);
  for (let i = 0; i < 4 + sz * 4; i++) { const a = random() * TAU, d = random() * R * 0.7; P({ k: 5, x: x + cos(a) * d, y: y + sin(a) * d, vx: cos(a) * 30, vy: sin(a) * 30, life: 0.5 + random() * 0.5 + sz * 0.1, max: 1 + sz * 0.1, s: 8 + R * 0.4 * random() + sz * 5 }); }
  sparks(x, y, n, '#ffcf6a', 200 + sz * 90, 0.6 + sz * 0.15, 2 + sz * 0.4);
  sparks(x, y, n / 2, '#fff', 150 + sz * 60, 0.4, 1.5);
  for (let i = 0; i < 2 + sz * 2; i++) { const a = random() * TAU, v = 40 + random() * 80; P({ k: 3, x, y, vx: cos(a) * v, vy: sin(a) * v, life: 0.9 + random() * 0.9, max: 1.8, s: 10 + sz * 7, c: '#332a28' }); }
  for (let i = 0; i < 1 + sz * 2; i++) { const a = random() * TAU, v = 120 + random() * 220; P({ k: 4, x, y, vx: cos(a) * v, vy: sin(a) * v, a: random() * TAU, va: (random() - .5) * 20, life: 1, max: 1, s: 3 + sz * 2, c: '#8a8f99' }); }
  const d = hypot(x - camX, y - camY); if (d < 900) shake = max(shake, (sz * 4 + 2) * (1 - d / 900));
  SFX.boom(min(sz, 4), x);
}
function stepParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const f = p.k === 3 || p.k === 5 ? 0.96 : 0.93; p.vx *= f; p.vy *= f; } if (p.va) p.a += p.va * dt; }
}

// ---------- sprites (pre-rendered vector art) ----------
const SPR = {}, SS = 2;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function spr(key, w, h, fn) { let c = SPR[key]; if (c) return c; c = SPR[key] = document.createElement('canvas'); c.width = w * SS; c.height = h * SS; const g = c.getContext('2d'); g.scale(SS, SS); g.translate(w / 2, h / 2); g.lineJoin = 'round'; fn(g, rng(key.length * 7919 + key.charCodeAt(0) * 31)); c.hw = w / 2; c.hh = h / 2; return c; }
function blit(c, x, y, a, s = 1, alpha = 1) { cx.save(); cx.translate(x, y); cx.rotate(a); if (alpha < 1) cx.globalAlpha = alpha; cx.drawImage(c, -c.hw * s, -c.hh * s, c.hw * 2 * s, c.hh * 2 * s); cx.restore(); }
const poly = (g, p) => { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); };
const mirror = p => p.concat(p.slice().reverse().map(([x, y]) => [x, -y]));
function metal(g, r, c1 = '#c9ced6', c2 = '#6d737d') { const gr = g.createLinearGradient(-r * 0.4, -r, r * 0.4, r); gr.addColorStop(0, c1); gr.addColorStop(0.55, c2); gr.addColorStop(1, '#3a3e46'); return gr; }
function greeble(g, R, n, x0, x1, y0, y1, dark = 'rgba(0,0,0,.28)', light = 'rgba(255,255,255,.18)') { for (let i = 0; i < n; i++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0), w = 1 + R() * 5, h = 1 + R() * 3; g.fillStyle = R() < 0.6 ? dark : light; g.fillRect(x, y, w, h); } }
function panelLines(g, R, n, x0, x1, y0, y1) { g.strokeStyle = 'rgba(20,24,30,.45)'; g.lineWidth = 0.6; for (let i = 0; i < n; i++) { g.beginPath(); if (R() < 0.5) { const x = x0 + R() * (x1 - x0); g.moveTo(x, y0 + R() * (y1 - y0) * 0.5); g.lineTo(x, y1 - R() * (y1 - y0) * 0.5); } else { const y = y0 + R() * (y1 - y0); g.moveTo(x0 + R() * (x1 - x0) * 0.5, y); g.lineTo(x1 - R() * (x1 - x0) * 0.5, y); } g.stroke(); } }
function shipBody(g, R, pts, r, c1, c2) { poly(g, pts); g.fillStyle = metal(g, r, c1, c2); g.fill(); g.save(); g.clip(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y); } panelLines(g, R, 26, x0, x1, y0, y1); greeble(g, R, 50, x0, x1, y0, y1); const sh = g.createLinearGradient(0, y0, 0, y1); sh.addColorStop(0, 'rgba(255,255,255,.12)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = sh; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.restore(); g.strokeStyle = 'rgba(10,12,16,.9)'; g.lineWidth = 1.2; poly(g, pts); g.stroke(); }
// player corvette, one look per ship Mk
function playerSprite(mk) {
  return spr('pl' + mk, 150, 130, (g, R) => {
    const L = mk === 2 ? 1.12 : 1;
    if (mk >= 1) { // weapon pods / wings
      for (const s of [-1, 1]) { const wp = [[18, 22 * s], [-8, 46 * s], [-30, 48 * s], [-26, 24 * s]]; shipBody(g, R, wp, 40, '#b9bec6', '#5c626b'); g.fillStyle = '#c33'; g.fillRect(-22, 40 * s - 2, 14, 4); }
    }
    const body = mirror([[52 * L, 0], [40 * L, -7], [24, -12], [4, -15], [-20, -24], [-40, -26], [-48, -18]]);
    shipBody(g, R, body, 40, '#d5d9df', '#727882');
    if (mk === 2) { const top = mirror([[30, 0], [12, -8], [-30, -12], [-38, -6]]); shipBody(g, R, top, 30, '#e3e6ea', '#8a9099'); }
    // red rebel stripes
    g.fillStyle = '#c42525'; g.fillRect(-36, -25, 10, 4); g.fillRect(-36, 21, 10, 4); g.fillRect(10, -14, 12, 3); g.fillRect(10, 11, 12, 3);
    // engine block
    g.fillStyle = '#2b2f36'; g.fillRect(-52, -20, 8, 40); for (const y of [-13, 0, 13]) { g.fillStyle = '#111'; g.beginPath(); g.arc(-50, y, 5, 0, TAU); g.fill(); }
    // cockpit glass
    const cg = g.createLinearGradient(30, -6, 40, 6); cg.addColorStop(0, '#9ff'); cg.addColorStop(1, '#136'); g.fillStyle = cg; g.beginPath(); g.ellipse(36 * L, 0, 8, 5, 0, 0, TAU); g.fill(); g.strokeStyle = '#222'; g.stroke();
    g.fillStyle = '#9aa'; g.beginPath(); g.arc(-8, 0, 7, 0, TAU); g.fill(); g.strokeStyle = '#333'; g.stroke(); // dorsal sensor dish
    g.strokeStyle = '#555'; g.beginPath(); g.moveTo(-8, 0); g.lineTo(-2, -4); g.stroke();
  });
}
const ESPR = {
  probe: g => { g.strokeStyle = '#555'; g.lineWidth = 1.2; for (let i = 0; i < 5; i++) { const a = PI * 0.6 + i * 0.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(cos(a + PI) * -16, sin(a) * 14); g.stroke(); } const gr = g.createRadialGradient(-3, -3, 1, 0, 0, 10); gr.addColorStop(0, '#777'); gr.addColorStop(1, '#1b1d22'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 10, 0, TAU); g.fill(); g.fillStyle = '#f33'; g.beginPath(); g.arc(7, 0, 2.2, 0, TAU); g.fill(); },
  fighter: (g, R) => { for (const s of [-1, 1]) { const w = mirror([[14, 15 * s], [9, 17 * s]]).map(([x, y]) => [x, y]); poly(g, [[-14, 13 * s], [-9, 18 * s], [9, 18 * s], [14, 13 * s], [9, 16 * s], [-9, 16 * s]]); g.fillStyle = '#5b6068'; g.fill(); g.strokeStyle = '#1a1c20'; g.stroke(); g.fillStyle = '#2a2d33'; g.fillRect(-12, 13.5 * s - (s > 0 ? 0 : 2), 24, 2); g.strokeStyle = '#777'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 14 * s); g.stroke(); g.lineWidth = 1; } const gr = g.createRadialGradient(-2, -2, 1, 0, 0, 7); gr.addColorStop(0, '#bfc4cc'); gr.addColorStop(1, '#3a3e45'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(3, 0, 3.4, 0, TAU); g.fill(); g.strokeStyle = '#666'; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(3, 0); g.lineTo(3 + cos(i * PI / 4) * 3.4, sin(i * PI / 4) * 3.4); g.stroke(); } },
  interceptor: g => { for (const s of [-1, 1]) { poly(g, [[0, 3 * s], [-4, 16 * s], [14, 18 * s], [2, 14 * s], [-2, 6 * s]]); g.fillStyle = '#4c5159'; g.fill(); g.strokeStyle = '#15171a'; g.stroke(); } const gr = g.createRadialGradient(-2, -2, 1, 0, 0, 6); gr.addColorStop(0, '#c7ccd3'); gr.addColorStop(1, '#3a3e45'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(2.5, 0, 3, 0, TAU); g.fill(); g.fillStyle = '#f44'; g.fillRect(13, -18, 2, 1.5); g.fillRect(13, 16.5, 2, 1.5); },
  bomber: (g, R) => { for (const s of [-1, 1]) { shipBody(g, R, [[18, 7 * s], [6, 2 * s], [-16, 3 * s], [-20, 9 * s], [-16, 14 * s], [8, 13 * s]], 16, '#a6abb3', '#50555d'); } g.fillStyle = '#5b6068'; g.fillRect(-6, -8, 10, 16); g.fillStyle = '#111'; g.beginPath(); g.arc(14, -8, 3, 0, TAU); g.fill(); g.fillStyle = '#7f3'; g.fillRect(-21, -12, 2, 6); g.fillRect(-21, 6, 2, 6); },
  raider: (g, R) => { const b = mirror([[22, 0], [14, -5], [-6, -6], [-16, -16], [-22, -16], [-20, -5]]); shipBody(g, R, b, 20, '#b88a5a', '#5a3b22'); for (const s of [-1, 1]) { g.fillStyle = '#6b4a2e'; g.fillRect(-24, 14 * s - 3, 22, 6); g.fillStyle = '#f80'; g.fillRect(-26, 14 * s - 2, 3, 4); } g.fillStyle = '#ffcf6a'; g.beginPath(); g.arc(10, 0, 3, 0, TAU); g.fill(); g.fillStyle = '#e33'; g.fillRect(-4, -2, 6, 4); },
  mine: g => { g.strokeStyle = '#888'; g.lineWidth = 2; for (let i = 0; i < 8; i++) { const a = i * PI / 4; g.beginPath(); g.moveTo(cos(a) * 6, sin(a) * 6); g.lineTo(cos(a) * 13, sin(a) * 13); g.stroke(); } const gr = g.createRadialGradient(-2, -2, 1, 0, 0, 8); gr.addColorStop(0, '#99a'); gr.addColorStop(1, '#223'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 8, 0, TAU); g.fill(); },
  gunship: (g, R) => { const b = mirror([[48, 0], [30, -8], [0, -14], [-30, -22], [-46, -18], [-46, 0]]); shipBody(g, R, b, 40, '#bfc4cc', '#575c64'); g.fillStyle = '#2b2e34'; g.fillRect(-14, -6, 22, 12); g.fillStyle = '#9fe'; g.fillRect(30, -2, 6, 4); for (const y of [-12, 0, 12]) { g.fillStyle = '#7f7'; g.fillRect(-48, y - 2, 3, 4); } },
  frigate: (g, R) => { shipBody(g, R, mirror([[90, 0], [80, -14], [44, -26], [26, -28], [20, -10]]), 60, '#d0d4da', '#666b73'); g.fillStyle = '#3a3e45'; g.fillRect(-60, -4, 82, 8); shipBody(g, R, mirror([[-36, -6], [-40, -22], [-78, -32], [-92, -26], [-92, 0]]), 60, '#c7ccd3', '#5b6068'); g.fillStyle = '#6f6'; for (const y of [-20, -8, 8, 20]) g.fillRect(-94, y - 2, 3, 4); g.fillStyle = '#9fe'; g.fillRect(70, -3, 8, 6); },
  destroyer: (g, R) => { const tri = [[150, 0], [-110, -80], [-110, 80]]; shipBody(g, R, tri, 120, '#d6dade', '#6a7078'); g.strokeStyle = 'rgba(30,34,40,.6)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(150, 0); g.lineTo(-110, 0); g.stroke(); shipBody(g, R, mirror([[60, 0], [20, -10], [-70, -26], [-96, -26], [-96, 0]]), 80, '#e0e3e7', '#7b818a'); shipBody(g, R, mirror([[-58, 0], [-60, -18], [-86, -20], [-90, 0]]), 30, '#eef0f2', '#8c929a'); g.fillStyle = '#ccd'; g.beginPath(); g.arc(-80, -14, 4, 0, TAU); g.arc(-80, 14, 4, 0, TAU); g.fill(); for (const y of [-50, -26, 0, 26, 50]) { g.fillStyle = '#8f8'; g.fillRect(-113, y - 4, 4, 8); } },
  station: (g, R) => { const gr = g.createRadialGradient(-50, -50, 10, 0, 0, 142); gr.addColorStop(0, '#c4c8ce'); gr.addColorStop(0.7, '#6e737b'); gr.addColorStop(1, '#2f3238'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 140, 0, TAU); g.fill(); g.save(); g.beginPath(); g.arc(0, 0, 140, 0, TAU); g.clip(); panelLines(g, R, 120, -140, 140, -140, 140); greeble(g, R, 400, -140, 140, -140, 140); for (let k = -4; k <= 4; k++) { g.strokeStyle = 'rgba(20,22,28,.35)'; g.beginPath(); g.ellipse(0, 0, 140, abs(k) * 34 + 1, 0, 0, TAU); g.stroke(); } g.fillStyle = 'rgba(15,16,20,.85)'; g.fillRect(-140, -4, 280, 8); g.restore(); const dg = g.createRadialGradient(46, -54, 2, 46, -54, 30); dg.addColorStop(0, '#5f6'); dg.addColorStop(0.25, '#445'); dg.addColorStop(1, '#1f2126'); g.fillStyle = dg; g.beginPath(); g.arc(46, -54, 28, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.stroke(); },
};
const ESIZE = { probe: [40, 40], fighter: [40, 44], interceptor: [40, 44], bomber: [50, 40], raider: [56, 44], mine: [32, 32], gunship: [100, 56], frigate: [190, 72], destroyer: [270, 170], station: [290, 290] };
function enemySprite(t) { const T = ETYPES[t], k = T.id; if (!ESPR[k]) return null; const [w, h] = ESIZE[k]; return spr('e' + k, w, h, ESPR[k]); }
function rockSprite(r, seed) { return spr('rock' + seed % 6 + '_' + round(r / 6), r * 2.4, r * 2.4, g => { const R = rng(seed); const pts = []; for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, d = r * (0.75 + R() * 0.3); pts.push([cos(a) * d, sin(a) * d]); } poly(g, pts); const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r); gr.addColorStop(0, '#8a7a68'); gr.addColorStop(1, '#2e2620'); g.fillStyle = gr; g.fill(); for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc((R() - .5) * r, (R() - .5) * r, 2 + R() * r * 0.2, 0, TAU); g.fill(); } }); }
const ASPR = {
  fr: () => spr('afr', 90, 50, (g, R) => { shipBody(g, R, mirror([[40, 0], [34, -10], [-30, -12], [-40, -8]]), 40, '#c9c0a8', '#6b6250'); for (let i = 0; i < 4; i++) { g.fillStyle = ['#7a6040', '#4a6a7a', '#7a4a40', '#5a7a4a'][i]; g.fillRect(-26 + i * 14, -18, 12, 8); g.fillRect(-26 + i * 14, 10, 12, 8); } g.fillStyle = '#9fe'; g.fillRect(34, -3, 5, 6); g.fillStyle = '#6cf'; g.fillRect(-43, -6, 3, 12); }),
  fs: () => spr('afs', 200, 200, (g, R) => { g.strokeStyle = '#99a3ad'; g.lineWidth = 14; g.beginPath(); g.arc(0, 0, 80, 0, TAU); g.stroke(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 80, 0, TAU); g.stroke(); for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * PI / 2); g.fillStyle = '#7d868f'; g.fillRect(16, -4, 60, 8); g.restore(); } const gr = g.createRadialGradient(-6, -6, 2, 0, 0, 22); gr.addColorStop(0, '#e6eaee'); gr.addColorStop(1, '#5b636b'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.fill(); g.fillStyle = '#5cf'; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.fillRect(cos(a) * 80 - 1.5, sin(a) * 80 - 1.5, 3, 3); } }),
  pod: () => spr('apod', 40, 30, (g, R) => { shipBody(g, R, mirror([[14, 0], [10, -7], [-12, -8], [-14, -4]]), 14, '#e8e2d0', '#857a60'); g.fillStyle = '#6cf'; g.fillRect(4, -3, 6, 6); }),
};
// ---------- planets ----------
const PAL = { rocky: ['#9b7b5d', '#5b4636', '#c9a77f'], ice: ['#cfe8f5', '#7ea8c4', '#ffffff'], lava: ['#4a1d10', '#ff5a1a', '#ffb347'], ocean: ['#1d5fa8', '#0f3566', '#4fbf6a'], gas: ['#d9a86a', '#a2643a', '#f2dcb0'], desert: ['#e0b878', '#a7743d', '#f6dca4'], toxic: ['#7fae3a', '#3d5e1d', '#c8f06a'] };
const ATM = { rocky: '#ffc89a', ice: '#bfeaff', lava: '#ff7a3a', ocean: '#7fc8ff', gas: '#ffd9a0', desert: '#ffe0a8', toxic: '#c8ff7a' };
function planetCanvas(pl, size) {
  const key = 'pl_' + pl.seed + '_' + size; if (SPR[key]) return SPR[key];
  const c = SPR[key] = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), R = rng(pl.seed), r = size * 0.38, C = size / 2, p = PAL[pl.kind] || PAL.rocky;
  const at = g.createRadialGradient(C, C, r * 0.95, C, C, r * 1.25); at.addColorStop(0, ATM[pl.kind] + '66'); at.addColorStop(1, ATM[pl.kind] + '00'); g.fillStyle = at; g.fillRect(0, 0, size, size);
  g.save(); g.beginPath(); g.arc(C, C, r, 0, TAU); g.clip(); g.fillStyle = p[0]; g.fillRect(0, 0, size, size);
  if (pl.kind === 'gas') { for (let i = 0; i < 18; i++) { g.fillStyle = (R() < 0.5 ? p[1] : p[2]) + '88'; const y = C - r + R() * 2 * r, h = 4 + R() * r * 0.18; g.fillRect(0, y, size, h); } g.fillStyle = p[1] + 'cc'; g.beginPath(); g.ellipse(C + r * 0.3, C + r * 0.25, r * 0.16, r * 0.09, 0, 0, TAU); g.fill(); }
  else { for (let i = 0; i < 90; i++) { const x = C + (R() - .5) * 2 * r, y = C + (R() - .5) * 2 * r, rr = 3 + R() * r * 0.28; g.fillStyle = (R() < 0.5 ? p[1] : p[2]) + (R() < 0.5 ? '66' : '44'); g.beginPath(); g.ellipse(x, y, rr * (1 + R()), rr, R() * PI, 0, TAU); g.fill(); }
    if (pl.kind === 'ocean' || pl.kind === 'ice') for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(C + (R() - .5) * 2 * r, C + (R() - .5) * 2 * r, 10 + R() * r * 0.3, 3 + R() * 6, R() * 0.4, 0, TAU); g.fill(); }
    if (pl.kind === 'lava') for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(255,170,60,.5)'; g.lineWidth = 1 + R() * 2; g.beginPath(); let x = C + (R() - .5) * 2 * r, y = C + (R() - .5) * 2 * r; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - .5) * 30; y += (R() - .5) * 30; g.lineTo(x, y); } g.stroke(); } }
  const sh = g.createRadialGradient(C - r * 0.45, C - r * 0.45, r * 0.1, C, C, r * 1.05); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.82)'); g.fillStyle = sh; g.fillRect(0, 0, size, size); g.restore();
  if (pl.kind === 'gas' || R() < 0.2) { g.strokeStyle = 'rgba(230,210,170,.45)'; g.lineWidth = size * 0.02; g.beginPath(); g.ellipse(C, C, r * 1.6, r * 0.32, -0.3, 0, TAU); g.stroke(); }
  return c;
}
// starfield + nebula
const STARS = []; for (let l = 0; l < 3; l++) for (let i = 0; i < 120; i++) STARS.push({ l, x: random() * 2000, y: random() * 2000, s: random() * 1.3 + 0.3 + l * 0.35, c: ['#9bf', '#fff', '#ffd', '#cdf'][floor(random() * 4)] });
const neb = document.createElement('canvas'); neb.width = neb.height = 512; { const g = neb.getContext('2d'); for (let i = 0; i < 9; i++) { const x = random() * 512, y = random() * 512, r = 80 + random() * 160, col = ['#3a1a6a', '#6a1a3a', '#1a3a6a', '#2a1050'][i % 4]; for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); } } }
const glowC = {}; function glow(col, r) { const k = col + r; if (glowC[k]) return glowC[k]; const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, col); gr.addColorStop(0.35, col + '88'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return glowC[k] = c; }

// ---------- net ----------
function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(url);
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', name: $('name').value.trim(), cid, room: me.code && !me.pub ? me.code : wantedRoom, role: me.role >= 0 ? me.role : prefRole })); };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.t === 's') onSnap(m); else if (m.t === 'me') onMe(m); else if (m.t === 'toast') toast(m.m, '#ffd54a'); };
  ws.onclose = () => { if (joined) { toast('Connection lost: reconnecting…', '#f88'); setTimeout(connect, 1200); } };
}
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function onMe(m) {
  const roleChanged = m.role !== me.role; Object.assign(me, m); localStorage.setItem('tss_cid', m.cid); cid = m.cid;
  if (roleChanged) { showCard(); abKey = ''; if (lastSnap) thr = lastSnap.sh.thr; upTree = TREE_OF[me.role]; }
  if (!$('upp').classList.contains('hide')) renderUp();
  if (!$('rolesp').classList.contains('hide')) renderRoles();
}
function onSnap(m) {
  m.tm = m.T; const est = m.T - performance.now() / 1000;
  offset = offset == null || abs(est - offset) > 1 ? est : (est > offset ? offset + (est - offset) * 0.3 : offset + (est - offset) * 0.03);
  m.eMap = new Map(m.e.map(e => [e[0], e])); m.bMap = new Map(m.eb.map(b => [b[0], b])); m.pMap = new Map(m.pp.map(p => [p[0], p])); m.aMap = new Map(m.al.map(a => [a[0], a])); m.kMap = new Map(m.pk.map(p => [p[0], p]));
  const prev = lastSnap; lastSnap = m; snaps.push(m); if (snaps.length > 30) snaps.shift();
  if (!prev || prev.ph !== m.ph) phaseChange(prev ? prev.ph : '', m.ph, m);
  hudDom(m);
}
const hitT = new Map(), floaters = [];
function evName(i) { const c = lastSnap && lastSnap.crew[i]; return c ? c[0] : RNAME[i]; }
function processEvents(s) {
  for (const e of s.ev) {
    const k = e[0];
    if (k === 'b') { bolts.set(e[1], { x: e[2], y: e[3], vx: e[4], vy: e[5], kind: e[6], life: e[7] }); SFX.laser(e[6], e[2]); if (e[6] !== 4) P({ k: 2, x: e[2], y: e[3], life: 0.06, max: 0.06, r: 10, c: PLAYER_RED }); }
    else if (k === 'x') { const b = bolts.get(e[1]); if (b) { sparks(b.x, b.y, 4, '#ff8a60', 140, 0.25, 1.5); bolts.delete(e[1]); } }
    else if (k === 'ef') { P({ k: 2, x: e[1], y: e[2], life: e[4] ? 0.25 : 0.08, max: e[4] ? 0.25 : 0.08, r: e[4] ? 30 : 12, c: ENEMY_GREEN }); SFX.elaser(e[3], e[1], e[4]); }
    else if (k === 'boom') explosion(e[1], e[2], e[3], e[4]);
    else if (k === 'hit') hitT.set(e[3], performance.now());
    else if (k === 'arm') { sparks(e[1], e[2], 5, '#cfe6ff', 160, 0.25, 1.5); SFX.armor(e[1]); }
    else if (k === 'pk') { explosion(e[3], e[4], 1, 14); toast('💥 Enemy gun port destroyed', '#ffcf6a'); }
    else if (k === 'pd') { sparks(e[1], e[2], 6, e[3] ? '#ffaa33' : ENEMY_GREEN, 160, 0.25, 1.5); SFX.pd(e[1]); }
    else if (k === 'blk') { const s2 = lastSnap ? lastSnap.sh : null; ring(e[1], e[2], 2, 22, 0.25, MODE_C[s2 ? s2.sm : 0], 2); sparks(e[1], e[2], 5, MODE_C[s2 ? s2.sm : 0], 120, 0.25, 1.5); SFX.block(e[3], e[1]); }
    else if (k === 'graze') { sparks(e[1], e[2], 6, '#fff', 150, 0.3, 1.5); }
    else if (k === 'sh') { sparks(e[1], e[2], 14, '#ff6a3a', 260, 0.5, 2); SFX.hit(); shake = max(shake, 9); if (e[3] === me.role) { flash = 0.35; flashC = '#f00'; } }
    else if (k === 'sd') { toast('⚠ ' + PORT_NAMES[e[1]] + ' DESTROYED', '#f66'); SFX.alarm(); if (e[1] === me.role) banner('YOUR STATION IS DOWN<br><span style="font-size:.5em">hold FIRE to self-patch · the Repair crew sees it too</span>', 2.6); }
    else if (k === 'sr') { toast('✔ ' + PORT_NAMES[e[1]] + ' back online', '#7f7'); SFX.fixed(); }
    else if (k === 'flip') { if (me.role === SHIELD) SFX.flip(e[1]); }
    else if (k === 'pip') { if (me.role === ENG) SFX.pip(); }
    else if (k === 'ab') { const a = ABIL[e[2]]; if (e[1] === me.role) SFX.ability(); else if (a && a.buff) toast('⚡ ' + evName(e[1]) + ': ' + a.n, '#ffd54a'); if (e[2] === 'cry') { banner('⚔ BATTLE CRY', 1.4); SFX.buff(); } if (e[2] === 'aegis' && e[1] !== me.role) SFX.buff(); }
    else if (k === 'buff') { if (e[2] === me.role) { banner(e[1] === 'reroute' ? '⚡ ENGINE POWER REROUTED TO YOU<br><span style="font-size:.5em">+50% fire rate · faster turret · +30% damage</span>' : '💉 STIM: +40% station speed', 1.8); SFX.buff(); } }
    else if (k === 'bl') SFX.bomb();
    else if (k === 'launch') { if (me.role === REPAIR) SFX.launch(); }
    else if (k === 'rk') SFX.rocket();
    else if (k === 'chg') SFX.charge();
    else if (k === 'pick') { if (e[1]) { SFX.core(); toast('◆ Crew core collected!', '#6df'); } else SFX.coin(); if (cur) floaters.push({ x: cur.x, y: cur.y - 40, t: 1, s: e[1] ? '+1 ◆' : '+' + e[2] + ' ¢', c: e[1] ? '#6df' : '#ffd54a' }); }
    else if (k === 'jump') { ring(e[1], e[2], 4, 120, 0.6, '#9cf', 4); toast('🚀 Freighter jumped to safety', '#9cf'); }
    else if (k === 'resc') { ring(e[1], e[2], 4, 80, 0.5, '#7f7', 3); toast('🛟 Hostage pod rescued', '#7f7'); SFX.fixed(); }
    else if (k === 'wave') { banner('WAVE ' + e[1], 1.5); SFX.wave(); }
    else if (k === 'boss') { banner('⚠ FLAGSHIP INBOUND', 2.2); SFX.alarm(); }
    else if (k === 'ms') { banner(e[1] + '<br><span style="font-size:.45em">' + (MTYPES[e[2]] || {}).n + '</span>', 2.4); SFX.wave(); }
    else if (k === 'win') { banner('MISSION COMPLETE', 2.4); SFX.win(); }
    else if (k === 'lose') { banner('SHIP LOST', 2.4); SFX.lose(); }
    else if (k === 'mk') { toast('🛠 Ship upgraded to ' + MK_NAMES[e[1]] + ': every station gets a new weapon port', '#6df'); SFX.core(); }
    else if (k === 'join') toast('👤 ' + e[1] + ' joined as ' + RNAME[e[2]]);
    else if (k === 'leave') toast(e[1] + ' left · a bot took over ' + RNAME[e[2]], '#99a');
    else if (k === 'swap') toast(e[1] + ' moved to ' + RNAME[e[2]]);
  }
}
function interp() {
  if (!snaps.length) return null;
  const rt = performance.now() / 1000 + offset - 0.11;
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].tm <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  for (const s of snaps) if (!s.done && s.tm <= rt) { s.done = true; processEvents(s); }
  const t = b.tm > a.tm ? clamp((rt - a.tm) / (b.tm - a.tm), 0, 1.2) : 1;
  const A_ = a.sh, B = b.sh, L = (p, q, i) => lerp(p[i], q[i], t);
  const o = { s: b, sh: B, x: lerp(A_.x, B.x, t), y: lerp(A_.y, B.y, t), a: lerpA(A_.a, B.a, t), sa: lerpA(A_.sa, B.sa, t), tl: lerpA(A_.tl, B.tl, t), tr: lerpA(A_.tr, B.tr, t) };
  o.dr = B.dr.map((d, i) => d && A_.dr[i] ? [lerp(A_.dr[i][0], d[0], t), lerp(A_.dr[i][1], d[1], t)] : d);
  o.sd = B.sd && A_.sd ? [lerp(A_.sd[0], B.sd[0], t), lerp(A_.sd[1], B.sd[1], t)] : B.sd;
  o.e = b.e.map(e => { const p = a.eMap.get(e[0]); if (!p) return e; const n = e.slice(); n[2] = L(p, e, 2); n[3] = L(p, e, 3); n[4] = lerpA(p[4], e[4], t); if (e[8] && p[8]) n[8] = e[8].map((q, k) => p[8][k] ? [q[0], lerpA(p[8][k][1], q[1], t), q[2]] : q); return n; });
  o.eb = b.eb.map(q => { const p = a.bMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), q[3], q[4], q[5]] : q; });
  o.pp = b.pp.map(q => { const p = a.pMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), lerpA(p[3], q[3], t), q[4]] : q; });
  o.al = b.al.map(q => { const p = a.aMap.get(q[0]); return p ? [q[0], q[1], L(p, q, 2), L(p, q, 3), lerpA(p[4], q[4], t), q[5], q[6]] : q; });
  o.pk = b.pk.map(q => { const p = a.kMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), q[3]] : q; });
  while (snaps.length > 2 && snaps[1].tm < rt - 0.5) snaps.shift();
  return o;
}

// ---------- input ----------
let lastAct = performance.now(); for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, () => lastAct = performance.now(), { passive: true, capture: true });
const K = {}; let mouse = { x: 0, y: 0, down: 0 }, thr = 0.65, rtSel = -1, acts = [];
const joy = { on: 0, id: null, vx: 0, vy: 0, lastA: -PI / 2 }, tb = { f: 0, as: 0 };
function act(a) { acts.push(a); }
function setThr(v) { thr = clamp(v, 0.25, 1); }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && !joined) launch(); return; }
  const k = e.key.toLowerCase(); if (k === ' ' || k === 'tab') e.preventDefault(); if (K[k]) return; K[k] = 1; audioInit(); if (!joined) return;
  if (k === 'q' || k === 'e' || k === 'r') act(k);
  if (k === ' ') act('alt');
  if (k === 'm') setMute(!A.muted); if (k === 'n') setMusic(!A.music);
  if (k === 'h' || k === '?') toggleCard(); if (k === 'tab') togglePanel('rolesp'); if (k === 'u') togglePanel('upp');
  if (k === 'escape') { $('rolesp').classList.add('hide'); $('upp').classList.add('hide'); $('card').classList.add('hide'); }
  if (me.role === ENG && k >= '1' && k <= '4') act('p' + k);
  if (me.role === REPAIR && k >= '0' && k <= '6') rtSel = k === '0' ? 6 : +k - 1;
  if (me.role === ENG && (k === 'w' || k === 'arrowup')) setThr(thr + 0.125); if (me.role === ENG && (k === 's' || k === 'arrowdown')) setThr(thr - 0.125);
});
addEventListener('keyup', e => { K[e.key.toLowerCase()] = 0; });
addEventListener('blur', () => { for (const k in K) K[k] = 0; mouse.down = 0; });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { audioInit(); mouse.x = e.clientX; mouse.y = e.clientY; if (e.button === 2) act('alt'); else mouse.down = 1; });
addEventListener('mouseup', e => { if (e.button !== 2) mouse.down = 0; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { if (me.role === ENG) setThr(thr - Math.sign(e.deltaY) * 0.0625); e.preventDefault(); }, { passive: false });
function setupTouch() {
  if (!isTouch) return; $('touch').classList.remove('hide');
  const jz = $('joy'), kn = $('knob');
  const upd = t => { const r = jz.getBoundingClientRect(), cxm = r.left + r.width / 2, cym = r.top + r.height / 2; let dx = (t.clientX - cxm) / (r.width / 2), dy = (t.clientY - cym) / (r.height / 2); const l = hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.vx = dx; joy.vy = dy; kn.style.transform = `translate(${dx * 42}px,${dy * 42}px)`; if (l > 0.2) joy.lastA = atan2(dy, dx); };
  jz.addEventListener('touchstart', e => { audioInit(); const t = e.changedTouches[0]; joy.on = 1; joy.id = t.identifier; upd(t); e.preventDefault(); }, { passive: false });
  jz.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === joy.id) upd(t); e.preventDefault(); }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === joy.id) { joy.on = 0; joy.vx = joy.vy = 0; kn.style.transform = ''; } };
  jz.addEventListener('touchend', end); jz.addEventListener('touchcancel', end);
  const hold = (id, k) => { const b = $(id); b.addEventListener('touchstart', e => { audioInit(); tb[k] = 1; e.preventDefault(); }, { passive: false }); b.addEventListener('touchend', e => { tb[k] = 0; e.preventDefault(); }, { passive: false }); };
  hold('t-f', 'f'); hold('t-as', 'as');
  const tap = (id, fn) => $(id).addEventListener('touchstart', e => { audioInit(); fn(); e.preventDefault(); }, { passive: false });
  tap('t-q', () => act('q')); tap('t-e', () => act('e')); tap('t-r', () => act('r')); tap('t-alt', () => act('alt')); tap('t-up', () => togglePanel('upp'));
}
function aimWorld(s) {
  if (isTouch && s) {
    const R = me.role === REPAIR ? 300 : 420, l = hypot(joy.vx, joy.vy);
    if (me.role === REPAIR) return [s.x + joy.vx * R, s.y + joy.vy * R];
    return [s.x + cos(joy.lastA) * R * max(0.4, l), s.y + sin(joy.lastA) * R * max(0.4, l)];
  }
  return [(mouse.x - W / 2) / Z + camX, (mouse.y - H / 2) / Z + camY];
}
setInterval(() => {
  if (!joined || !cur) return;
  const [ax, ay] = aimWorld(cur);
  const fire = mouse.down || K['enter'] || tb.f || (isTouch && joy.on && hypot(joy.vx, joy.vy) > 0.85 && (me.role === GUNL || me.role === GUNR || me.role === PILOT));
  send({ t: 'i', ax: round(ax), ay: round(ay), f: fire ? 1 : 0, as: K.f || tb.as ? 1 : 0, thr: round(thr * 1000) / 1000, rt: rtSel, idle: performance.now() - lastAct > 30000 ? 1 : 0, a: acts.splice(0, 6) });
}, 50);

// ---------- UI ----------
function toast(m, c) { const d = document.createElement('div'); d.innerHTML = m; if (c) d.style.color = c; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3300); while ($('toasts').children.length > 4) $('toasts').firstChild.remove(); }
let bannerT = 0; function banner(t, d = 2) { $('banner').innerHTML = t; bannerT = d; }
let cardTimer = null;
function abilityList(r) { return TREES[TREE_OF[r]].br.map(b => { const n = b.nodes.find(x => x[3]); return `<b class="y">${b.k}</b> ${n[1]}`; }).join(' · '); }
function showCard() {
  const r = me.role; if (r < 0) return;
  $('card').innerHTML = `<span class="x">H toggles · click to close</span><h2>${RICON[r]} YOU ARE: ${RNAME[r]} · ${PORT_NAMES[r]}</h2><div>${ROLE_HELP[r]}</div><div style="margin-top:4px">Abilities: ${abilityList(r)}</div><div class="small" style="margin-top:6px;color:#bb9">${COMMON}${isTouch ? '<br>Touch: stick aims · FIRE · Q/E/R abilities · FLIP · ASSIST · ★ upgrades' : ''}</div>`;
  $('card').classList.remove('hide'); clearTimeout(cardTimer); cardTimer = setTimeout(() => $('card').classList.add('hide'), 10000);
}
function toggleCard() { if ($('card').classList.contains('hide')) showCard(); else $('card').classList.add('hide'); }
$('card').onclick = () => $('card').classList.add('hide');
function togglePanel(id) { const p = $(id), was = p.classList.contains('hide'); $('rolesp').classList.add('hide'); $('upp').classList.add('hide'); if (was) { p.classList.remove('hide'); id === 'rolesp' ? renderRoles() : renderUp(); } }
const closeBtn = '<div style="text-align:right;margin-top:10px"><button data-close>Close (Esc)</button></div>';
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) e.target.closest('.panel').classList.add('hide'); });
function renderRoles() {
  const s = lastSnap; if (!s) return;
  const order = [PILOT, GUNL, GUNR, SHIELD, ENG, REPAIR];
  $('rolesp').innerHTML = '<h2>⇄ SWITCH STATION</h2><div class="small" style="margin-bottom:8px">Take any bot seat instantly. Credits are yours; each role has its own skill tree.</div><div class="rgrid">' + order.map(i => { const c = s.crew[i], mine = i === me.role; return `<button data-r="${i}" ${mine ? 'style="border-color:#ffd54a;color:#ffd54a"' : ''}>${RICON[i]} ${RNAME[i]}<small>${PORT_NAMES[i]} · ${mine ? 'YOU' : c[1] ? '🤖 ' + c[0] + ' (bot): take over' : '👤 ' + c[0]}</small></button>`; }).join('') + '</div>' + closeBtn;
  $('rolesp').querySelectorAll('[data-r]').forEach(b => b.onclick = () => { send({ t: 'role', role: +b.dataset.r }); SFX.ui(); setTimeout(() => $('rolesp').classList.add('hide'), 150); });
}
// ----- upgrade screen -----
let upTree = 'pilot';
const TREE_LABEL = { pilot: 'Pilot', gun: 'Gunners', engineer: 'Engineer', shield: 'Shields', repair: 'Repair/Drone' };
function renderUp() {
  if (me.role < 0 || !me.tr || !lastSnap) return;
  const s = lastSnap, mk = s.mk, T = TREES[upTree], P = me.tr[upTree], inMission = s.ph === 'mission' || s.ph === 'result';
  const btn = (attrs, html, dis, cls = '') => `<button class="nd ${cls}" ${attrs} ${dis ? 'disabled' : ''}>${html}</button>`;
  let h = `<h2>★ UPGRADES · <span class="y">${me.cr} ¢</span> · <span class="c">${s.co} ◆ crew cores</span> · ${MK_NAMES[mk]}</h2>`;
  h += `<div class="row" style="margin:4px 0">${Object.keys(TREES).map(k => `<button data-tree="${k}" style="flex:0 0 auto;min-width:0;${k === upTree ? 'border-color:#ffd54a;color:#ffd54a' : ''}">${TREE_LABEL[k]}${k === TREE_OF[me.role] ? ' (you)' : ''}</button>`).join('')}</div>`;
  if (inMission) h += '<div class="small r">Purchases unlock after the mission. You can still plan here.</div>';
  const nextMk = mk + 1;
  h += `<div class="small">Credits drop from destroyed enemies (fly close to collect) plus a completion bonus; the whole crew earns the same. Crew cores (◆) are rare and shared: they buy ship upgrades that give <b>every station</b> an extra weapon port.</div>`;
  h += `<div class="row">${nextMk <= 2 ? `<button data-mk ${s.co < MK_COST[nextMk] || inMission ? 'disabled' : ''} style="border-color:#6df">🛠 Upgrade ship to <b>${MK_NAMES[nextMk]}</b>: ${MK_COST[nextMk]} ◆ (crew-wide)</button>` : '<div class="small g">Ship fully upgraded (Mk III)</div>'}</div>`;
  h += '<div class="cols">' + T.br.map((b, bi) => `<div class="col"><h4>${b.n} <span class="y">[${b.k}]</span></h4>` + b.nodes.map((n, j) => { const own = P.n[n[0]], prevOwn = j === 0 || P.n[b.nodes[j - 1][0]], mkReq = n[4] || 0, can = !own && prevOwn && mk >= mkReq && me.cr >= NODE_COST[j] && !inMission; return btn(`data-buy="node" data-id="${n[0]}"`, `${own ? '✔ ' : ''}<b>${n[1]}</b>${n[3] ? ` <span class="y">[${b.k}]</span>` : ''} ${own ? '' : `· ${NODE_COST[j]}¢`}${mkReq > mk ? ` · <span class="c">needs ${MK_NAMES[mkReq]}</span>` : ''}<small>${n[2]}</small>`, !can, (own ? 'own ' : '') + (n[3] ? 'act' : '')); }).join('') + '</div>').join('') + '</div>';
  h += '<div class="row">' + T.inf.map(x => { const lv = P.i[x[0]] || 0, c = infCost(lv); return btn(`data-buy="inf" data-id="${x[0]}"`, `<b>${x[1]}</b> · Lv ${lv} · ${c}¢<small>${x[2]} per level, no cap</small>`, me.cr < c || inMission); }).join('') + '</div>';
  h += '<div class="row">' + T.big.map(x => { const own = P.b[x[0]]; return btn(`data-buy="big" data-id="${x[0]}"`, `${own ? '✔ ' : '★ '}<b>${x[1]}</b> ${own ? '' : '· ' + x[3] + '¢'}${x[4] > mk ? ` · <span class="c">needs ${MK_NAMES[x[4]]}</span>` : ''}<small>${x[2]}</small>`, own || me.cr < x[3] || x[4] > mk || inMission, own ? 'own' : ''); }).join('') + '</div>';
  h += '<div class="row">' + [0, 1].map(sl => `<div class="col"><h4>Weapon port ${sl + 1} ${sl >= mk ? `<span class="c">(needs ${MK_NAMES[sl + 1]})</span>` : ''}</h4>${T.ports.map(p => btn(`data-port="${sl}" data-id="${p[0]}"`, `${P.p[sl] === p[0] ? '✔ ' : ''}<b>${p[1]}</b><small>${p[2]}</small>`, sl >= mk || inMission, P.p[sl] === p[0] ? 'own' : '')).join('')}</div>`).join('') + '</div>';
  h += '<div id="upfoot"><span id="upst" class="small"></span><span><button data-close>Close (U)</button> <button id="rdy" class="hide">READY ✔</button></span></div>';
  $('upp').innerHTML = h; upFoot();
  $('upp').querySelectorAll('[data-tree]').forEach(b => b.onclick = () => { upTree = b.dataset.tree; SFX.ui(); renderUp(); });
  $('upp').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { send({ t: 'buy', tree: upTree, kind: b.dataset.buy, id: b.dataset.id }); SFX.coin(); });
  $('upp').querySelectorAll('[data-port]').forEach(b => b.onclick = () => { send({ t: 'buy', tree: upTree, kind: 'port', id: b.dataset.id, slot: +b.dataset.port }); SFX.ui(); });
  const mb = $('upp').querySelector('[data-mk]'); if (mb) mb.onclick = () => { send({ t: 'mk' }); SFX.core(); };
  $('rdy').onclick = () => { const r = lastSnap && lastSnap.rdy && lastSnap.rdy.includes(me.pid); send({ t: 'ready', v: r ? 0 : 1 }); SFX.ui(); };
}
function upFoot() {
  const s = lastSnap, st = $('upst'), rb = $('rdy'); if (!s || !st) return;
  if (s.ph === 'upgrade') { const hum = s.crew.filter(c => !c[1]).length, r = (s.rdy || []).length, mine = (s.rdy || []).includes(me.pid); rb.classList.remove('hide'); rb.textContent = mine ? 'READY ✔ (undo)' : 'READY ▶'; rb.style.background = mine ? 'rgba(20,80,30,.9)' : ''; st.innerHTML = `Next: star map in <b class="y">${Math.ceil(s.pt)}s</b> · ready ${r}/${hum} players · bots are always ready`; }
  else { rb.classList.add('hide'); st.textContent = s.ph === 'map' ? 'Voting on the star map…' : 'Mission in progress'; }
}
// ----- star map -----
function renderMap(s) {
  $('maph').innerHTML = '★ STAR MAP · choose the next mission · <span class="y">' + Math.ceil(s.pt) + 's</span>';
  const hum = s.crew.filter(c => !c[1]).length;
  $('mapsub').innerHTML = `Campaign: ${s.md} main missions cleared · ${MK_NAMES[s.mk]} · ${s.co} ◆ cores<br>Vote weight: <b class="y">Pilot ${s.pw}</b> (live players − 1) · everyone else 1 · ${hum} player${hum === 1 ? '' : 's'} aboard. Launches when all players vote or time runs out.`;
  const key = s.opts.map(o => o.id).join() + '|' + JSON.stringify(s.votes) + s.my;
  if (renderMap.key === key) return; renderMap.key = key;
  $('mcards').innerHTML = s.opts.map((o, i) => { const v = s.votes[o.id] || 0, M = MTYPES[o.type]; return `<div class="mc ${o.kind} ${s.my === o.id ? 'voted' : ''}" data-id="${o.id}"><canvas width="240" height="120" data-pl="${i}"></canvas><span class="${o.kind === 'main' ? 'y' : 'small'}">${o.kind === 'main' ? '★ MAIN MISSION' : '◇ SIDE MISSION'}</span> · <span class="d${o.diff}">${DIFFS[o.diff].n}</span> · Lv ${o.level}<b>${o.planet.name}</b><span class="c">${M.n}</span><br><span class="small">${M.d}${o.mod && o.mod !== 'none' ? ' · ☄ ' + o.mod : ''}</span><br><span class="small">Reward ×${DIFFS[o.diff].m}${o.diff >= 2 || o.kind === 'main' ? ' · +1 ◆ core' : ''}</span><br><span class="v">${v ? '▮'.repeat(min(v, 12)) + ' ' + v : ''}</span></div>`; }).join('');
  $('mcards').querySelectorAll('canvas[data-pl]').forEach(c => { const o = s.opts[+c.dataset.pl], g = c.getContext('2d'); g.drawImage(neb, 0, 0, 240, 120); for (let i = 0; i < 30; i++) { g.fillStyle = '#fff'; g.fillRect((i * 97) % 240, (i * 53) % 120, 1, 1); } g.drawImage(planetCanvas(o.planet, 256), 40, -40, 200, 200); });
  $('mcards').querySelectorAll('.mc').forEach(d => d.onclick = () => { send({ t: 'vote', id: d.dataset.id }); SFX.ui(); });
}
function phaseChange(from, to, s) {
  $('map').classList.toggle('hide', to !== 'map'); if (to === 'map') renderMap.key = '';
  if (to === 'upgrade') { upTree = TREE_OF[me.role] || 'pilot'; $('rolesp').classList.add('hide'); $('upp').classList.remove('hide'); renderUp(); }
  if (from === 'upgrade' && to === 'map') $('upp').classList.add('hide');
  if (to === 'result' && s.res) setTimeout(() => { const r = s.res; banner((r.win ? 'MISSION COMPLETE' : 'SHIP LOST') + `<br><span style="font-size:.45em">${r.win ? `+${r.bonus} ¢ completion bonus${r.cores ? ' · +' + r.cores + ' ◆' : ''}` : 'Regroup, upgrade, try again'}</span>`, 2.6); }, 300);
  if (to === 'mission' && !$('upp').classList.contains('hide')) $('upp').classList.add('hide');
}
// ----- live HUD (DOM) -----
let abKey = '';
function hudDom(s) {
  const M = s.mi, sh = s.sh;
  let obj = '';
  if (s.ph === 'mission' && M) {
    if (M.type === 'pirates' || M.type === 'defend') obj = `Wave ${M.wave}/${M.waves} · ${M.left} hostiles`;
    else if (M.type === 'flagship') obj = M.wave < M.waves ? `Escort wave ${M.wave}/${M.waves}` : `Destroy the flagship's gun ports · ${M.left} hostiles`;
    else if (M.type === 'station') obj = `Knock out every station battery · ${M.left} hostiles`;
    else if (M.type === 'hostages') obj = `Pods rescued ${M.got}/${M.need} (lost ${M.lost}) · fly over a pod`;
    else if (M.type === 'escort') obj = `Freighters home ${M.got} · ${s.al.filter(a => a[1] === 'fr').length} en route`;
  }
  $('mi').innerHTML = s.ph === 'mission' && M ? `<b>${M.planet.name}</b> · ${MTYPES[M.type].n} · <span class="d${M.diff}">${DIFFS[M.diff].n}</span> Lv ${M.lv}<br>${obj}<br><span class="y">${me.cr} ¢</span> · <span class="c">${s.co} ◆</span> · ${MK_NAMES[s.mk]} · ship ${me.code}${me.pub ? ' (public)' : ''}`
    : `<b>${s.ph === 'map' ? 'STAR MAP' : s.ph === 'upgrade' ? 'UPGRADE BAY' : 'DEBRIEF'}</b> · <span class="y">${me.cr} ¢</span> · <span class="c">${s.co} ◆</span> · ship ${me.code}`;
  $('crew').innerHTML = s.crew.map((c, i) => `<div class="${i === me.role ? 'me' : c[1] ? 'bot' : ''} ${sh.dn[i] ? 'dn' : ''}">${RICON[i]} ${RSHORT[i]} ${c[1] ? '🤖' : '👤'} ${c[0]}${c[4] ? ' (idle·bot)' : ''}${c[3] ? ' 🔧' : ''}${sh.dn[i] ? ' ✖ ' + PORT_NAMES[i] + ' DOWN' : ''}${c[6].length ? ' <span class="y">' + c[6].map(b => '⚡' + b).join(' ') + '</span>' : ''}</div>`).join('');
  if (s.ph === 'map') renderMap(s);
  if (s.ph === 'upgrade' || !$('upp').classList.contains('hide')) upFoot();
  const inM = s.ph === 'mission' && me.role >= 0;
  $('abar').classList.toggle('hide', !inM || isTouch); $('engp').classList.toggle('hide', !(inM && me.role === ENG)); $('repp').classList.toggle('hide', !(inM && me.role === REPAIR));
  if (inM) { if (isTouch) touchLabels(s); else abilityBar(s); if (me.role === ENG) engPanel(s); if (me.role === REPAIR) repPanel(s); }
  const myB = me.role >= 0 ? s.crew[me.role][6] : []; $('buffs').innerHTML = inM && myB.length ? myB.map(b => ({ cry: '⚔ Battle Cry', reroute: '⚡ Rerouted engine power', rhalf: '⚡ Split power', stim: '💉 Stim', over: '🔥 Overcharge', ovl: '⚡ Overload' }[b] || b)).join(' · ') : '';
}
const HINTS = [[['Click', 'nose laser'], ['Aim', 'steer']], [['Click', 'fire turret'], ['F', 'assist']], [['Hold Fire', 'repair in band'], ['1-6 / 0', 'pick target']], [['W/S', 'throttle'], ['1·2·3·4', 'power']], [['Space', 'flip mode'], ['Aim', 'barrier']], [['Click', 'fire turret'], ['F', 'assist']]];
function abilityBar(s) {
  const r = me.role, ab = s.crew[r][5], br = TREES[TREE_OF[r]].br, key = r + '|' + ab.map(a => a ? a[0] : '-').join();
  if (key !== abKey) {
    abKey = key;
    $('abar').innerHTML = br.map((b, i) => { const a = ab[i]; return `<div class="ab ${a ? '' : 'lock'} ${a && ABIL[a[0]].buff ? 'buff' : ''}" data-slot="${i}"><span class="k">${b.k}</span>${a ? ABIL[a[0]].n : b.n + '<br><small>locked · U</small>'}<div class="cdv"></div><div class="cdt"></div></div>`; }).join('') + HINTS[r].map(h => `<div class="ab hint"><span class="k" style="font-size:12px">${h[0]}</span>${h[1]}</div>`).join('') + (r === SHIELD ? `<div class="ab hint" id="modehint"></div>` : '');
    $('abar').querySelectorAll('[data-slot]').forEach(d => { const f = e => { e.preventDefault(); act('qer'[+d.dataset.slot]); }; d.addEventListener('mousedown', f); d.addEventListener('touchstart', f, { passive: false }); });
  }
  $('abar').querySelectorAll('[data-slot]').forEach(d => { const a = ab[+d.dataset.slot]; if (!a) return; const f = a[2] ? a[1] / a[2] : 0; d.querySelector('.cdv').style.height = (f * 100) + '%'; d.querySelector('.cdt').textContent = a[1] > 0 ? Math.ceil(a[1]) : ''; d.classList.toggle('ready', a[1] <= 0); });
  const mh = $('modehint'); if (mh) { mh.innerHTML = `<span class="k" style="font-size:12px;color:${MODE_C[s.sh.sm]}">${MODE_N[s.sh.sm]}</span>${s.sh.sm ? 'blocks missiles+flak' : 'blocks green lasers'}`; mh.style.borderColor = MODE_C[s.sh.sm]; }
}
function touchLabels(s) {
  const ab = s.crew[me.role][5];
  ['q', 'e', 'r'].forEach((k, i) => { const a = ab[i], b = $('t-' + k); const t = a ? (a[1] > 0 ? Math.ceil(a[1]) + 's' : ABIL[a[0]].n.split(' ').pop().slice(0, 7)) : '🔒'; const h = `<b>${k.toUpperCase()}</b><br><small>${t}</small>`; if (b.dataset.h !== h) { b.dataset.h = h; b.innerHTML = h; } b.style.opacity = a && a[1] <= 0 ? 1 : 0.5; });
  $('t-alt').style.display = me.role === SHIELD ? '' : 'none';
}
function engPanel(s) {
  const sh = s.sh, N = ['ENGINES', 'WEAPONS', 'SHIELDS'], C = ['#6cf', '#f66', '#ffd54a'];
  if (!engPanel.built) { engPanel.built = 1; $('pips').innerHTML = N.map((n, k) => `<div><span style="color:${C[k]}">${n}</span><div class="bars">${'<i></i>'.repeat(4)}</div><button data-p="${k + 1}">+ (${k + 1})</button></div>`).join('') + `<div><span>RESET</span><div class="bars" style="justify-content:center;font-size:10px;color:#9ab">2·2·2</div><button data-p="4">(4)</button></div>`; $('pips').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { act('p' + b.dataset.p); }); $('thr-').onclick = () => setThr(thr - 0.125); $('thr+').onclick = () => setThr(thr + 0.125); }
  $('pips').querySelectorAll('.bars').forEach((b, k) => { if (k > 2) return; b.querySelectorAll('i').forEach((i, j) => i.classList.toggle('on', j < sh.pip[k])); });
  $('thrbar').style.width = (thr * 100) + '%';
  $('thrt').innerHTML = `Throttle ${round(thr * 100)}% · speed ${sh.spd}${sh.dn[ENG] ? ' · <span class="r">ENGINES DOWN: stalling</span>' : ''}${sh.dn[PILOT] ? ' · <span class="r">cockpit down: no steering</span>' : ''}`;
}
function repPanel(s) {
  const sh = s.sh, tk = sh.tk, t = tk[0];
  let m;
  if (sh.dn[REPAIR]) m = '<span class="r">⚠ REPAIR BAY IS DOWN.</span> Hold FIRE to self-patch it; crewmates can press F to help.';
  else if (t < 0) m = '<span class="g">All ports nominal.</span> ' + (sh.dr.some(d => d) ? 'Drone deployed: it follows your cursor and auto-fires.' : 'Drone launching…');
  else if (t === 6) m = `Hull at ${round(sh.h / sh.hm * 100)}%. <b>Weld the hull</b>: hold FIRE while the needle is in the green band.`;
  else m = `${sh.dn[t] ? '<span class="r">⚠ ' + PORT_NAMES[t] + ' is DOWN</span>' : '<b class="y">' + PORT_NAMES[t] + ' damaged</b>'} (${RSHORT[t]}: ${s.crew[t][0]}). <b>Hold FIRE while the needle is inside the green band</b> to recalibrate it (~10s).`;
  if (repPanel.m !== m) { $('repmsg').innerHTML = m; repPanel.m = m; }
  const key = sh.dn.join() + rtSel + t + sh.st.map(v => v.toFixed(1)).join();
  if (repPanel.k !== key) { repPanel.k = key; $('tgts').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(i => `<button data-t="${i}" class="${i < 6 && sh.dn[i] ? 'dn' : ''} ${(rtSel === i || (rtSel < 0 && t === i)) ? 'sel' : ''}">${i === 6 ? '0' : i + 1} ${i === 6 ? 'Hull' : PORT_NAMES[i].replace(' Gun Turret', ' Gun')} ${i < 6 ? round(sh.st[i] / sh.mx[i] * 100) + '%' : round(sh.h / sh.hm * 100) + '%'}</button>`).join('') + `<button data-t="-1" class="${rtSel < 0 ? 'sel' : ''}">AUTO priority</button>`; $('tgts').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { rtSel = +b.dataset.t; repPanel.k = ''; SFX.ui(); }); }
}
function drawGauge() {
  if (me.role !== REPAIR || !lastSnap || lastSnap.ph !== 'mission') return;
  const c = $('rg'), g = c.getContext('2d'), w = c.width, h = c.height, tk = lastSnap.sh.tk, T = performance.now() / 1000 + offset;
  g.clearRect(0, 0, w, h); const X = v => (v + 1) / 2 * (w - 20) + 10;
  g.fillStyle = '#0a1420'; g.fillRect(10, 20, w - 20, 34);
  if (tk[0] >= 0) { g.fillStyle = 'rgba(60,255,90,.45)'; g.fillRect(X(tk[1] - tk[2]), 20, X(tk[1] + tk[2]) - X(tk[1] - tk[2]), 34); g.strokeStyle = '#6f6'; g.strokeRect(X(tk[1] - tk[2]), 20, X(tk[1] + tk[2]) - X(tk[1] - tk[2]), 34); }
  const nv = sin(T * 1.7), inb = abs(nv - tk[1]) < tk[2]; g.fillStyle = inb ? '#fff' : '#f84'; g.fillRect(X(nv) - 3, 12, 6, 50);
  g.fillStyle = '#123'; g.fillRect(10, 70, w - 20, 12); g.fillStyle = '#6df'; g.fillRect(10, 70, (w - 20) * clamp(tk[3], 0, 1), 12);
  g.fillStyle = '#9ab'; g.font = '16px monospace'; g.fillText(tk[0] < 0 ? 'NO REPAIR NEEDED' : (inb ? 'IN BAND: HOLD FIRE' : 'wait for the band…'), 12, 14);
}
function launch() {
  if (joined) return; joined = true; audioInit(); localStorage.setItem('tss_name', $('name').value.trim());
  $('intro').classList.add('hide'); $('top').classList.remove('hide'); setupTouch(); connect();
}
const pr = $('prefroles');
pr.innerHTML = [PILOT, GUNL, GUNR, SHIELD, ENG, REPAIR].map(i => `<button data-r="${i}">${RICON[i]} ${RSHORT[i]}</button>`).join('') + '<button data-r="-1" class="sel">ANY</button>';
pr.querySelectorAll('button').forEach(b => b.onclick = () => { prefRole = +b.dataset.r; pr.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b)); });
$('go').onclick = launch;
$('mkpriv').onclick = () => { location.href = '/new'; };
$('joincode').onclick = () => { const c = $('code').value.trim().toUpperCase(); if (c) location.href = '/?room=' + encodeURIComponent(c); };
function invite() { const url = location.origin + '/?room=' + me.code; (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Invite link copied: ' + url), () => prompt('Share this link', url)); }
$('b-inv').onclick = invite; $('b-role').onclick = () => togglePanel('rolesp'); $('b-up').onclick = () => togglePanel('upp'); $('b-help').onclick = toggleCard;
$('b-mute').onclick = () => setMute(!A.muted); $('b-mus').onclick = () => setMusic(!A.music);

// ---------- render ----------
function resize() { DPR = min(devicePixelRatio || 1, isTouch ? 1.5 : 2); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; Z = clamp(min(W, H) / (isTouch ? 740 : 720) * (W > H ? 1 : 1.15), 0.45, 1.6); }
addEventListener('resize', resize); resize();
let lastT = performance.now(), fps = 60, bgPlanet = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = min(0.05, (now - lastT) / 1000); lastT = now; fps = fps * 0.95 + (1 / max(dt, 0.001)) * 0.05;
  cur = interp(); stepParts(dt);
  for (const [id, b] of bolts) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; if (b.life <= 0) bolts.delete(id); }
  for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t -= dt; f.y -= 40 * dt; if (f.t <= 0) floaters.splice(i, 1); }
  if (bannerT > 0) { bannerT -= dt; $('banner').style.opacity = min(1, bannerT * 2); } else $('banner').style.opacity = 0;
  draw(dt, now / 1000); drawGauge();
}
requestAnimationFrame(frame);
function draw(dt, T) {
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.fillStyle = '#04050c'; cx.fillRect(0, 0, W, H);
  const o = cur; if (o) { camX = lerp(camX, o.x + o.sh.vx * 0.25, min(1, dt * 6)); camY = lerp(camY, o.y + o.sh.vy * 0.25, min(1, dt * 6)); }
  shake *= 0.88; const sx = (random() - .5) * shake, sy = (random() - .5) * shake;
  // background
  cx.globalAlpha = 0.9; const nx = -(camX * 0.08) % 512, ny = -(camY * 0.08) % 512; for (let x = nx - 512; x < W; x += 512) for (let y = ny - 512; y < H; y += 512) cx.drawImage(neb, x, y); cx.globalAlpha = 1;
  if (o && o.s.mi && o.s.mi.planet) bgPlanet = o.s.mi.planet; else if (o && o.s.opts) bgPlanet = o.s.opts[0].planet;
  if (bgPlanet) { const sz = min(W, H) * 0.8, pc = planetCanvas(bgPlanet, 512); cx.globalAlpha = 0.6; cx.drawImage(pc, W * 0.8 - camX * 0.02 % 300 - sz / 2, H * 0.22 - camY * 0.02 % 200 - sz / 2, sz, sz); cx.globalAlpha = 1; }
  for (const s of STARS) { const f = 0.15 + s.l * 0.25, x = ((s.x - camX * f) % 2000 + 2000) % 2000, y = ((s.y - camY * f) % 2000 + 2000) % 2000; if (x > W || y > H) continue; cx.fillStyle = s.c; cx.globalAlpha = 0.5 + s.l * 0.2; cx.fillRect(x, y, s.s, s.s); } cx.globalAlpha = 1;
  if (!o) return;
  cx.save(); cx.translate(W / 2 + sx, H / 2 + sy); cx.scale(Z, Z); cx.translate(-camX, -camY);
  drawWorld(o, T); cx.restore();
  drawHUD(o, T);
  if (flash > 0) { flash -= dt; cx.fillStyle = flashC; cx.globalAlpha = max(0, flash) * 0.6; cx.fillRect(0, 0, W, H); cx.globalAlpha = 1; }
}
function streak(x, y, a, len, w, col, glowR) { const dx = cos(a) * len / 2, dy = sin(a) * len / 2; cx.drawImage(glow(col, glowR), x - glowR, y - glowR); cx.strokeStyle = col; cx.lineWidth = w * 2.2; cx.globalAlpha = 0.45; cx.beginPath(); cx.moveTo(x - dx, y - dy); cx.lineTo(x + dx, y + dy); cx.stroke(); cx.globalAlpha = 1; cx.strokeStyle = '#fff'; cx.lineWidth = w * 0.8; cx.beginPath(); cx.moveTo(x - dx * 0.8, y - dy * 0.8); cx.lineTo(x + dx * 0.8, y + dy * 0.8); cx.stroke(); }
function hpBar(x, y, w, f, col) { cx.fillStyle = 'rgba(0,0,0,.6)'; cx.fillRect(x - w / 2, y, w, 4); cx.fillStyle = col; cx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 4); }
function drawWorld(o, T) {
  const s = o.s, sh = o.sh, view = (x, y, r) => abs(x - camX) < W / 2 / Z + r && abs(y - camY) < H / 2 / Z + r;
  // arena edge
  cx.strokeStyle = 'rgba(255,80,80,.25)'; cx.lineWidth = 6; cx.setLineDash([30, 20]); cx.strokeRect(-2600, -2600, 5200, 5200); cx.setLineDash([]);
  // escort jump point
  if (s.mi && s.mi.type === 'escort' && s.ph === 'mission') { const x = s.mi.jx, y = s.mi.jy; for (let i = 0; i < 4; i++) { cx.strokeStyle = `rgba(120,190,255,${0.5 - i * 0.1})`; cx.lineWidth = 4; cx.beginPath(); cx.arc(x, y, 50 + i * 18 + sin(T * 3 + i) * 6, T * (1 + i * 0.3), T * (1 + i * 0.3) + PI * 1.4); cx.stroke(); } cx.fillStyle = '#9cf'; cx.font = 'bold 16px monospace'; cx.textAlign = 'center'; cx.fillText('JUMP POINT', x, y - 100); }
  // pickups
  for (const p of o.pk) { if (!view(p[1], p[2], 20)) continue; if (p[3]) { cx.drawImage(glow('#55ddff', 22), p[1] - 22, p[2] - 22); cx.save(); cx.translate(p[1], p[2]); cx.rotate(T * 2); cx.fillStyle = '#bff'; cx.beginPath(); cx.moveTo(0, -9); cx.lineTo(7, 0); cx.lineTo(0, 9); cx.lineTo(-7, 0); cx.closePath(); cx.fill(); cx.restore(); } else { cx.drawImage(glow('#ffcc33', 12), p[1] - 12, p[2] - 12); cx.save(); cx.translate(p[1], p[2]); cx.scale(abs(cos(T * 4 + p[0])), 1); cx.fillStyle = '#ffd54a'; cx.fillRect(-4, -5, 8, 10); cx.fillStyle = '#a70'; cx.fillRect(-2, -3, 4, 6); cx.restore(); } }
  for (const m of s.mn) { cx.fillStyle = '#555'; cx.beginPath(); cx.arc(m[0], m[1], 7, 0, TAU); cx.fill(); if ((T * 3 | 0) % 2) cx.drawImage(glow('#ff4040', 10), m[0] - 10, m[1] - 10); }
  // allies
  for (const a of o.al) {
    if (!view(a[2], a[3], 120)) continue; const f = ASPR[a[1]](); blit(f, a[2], a[3], a[4]);
    if (a[1] === 'fr') { cx.drawImage(glow('#66ccff', 16), a[2] - cos(a[4]) * 44 - 16, a[3] - sin(a[4]) * 44 - 16); hpBar(a[2], a[3] - 34, 50, a[5], '#6cf'); }
    if (a[1] === 'fs') hpBar(a[2], a[3] - 104, 140, a[5], '#6cf');
    if (a[1] === 'pod') { if ((T * 2 | 0) % 2) cx.drawImage(glow('#66ff66', 18), a[2] - 18, a[3] - 18); cx.strokeStyle = 'rgba(100,255,100,.6)'; cx.lineWidth = 2; cx.setLineDash([6, 6]); cx.beginPath(); cx.arc(a[2], a[3], 110, 0, TAU); cx.stroke(); cx.setLineDash([]); if (a[6] > 0) { cx.strokeStyle = '#7f7'; cx.lineWidth = 5; cx.beginPath(); cx.arc(a[2], a[3], 26, -PI / 2, -PI / 2 + TAU * a[6]); cx.stroke(); } hpBar(a[2], a[3] - 26, 34, a[5], '#7f7'); }
  }
  // enemies
  for (const e of o.e) drawEnemy(e, T, view);
  // ship
  if (!sh.dead && s.ph !== 'result' || (s.ph === 'result' && !sh.dead)) drawShip(o, T);
  // drones
  for (const d of o.dr) if (d) { cx.drawImage(glow('#c08cff', 18), d[0] - 18, d[1] - 18); cx.save(); cx.translate(d[0], d[1]); cx.rotate(T * 3); cx.fillStyle = '#ccd'; cx.fillRect(-6, -6, 12, 12); cx.fillStyle = '#c8f'; cx.fillRect(-3, -3, 6, 6); cx.restore(); }
  if (o.sd) { cx.strokeStyle = 'rgba(120,220,255,.8)'; cx.lineWidth = 3; cx.beginPath(); cx.arc(o.sd[0], o.sd[1], 18, 0, TAU); cx.stroke(); cx.fillStyle = '#9cf'; cx.beginPath(); cx.arc(o.sd[0], o.sd[1], 6, 0, TAU); cx.fill(); }
  // beams
  sh.bm.forEach((b, gi) => { if (!b) return; const side = gi === GUNR ? 1 : -1, la = o.a + side * PI / 3, px = o.x + cos(la) * 22, py = o.y + sin(la) * 22, ex = px + cos(b[0]) * b[1], ey = py + sin(b[0]) * b[1]; cx.lineCap = 'round'; cx.strokeStyle = 'rgba(255,40,40,.35)'; cx.lineWidth = 12 + sin(T * 40) * 3; cx.beginPath(); cx.moveTo(px, py); cx.lineTo(ex, ey); cx.stroke(); cx.strokeStyle = '#ff6060'; cx.lineWidth = 4; cx.stroke(); cx.strokeStyle = '#fff'; cx.lineWidth = 1.5; cx.stroke(); cx.lineCap = 'butt'; cx.drawImage(glow('#ff4040', 20), ex - 20, ey - 20); });
  // player bolts (always red)
  for (const b of bolts.values()) { if (!view(b.x, b.y, 30)) continue; const a = atan2(b.vy, b.vx); if (b.kind === 4) { cx.drawImage(glow('#ff3030', 8), b.x - 8, b.y - 8); } else streak(b.x, b.y, a, b.kind === 2 ? 26 : b.kind === 3 ? 14 : 22, b.kind === 3 ? 1.5 : 2.2, PLAYER_RED, 12); }
  for (const p of o.pp) { if (p[4]) { streak(p[1], p[2], p[3], 12, 2, PLAYER_RED, 12); P({ k: 0, x: p[1], y: p[2], vx: 0, vy: 0, life: 0.2, max: 0.2, s: 2, c: '#ff6050' }); } else { cx.save(); cx.translate(p[1], p[2]); cx.rotate(p[3]); cx.fillStyle = '#ccc'; cx.fillRect(-6, -2, 12, 4); cx.fillStyle = '#f33'; cx.fillRect(4, -2, 3, 4); cx.restore(); cx.drawImage(glow('#ff9a40', 12), p[1] - cos(p[3]) * 8 - 12, p[2] - sin(p[3]) * 8 - 12); P({ k: 3, x: p[1] - cos(p[3]) * 8, y: p[2] - sin(p[3]) * 8, vx: 0, vy: 0, life: 0.5, max: 0.5, s: 5, c: '#555' }); } }
  for (const b of s.bo) { cx.drawImage(glow('#ffaa33', 22), b[0] - 22, b[1] - 22); cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(b[0], b[1], 4, 0, TAU); cx.fill(); }
  // enemy fire (all lasers neon green)
  for (const b of o.eb) { if (!view(b[1], b[2], 30)) continue; if (b[4] === 0) streak(b[1], b[2], b[3], b[5] ? 34 : 20, b[5] ? 4 : 2.2, ENEMY_GREEN, b[5] ? 24 : 12); else if (b[4] === 1) { cx.save(); cx.translate(b[1], b[2]); cx.rotate(b[3]); cx.fillStyle = '#9aa'; cx.fillRect(-7, -2.5, 14, 5); cx.fillStyle = '#ffaa33'; cx.fillRect(5, -2.5, 3, 5); cx.restore(); cx.drawImage(glow('#ffaa33', 14), b[1] - cos(b[3]) * 9 - 14, b[2] - sin(b[3]) * 9 - 14); if (random() < 0.5) P({ k: 3, x: b[1] - cos(b[3]) * 9, y: b[2] - sin(b[3]) * 9, vx: 0, vy: 0, life: 0.5, max: 0.5, s: 4, c: '#444' }); } else { cx.drawImage(glow('#ffaa33', 12), b[1] - 12, b[2] - 12); cx.fillStyle = '#ffe0a0'; cx.beginPath(); cx.arc(b[1], b[2], 3, 0, TAU); cx.fill(); } }
  // particles
  for (const p of parts) { const f = p.life / p.max; if (!view(p.x, p.y, 120)) continue;
    if (p.k === 0) { cx.globalAlpha = f; cx.fillStyle = p.c; cx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
    else if (p.k === 1) { cx.globalAlpha = f; cx.strokeStyle = p.c; cx.lineWidth = p.w * f + 0.5; cx.beginPath(); cx.arc(p.x, p.y, lerp(p.r1, p.r0, f), 0, TAU); cx.stroke(); }
    else if (p.k === 2) { cx.globalAlpha = f; const r = p.r * (1.2 - f * 0.4); cx.drawImage(glow(p.c === '#fff' ? '#ffffff' : p.c, 64), p.x - r, p.y - r, r * 2, r * 2); }
    else if (p.k === 3) { cx.globalAlpha = f * 0.5; cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.s * (1.6 - f), 0, TAU); cx.fill(); }
    else if (p.k === 4) { cx.globalAlpha = f; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.s, -p.s / 3, p.s * 2, p.s / 1.5); cx.restore(); }
    else if (p.k === 5) { cx.globalAlpha = f; const r = p.s * (1.5 - f * 0.5); cx.drawImage(glow(f > 0.6 ? '#ffd890' : f > 0.3 ? '#ff7a2a' : '#7a2a10', 64), p.x - r, p.y - r, r * 2, r * 2); } }
  cx.globalAlpha = 1;
  for (const f of floaters) { cx.globalAlpha = min(1, f.t * 2); cx.fillStyle = f.c; cx.font = 'bold 15px monospace'; cx.textAlign = 'center'; cx.fillText(f.s, f.x, f.y); } cx.globalAlpha = 1;
  // my aim cursor (world)
  if (joined && me.role >= 0 && s.ph === 'mission') { const [ax, ay] = aimWorld(o); cx.strokeStyle = me.role === SHIELD ? MODE_C[sh.sm] : me.role === REPAIR ? '#c8f' : '#ff5050'; cx.lineWidth = 2 / Z; cx.beginPath(); cx.arc(ax, ay, 10 / Z, 0, TAU); cx.moveTo(ax - 16 / Z, ay); cx.lineTo(ax - 6 / Z, ay); cx.moveTo(ax + 6 / Z, ay); cx.lineTo(ax + 16 / Z, ay); cx.stroke(); }
}
function drawEnemy(e, T, view) {
  const [id, t, x, y, a, hp, warp, paint, ports] = e, Tt = ETYPES[t]; if (!view(x, y, Tt.r + 60)) return;
  if (warp) { cx.strokeStyle = 'rgba(160,255,170,.7)'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(x - cos(a) * 200, y - sin(a) * 200); cx.lineTo(x, y); cx.stroke(); cx.drawImage(glow('#aaffaa', 30), x - 30, y - 30); return; }
  if (t === 10) { blit(rockSprite(hp, id), x, y, a); return; }
  const sp = enemySprite(t); if (!sp) return;
  // engine glow
  const back = Tt.mp ? (Tt.hull.k === 'tri' ? 112 : Tt.hull.k === 'circ' ? 0 : Tt.hull.a + 4) : Tt.r * 0.6;
  if (Tt.spd > 0) cx.drawImage(glow('#88ffaa', Tt.mp ? 26 : 10), x - cos(a) * back - (Tt.mp ? 26 : 10), y - sin(a) * back - (Tt.mp ? 26 : 10));
  blit(sp, x, y, a);
  const ht = hitT.get(id); if (ht && performance.now() - ht < 70) { cx.globalCompositeOperation = 'lighter'; blit(sp, x, y, a, 1, 0.35); cx.globalCompositeOperation = 'source-over'; }
  if (t === 5 && (T * 4 | 0) % 2) cx.drawImage(glow('#ff3030', 12), x - 12, y - 12);
  if (ports) ports.forEach((p, k) => {
    const P_ = Tt.ports[k], c = cos(a), s_ = sin(a), px = x + P_.x * c - P_.y * s_, py = y + P_.x * s_ + P_.y * c;
    if (p[0] <= 0) { cx.fillStyle = '#111'; cx.beginPath(); cx.arc(px, py, 9, 0, TAU); cx.fill(); cx.fillStyle = 'rgba(255,120,40,.6)'; cx.beginPath(); cx.arc(px, py, 3 + sin(T * 9 + k) * 1.5, 0, TAU); cx.fill(); if (random() < 0.1) P({ k: 3, x: px, y: py, vx: (random() - .5) * 20, vy: (random() - .5) * 20, life: 1, max: 1, s: 5, c: '#333' }); return; }
    const pa = a + p[1], heavy = P_.w === 'ion', len = heavy ? 18 : 13;
    cx.strokeStyle = '#2a2d33'; cx.lineWidth = heavy ? 6 : 4; cx.beginPath(); cx.moveTo(px, py); cx.lineTo(px + cos(pa) * len, py + sin(pa) * len); cx.stroke();
    cx.fillStyle = P_.w === 'msl' ? '#8a8f6a' : P_.w === 'flak' ? '#8a7a6a' : '#7d838c'; cx.beginPath(); cx.arc(px, py, heavy ? 10 : 7.5, 0, TAU); cx.fill(); cx.strokeStyle = '#111'; cx.lineWidth = 1.5; cx.stroke();
    cx.strokeStyle = p[0] > 0.5 ? '#5f5' : p[0] > 0.25 ? '#fd4' : '#f44'; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(px, py, heavy ? 13 : 10.5, -PI / 2, -PI / 2 + TAU * p[0]); cx.stroke();
    if (p[2]) cx.drawImage(glow('#39ff4a', 26), px + cos(pa) * len - 26, py + sin(pa) * len - 26);
  });
  if (!Tt.mp && hp < 1) hpBar(x, y - Tt.r - 10, Tt.r * 2, hp, '#5f5');
  if (paint) { cx.strokeStyle = '#ff4040'; cx.lineWidth = 2; const r = Tt.r + 12; cx.save(); cx.translate(x, y); cx.rotate(T * 2); for (let i = 0; i < 4; i++) { cx.rotate(PI / 2); cx.beginPath(); cx.arc(0, 0, r, 0.2, 0.9); cx.stroke(); } cx.restore(); }
}
function drawShip(o, T) {
  const sh = o.sh, x = o.x, y = o.y, a = o.a, s = o.s;
  // shield
  if (!sh.dn[SHIELD] && !sh.vent && s.ph === 'mission') {
    const col = MODE_C[sh.sm], half = sh.arc * PI / 180, sa = a + o.sa;
    if (sh.bub) { cx.strokeStyle = 'rgba(200,240,255,.8)'; cx.lineWidth = 4; cx.beginPath(); cx.arc(x, y, 66, 0, TAU); cx.stroke(); cx.fillStyle = 'rgba(150,220,255,.08)'; cx.fill(); }
    const arcs = [[sa, half]]; if (sh.rear) arcs.push([sa + PI, half * 0.7]);
    for (const [c, h] of arcs) { cx.strokeStyle = col; cx.globalAlpha = 0.25; cx.lineWidth = 12; cx.beginPath(); cx.arc(x, y, 66, c - h, c + h); cx.stroke(); cx.globalAlpha = 0.9; cx.lineWidth = 3; cx.beginPath(); cx.arc(x, y, 66, c - h, c + h); cx.stroke(); cx.globalAlpha = 1; }
  }
  if (sh.aeg) { cx.strokeStyle = 'rgba(255,215,80,.7)'; cx.lineWidth = 2; cx.setLineDash([8, 6]); cx.beginPath(); cx.arc(x, y, 54, T, T + TAU); cx.stroke(); cx.setLineDash([]); }
  // engines
  const eg = sh.dn[ENG] ? 0.2 : clamp(sh.spd / 300, 0.2, 1.4) * (sh.burn ? 1.6 : 1);
  for (const yy of [-13, 0, 13]) { const ex = x + cos(a) * -54 - sin(a) * yy, ey = y + sin(a) * -54 + cos(a) * yy, r = 10 + eg * 14 + random() * 3; cx.drawImage(glow(sh.burn ? '#ffd890' : '#8fd8ff', 32), ex - r, ey - r, r * 2, r * 2); if (eg > 0.4 && random() < 0.5) P({ k: 0, x: ex, y: ey, vx: -cos(a) * 200 + (random() - .5) * 40, vy: -sin(a) * 200 + (random() - .5) * 40, life: 0.25, max: 0.25, s: 2, c: '#9df' }); }
  const roll = sh.roll || 0; cx.save(); cx.translate(x, y); cx.rotate(a); cx.scale(1, 1 - abs(roll) * 0.5); cx.translate(-x, -y);
  blit(playerSprite(s.mk), x, y, 0, 0.92, sh.inv ? 0.55 : 1);
  cx.restore();
  // turrets: starboard (right, +) and port (left, -)
  for (const [gi, side, ta] of [[GUNR, 1, o.tr], [GUNL, -1, o.tl]]) { const la = a + side * PI / 3, px = x + cos(la) * 22, py = y + sin(la) * 22, wa = a + ta; cx.strokeStyle = '#2a2d33'; cx.lineWidth = 3; for (const off of [-2.5, 2.5]) { cx.beginPath(); cx.moveTo(px - sin(wa) * off, py + cos(wa) * off); cx.lineTo(px + cos(wa) * 17 - sin(wa) * off, py + sin(wa) * 17 + cos(wa) * off); cx.stroke(); } cx.fillStyle = sh.dn[gi] ? '#422' : '#a9afb8'; cx.beginPath(); cx.arc(px, py, 7, 0, TAU); cx.fill(); cx.strokeStyle = '#222'; cx.lineWidth = 1.2; cx.stroke(); cx.fillStyle = '#c33'; cx.fillRect(px + cos(wa) * 15 - 1.5, py + sin(wa) * 15 - 1.5, 3, 3); }
  // damaged / destroyed ports
  for (let i = 0; i < 6; i++) { const la = a + i * PI / 3, px = x + cos(la) * 24, py = y + sin(la) * 24; if (sh.dn[i]) { cx.drawImage(glow('#ff3020', 20), px - 20, py - 20); if (random() < 0.3) P({ k: 3, x: px, y: py, vx: (random() - .5) * 30, vy: (random() - .5) * 30, life: 1, max: 1, s: 6, c: '#333' }); if (random() < 0.15) sparks(px, py, 2, '#ffb050', 120, 0.3, 1.5); } else if (sh.st[i] < sh.mx[i]) { if (random() < 0.05) P({ k: 3, x: px, y: py, vx: 0, vy: 0, life: 0.8, max: 0.8, s: 4, c: '#555' }); } }
  // repair target highlight for the repair player
  if (me.role === REPAIR && sh.tk[0] >= 0 && sh.tk[0] < 6) { const la = a + sh.tk[0] * PI / 3; cx.strokeStyle = '#c8f'; cx.lineWidth = 2; cx.beginPath(); cx.arc(x + cos(la) * 24, y + sin(la) * 24, 12 + sin(T * 8) * 2, 0, TAU); cx.stroke(); }
}
function drawHUD(o, T) {
  const s = o.s, sh = o.sh; if (s.ph !== 'mission') return;
  // off-screen indicators: enemies (green), objectives (yellow)
  const ind = (x, y, col, sz) => { const dx = x - camX, dy = y - camY, hw = W / 2 / Z, hh = H / 2 / Z; if (abs(dx) < hw && abs(dy) < hh) return; const a = atan2(dy, dx), k = min((W / 2 - 24) / abs(cos(a) || 1e-6), (H / 2 - 24) / abs(sin(a) || 1e-6)); const px = W / 2 + cos(a) * k, py = H / 2 + sin(a) * k; cx.save(); cx.translate(px, py); cx.rotate(a); cx.fillStyle = col; cx.beginPath(); cx.moveTo(sz, 0); cx.lineTo(-sz * 0.6, -sz * 0.6); cx.lineTo(-sz * 0.6, sz * 0.6); cx.closePath(); cx.fill(); cx.restore(); };
  for (const e of o.e) if (e[1] !== 10) ind(e[2], e[3], ETYPES[e[1]].mp ? '#9f9' : 'rgba(57,255,74,.7)', ETYPES[e[1]].mp ? 12 : 7);
  for (const a of o.al) ind(a[2], a[3], a[1] === 'pod' ? '#7f7' : '#6cf', 10);
  if (s.mi && s.mi.type === 'escort') ind(s.mi.jx, s.mi.jy, '#9cf', 12);
  for (const p of o.pk) if (p[3]) ind(p[1], p[2], '#6df', 8);
  // status bars
  const bw = min(230, W * 0.32), bx = 12, by = H - (isTouch ? 210 : 70);
  cx.textAlign = 'left'; cx.font = 'bold 11px monospace';
  cx.fillStyle = '#cde'; cx.fillText(`HULL ${sh.h.toFixed(1)}/${sh.hm}`, bx, by - 4);
  cx.fillStyle = 'rgba(0,30,40,.7)'; cx.fillRect(bx, by, bw, 10); cx.fillStyle = sh.h / sh.hm < 0.35 ? '#f44' : '#8ff'; cx.fillRect(bx, by, bw * sh.h / sh.hm, 10);
  cx.fillStyle = '#ffd54a'; cx.fillText(`ENERGY ${sh.en}/${sh.em}`, bx, by + 24); cx.fillStyle = 'rgba(40,40,0,.7)'; cx.fillRect(bx, by + 28, bw, 8); cx.fillStyle = '#ffd54a'; cx.fillRect(bx, by + 28, bw * sh.en / sh.em, 8);
  cx.fillStyle = '#9ab'; cx.fillText(isTouch ? `SPD ${sh.spd} · ${sh.vent ? 'VENTED' : MODE_N[sh.sm]}` : `SPD ${sh.spd} · THR ${round(sh.thr * 100)}% · PWR E${sh.pip[0]} W${sh.pip[1]} S${sh.pip[2]} · ${sh.vent ? 'SHIELD VENTED' : 'SHIELD ' + MODE_N[sh.sm]}`, bx, by + 50);
  // ship schematic (ports)
  const scx = W - 70, scy = isTouch ? 300 : 120, R = 40;
  cx.fillStyle = 'rgba(5,10,20,.6)'; cx.beginPath(); cx.arc(scx, scy, R + 16, 0, TAU); cx.fill();
  for (let i = 0; i < 6; i++) { const ang = -PI / 2 + i * PI / 3, px = scx + cos(ang) * R, py = scy + sin(ang) * R, f = sh.st[i] / sh.mx[i]; cx.fillStyle = sh.dn[i] ? (T * 4 | 0) % 2 ? '#f33' : '#600' : f < 1 ? '#fd4' : '#4d8'; cx.beginPath(); cx.arc(px, py, i === me.role ? 9 : 7, 0, TAU); cx.fill(); if (i === me.role) { cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.stroke(); } cx.fillStyle = '#fff'; cx.font = 'bold 8px monospace'; cx.textAlign = 'center'; cx.fillText(RSHORT[i], px, py + 19); }
  cx.fillStyle = '#9ab'; cx.font = '9px monospace'; cx.fillText('▲ NOSE', scx, scy - R - 18);
  // critical warnings
  const warn = []; if (sh.dn[PILOT]) warn.push('COCKPIT DOWN: ship drifting, no steering'); if (sh.dn[ENG]) warn.push('ENGINES DOWN: stalling'); if (sh.dn[SHIELD]) warn.push('DEFLECTOR DOWN'); if (sh.dead) warn.push('SHIP DESTROYED');
  if (warn.length) { cx.textAlign = 'center'; cx.font = 'bold 14px monospace'; cx.fillStyle = (T * 3 | 0) % 2 ? '#f55' : '#fa5'; warn.forEach((w, i) => cx.fillText('⚠ ' + w, W / 2, (isTouch ? 170 : 96) + i * 18)); }
  cx.fillStyle = '#456'; cx.font = '10px monospace'; cx.textAlign = 'right'; cx.fillText(round(fps) + 'fps', W - 6, H - 4);
}
})();
