'use strict';
(() => {
const $ = id => document.getElementById(id);
const cv = $('c'), cx = cv.getContext('2d');
const { sin, cos, atan2, hypot, min, max, abs, PI, random, floor, round, sqrt, exp } = Math;
const TAU = PI * 2, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
const lerp = (a, b, t) => a + (b - a) * t, lerpA = (a, b, t) => a + wrap(b - a) * t;
const D = window.DEFS, { ROLES, RNAME, RSHORT, PORT_NAMES, TREE_OF, TREES, ABIL, NODE_COST, infCost, infCap, ETYPES, DIFFS, MTYPES, MK_COST, MK_NAMES, PORT_COST, portUpCost, PORT_MAX_LV, CORE_RATE, pyrAllowed, SHIELD_ARC_MAX, ARENA, EFIRE_WEAK_LV, EFIRE_WEAK } = D;
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5;
const RICON = ['✈', '⟫', '✚', '⚙', '◐', '⟪'];
const PLAYER_RED = '#ff3030', ENEMY_GREEN = '#39ff4a';
const SHIELD_BLUE = '#4aa8ff';
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const ROLE_HELP = [
  'Steer by aiming (mouse/stick). Click = nose laser. You <b>cannot</b> change speed: that is the Engineer. If the Cockpit is destroyed the ship drifts straight ahead until it is repaired. Your vote counts extra on the star map.',
  'Aim + hold click to fire your starboard (right) turret. Your red bolts shoot down missiles and flak. If the port turret is destroyed you get a full 360° arc.',
  '<b>Click a damaged port</b> in your big side panel (or press 1-6, 0 = hull) to start repairing it: it then repairs <b>automatically</b>, and the port\'s own <b>minigame</b> makes it faster (up to +100%). Your drone is out by default and follows your cursor; <b>disable it (G)</b> to repair 50% faster. You cannot repair the Repair Bay; if it is destroyed your crewmates must click it back online, and until then you can neither repair nor use the drone.',
  'You alone control speed: W/S or wheel = throttle. 1/2/3 route a power pip to Engines/Weapons/Shields (4 = balanced). Engines destroyed = the ship slowly stalls until repaired.',
  'Aim to place the blue shield arc: it stays where you point it even when the ship turns. It blocks ALL enemy fire until its HP is gone, then it needs 20 s to recharge. Buy HP and arc width (starts 15°, max 90°) in the upgrades; the Lance abilities fire the shield as a weapon.',
  'Aim + hold click to fire your port (left) turret. Your red bolts shoot down missiles and flak. If the starboard turret is destroyed you get a full 360° arc.'];
const COMMON = 'Your station destroyed? Ask the Repair crew to click it. <b>If the Repair Bay is destroyed, everybody mashes CLICK RAPIDLY</b> to fix it. <b>Q/E/R</b> = your abilities (pick them in the skill pyramid, U). <b>Tab</b> switch role · <b>H</b> help.';

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
  ring(x, y, 2, R * 3 + 40, 0.5 + sz * 0.1, 'rgba(255,255,255,.6)', 1.5);
  for (let i = 0; i < 6 + sz * 4; i++) { const a = random() * TAU, v = 260 + random() * (240 + sz * 100); P({ k: 6, x, y, vx: cos(a) * v, vy: sin(a) * v, life: 0.35 + random() * 0.35, max: 0.7, s: 1.5 + random() * (1 + sz * 0.4), c: random() < 0.5 ? '#ffe9a0' : '#ff8a3a' }); }
  const d = hypot(x - camX, y - camY); if (d < 900) shake = max(shake, (sz * 4 + 2) * (1 - d / 900));
  SFX.boom(min(sz, 4), x);
}
function stepParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const f = p.k === 3 || p.k === 5 ? 0.96 : 0.93; p.vx *= f; p.vy *= f; } if (p.va) p.a += p.va * dt; }
}

// ---------- sprites (pre-rendered vector art) ----------
const SPR = {}, SS = 2;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// v4: extra detail pass over every pre-rendered sprite: light/shade gradient, edge darkening, panel seams, rivets, running lights (only paints where the sprite already has pixels)
function sprDetail(g, w, h, R, key) {
  const rock = key.startsWith('rock'), big = max(w, h);
  g.save(); g.globalCompositeOperation = 'source-atop';
  const lg = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2); lg.addColorStop(0, 'rgba(255,255,255,.17)'); lg.addColorStop(0.45, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(0,0,24,.32)'); g.fillStyle = lg; g.fillRect(-w / 2, -h / 2, w, h);
  const rg = g.createRadialGradient(0, 0, big * 0.18, 0, 0, big * 0.62); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,10,.3)'); g.fillStyle = rg; g.fillRect(-w / 2, -h / 2, w, h);
  const n = rock ? 6 : clamp(floor(big / 9), 4, 22);
  for (let i = 0; i < n; i++) {   // panel seams: a dark groove with a light lip beside it
    const x = (R() - 0.5) * w * 0.8, y = (R() - 0.5) * h * 0.8, hz = R() < 0.5, l = big * (0.1 + R() * 0.16), cr = rock ? R() * 1.2 - 0.6 : 0;
    g.lineWidth = max(0.5, big / 150); g.strokeStyle = 'rgba(0,0,0,.34)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hz ? l : cr * l * 0.3), y + (hz ? cr * l * 0.3 : l)); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(x + 0.7, y + 0.7); g.lineTo(x + 0.7 + (hz ? l : cr * l * 0.3), y + 0.7 + (hz ? cr * l * 0.3 : l)); g.stroke();
  }
  if (!rock) {
    const rv = clamp(floor(big / 5), 4, 40);
    for (let i = 0; i < rv; i++) { const x = (R() - 0.5) * w * 0.85, y = (R() - 0.5) * h * 0.85; g.fillStyle = R() < 0.55 ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.3)'; g.fillRect(x, y, big > 60 ? 1.4 : 0.9, big > 60 ? 1.4 : 0.9); }
    const lights = clamp(floor(big / 18), 1, 7); for (let i = 0; i < lights; i++) { const x = (R() - 0.5) * w * 0.7, y = (R() - 0.5) * h * 0.7; g.fillStyle = R() < 0.5 ? 'rgba(130,230,255,.9)' : 'rgba(255,190,90,.9)'; g.beginPath(); g.arc(x, y, max(0.6, big / 90), 0, TAU); g.fill(); }
  } else { for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * w * 0.6, y = (R() - 0.5) * h * 0.6, r = big * (0.04 + R() * 0.07); g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(x - 0.6, y - 0.6, r, PI * 0.9, PI * 1.9); g.stroke(); } }
  g.restore();
}
function spr(key, w, h, fn) { let c = SPR[key]; if (c) return c; c = SPR[key] = document.createElement('canvas'); c.width = w * SS; c.height = h * SS; const g = c.getContext('2d'); g.scale(SS, SS); g.translate(w / 2, h / 2); g.lineJoin = 'round'; const R_ = rng(key.length * 7919 + key.charCodeAt(0) * 31); fn(g, R_); sprDetail(g, w, h, R_, key); c.hw = w / 2; c.hh = h / 2; return c; }
function blit(c, x, y, a, s = 1, alpha = 1) { cx.save(); cx.translate(x, y); cx.rotate(a); if (alpha < 1) cx.globalAlpha = alpha; cx.drawImage(c, -c.hw * s, -c.hh * s, c.hw * 2 * s, c.hh * 2 * s); cx.restore(); }
const poly = (g, p) => { g.beginPath(); g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); };
const mirror = p => p.concat(p.slice().reverse().map(([x, y]) => [x, -y]));
function metal(g, r, c1 = '#c9ced6', c2 = '#6d737d') { const gr = g.createLinearGradient(-r * 0.4, -r, r * 0.4, r); gr.addColorStop(0, c1); gr.addColorStop(0.55, c2); gr.addColorStop(1, '#3a3e46'); return gr; }
function greeble(g, R, n, x0, x1, y0, y1, dark = 'rgba(0,0,0,.28)', light = 'rgba(255,255,255,.18)') { for (let i = 0; i < n; i++) { const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0), w = 1 + R() * 5, h = 1 + R() * 3; g.fillStyle = R() < 0.6 ? dark : light; g.fillRect(x, y, w, h); } }
function panelLines(g, R, n, x0, x1, y0, y1) { g.strokeStyle = 'rgba(20,24,30,.45)'; g.lineWidth = 0.6; for (let i = 0; i < n; i++) { g.beginPath(); if (R() < 0.5) { const x = x0 + R() * (x1 - x0); g.moveTo(x, y0 + R() * (y1 - y0) * 0.5); g.lineTo(x, y1 - R() * (y1 - y0) * 0.5); } else { const y = y0 + R() * (y1 - y0); g.moveTo(x0 + R() * (x1 - x0) * 0.5, y); g.lineTo(x1 - R() * (x1 - x0) * 0.5, y); } g.stroke(); } }
function shipBody(g, R, pts, r, c1, c2) { poly(g, pts); g.fillStyle = metal(g, r, c1, c2); g.fill(); g.save(); g.clip(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y); } panelLines(g, R, 26, x0, x1, y0, y1); greeble(g, R, 50, x0, x1, y0, y1); const sh = g.createLinearGradient(0, y0, 0, y1); sh.addColorStop(0, 'rgba(255,255,255,.12)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = sh; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.restore(); g.strokeStyle = 'rgba(10,12,16,.9)'; g.lineWidth = 1.2; poly(g, pts); g.stroke(); }
// player ship: a distinct hull per Mk. Local coords: nose = +x, starboard = +y. The geometry (D.GEO) matches the server hit boxes.
const GEO = D.GEO, secIdx = D.secIdx;
const TIER = [
  { c1: '#d9dde3', c2: '#747a85', acc: '#d02a2a', lite: '#ff8a8a' },
  { c1: '#c0c6cf', c2: '#4a5260', acc: '#ffa21a', lite: '#ffd38a' },
  { c1: '#9aa3b8', c2: '#262c3c', acc: '#37d6ff', lite: '#bff4ff' },
];
const ENGN = [[[-46, -9], [-46, 0], [-46, 9]], [[-84, -13], [-84, 13], [-80, 0]], [[-112, -18], [-112, -7], [-112, 7], [-112, 18]]];
function socket(g, x, y, r = 6) { g.fillStyle = '#12151a'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.strokeStyle = '#6f7682'; g.lineWidth = 1.2; g.stroke(); g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x, y, r - 2, 0, TAU); g.stroke(); }
function stationArt(g, mk, tc) {
  const G = GEO[mk];
  // cockpit canopy
  const [cx0, cy0] = G.st[0]; const cg = g.createLinearGradient(cx0 - 8, cy0 - 5, cx0 + 8, cy0 + 5); cg.addColorStop(0, '#bff'); cg.addColorStop(0.5, '#3a8fb0'); cg.addColorStop(1, '#0a2a44'); g.fillStyle = cg; g.beginPath(); g.ellipse(cx0, cy0, 8 + mk * 2, 4.5 + mk, 0, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 1; g.stroke();
  // engine bay
  const [ex, ey] = G.st[3]; g.fillStyle = '#20242b'; g.fillRect(ex - 6, ey - 8 - mk * 3, 14 + mk * 2, 16 + mk * 6); g.fillStyle = tc.acc; g.fillRect(ex - 6, ey - 1, 14 + mk * 2, 2);
  // deflector dish (blue)
  const [sx, sy] = G.st[4]; g.fillStyle = '#26323f'; g.beginPath(); g.arc(sx, sy, 7, 0, TAU); g.fill(); g.fillStyle = '#3aa8ff'; g.beginPath(); g.arc(sx, sy, 4, 0, TAU); g.fill(); g.strokeStyle = '#bfe4ff'; g.lineWidth = 0.8; g.stroke();
  // repair bay hatch
  const [rx, ry] = G.st[2]; g.fillStyle = '#26352b'; g.fillRect(rx - 7, ry - 6, 14, 12); g.fillStyle = '#4cff7a'; g.fillRect(rx - 1, ry - 4, 2, 8); g.fillRect(rx - 4, ry - 1, 8, 2); g.strokeStyle = '#111'; g.lineWidth = 1; g.strokeRect(rx - 7, ry - 6, 14, 12);
  // turret rings (guns are drawn live on top)
  for (const i of [1, 5]) socket(g, G.st[i][0], G.st[i][1], 8 + mk);
}
function playerSprite(mk) {
  const tc = TIER[mk], dims = [[130, 92], [196, 136], [256, 156]][mk];
  return spr('pl' + mk, dims[0], dims[1], (g, R) => {
    const G = GEO[mk];
    if (mk === 0) { // Mk I Corvette: sleek red-striped wedge
      for (const s of [-1, 1]) shipBody(g, R, [[18, 9 * s], [-12, 32 * s], [-36, 34 * s], [-32, 14 * s]], 40, tc.c1, tc.c2);
      shipBody(g, R, mirror([[54, 0], [42, -5], [26, -9], [8, -13], [-22, -17], [-38, -15], [-47, -8]]), 40, tc.c1, tc.c2);
      g.fillStyle = tc.acc; for (const s of [-1, 1]) { g.fillRect(-34, 22 * s - 2, 22, 3); g.fillRect(8, 11 * s - 1.5, 16, 3); }
    } else if (mk === 1) { // Mk II Gunship: wide wings with weapon pods, twin nacelles, canards
      for (const s of [-1, 1]) {
        shipBody(g, R, [[62, 8 * s], [44, 26 * s], [32, 24 * s], [44, 8 * s]], 30, tc.c1, tc.c2);
        shipBody(g, R, [[26, 14 * s], [-6, 52 * s], [-48, 56 * s], [-58, 42 * s], [-40, 18 * s]], 70, tc.c1, tc.c2);
        shipBody(g, R, [[-60, 8 * s], [-70, 18 * s], [-90, 18 * s], [-92, 8 * s]], 20, '#7c828d', '#2c3037');
        g.fillStyle = tc.acc; g.fillRect(-46, 48 * s - 2, 30, 3);
      }
      shipBody(g, R, mirror([[74, 0], [58, -6], [36, -10], [10, -16], [-30, -20], [-60, -22], [-78, -14], [-82, -6]]), 70, tc.c1, tc.c2);
      shipBody(g, R, mirror([[44, 0], [20, -7], [-28, -11], [-44, -6]]), 50, '#e2e5ea', '#808793');
      g.fillStyle = tc.acc; g.fillRect(-20, -1.5, 32, 3);
    } else { // Mk III Battlecruiser: armored sponsons, command tower, quad engines
      for (const s of [-1, 1]) {
        shipBody(g, R, [[60, 22 * s], [52, 50 * s], [20, 62 * s], [-24, 64 * s], [-70, 58 * s], [-82, 36 * s], [-60, 26 * s]], 90, tc.c1, tc.c2);
        shipBody(g, R, [[34, 54 * s], [12, 66 * s], [-20, 68 * s], [-26, 58 * s]], 30, '#59627a', '#1c2130');
        g.strokeStyle = tc.acc; g.lineWidth = 1.6; g.beginPath(); g.moveTo(52, 50 * s); g.lineTo(20, 62 * s); g.lineTo(-24, 64 * s); g.lineTo(-70, 58 * s); g.stroke();
        g.fillStyle = tc.lite; for (let k = 0; k < 6; k++) g.fillRect(30 - k * 18, 60 * s - 1, 5, 2);
      }
      shipBody(g, R, mirror([[94, 0], [82, -6], [58, -12], [30, -20], [-10, -24], [-60, -26], [-100, -26], [-110, -20], [-113, 0]]), 110, tc.c1, tc.c2);
      shipBody(g, R, mirror([[60, 0], [30, -9], [-40, -14], [-90, -18], [-96, 0]]), 80, '#b8c0d0', '#454d62');
      shipBody(g, R, mirror([[26, 0], [12, -9], [-12, -9], [-22, 0]]), 30, '#d8dee8', '#68728a'); // command tower
      g.fillStyle = tc.acc; g.fillRect(-4, -2, 14, 4); g.fillStyle = '#d8b35a'; g.fillRect(-100, -22, 3, 44);
      for (const y of [-18, -7, 7, 18]) { g.fillStyle = '#0e1116'; g.beginPath(); g.arc(-111, y, 6, 0, TAU); g.fill(); g.fillStyle = tc.acc; g.beginPath(); g.arc(-111, y, 2.4, 0, TAU); g.fill(); }
    }
    if (mk === 0) { g.fillStyle = '#2b2f36'; g.fillRect(-52, -14, 8, 28); for (const [x, y] of ENGN[0]) { g.fillStyle = '#0e1116'; g.beginPath(); g.arc(x - 3, y, 4.5, 0, TAU); g.fill(); } }
    if (mk === 1) { for (const [x, y] of ENGN[1]) { g.fillStyle = '#0e1116'; g.beginPath(); g.arc(x - 4, y, 5.5, 0, TAU); g.fill(); g.fillStyle = tc.acc; g.beginPath(); g.arc(x - 4, y, 2, 0, TAU); g.fill(); } }
    stationArt(g, mk, tc);
    for (const row of G.po) for (const p of row) socket(g, p[0], p[1], 6); // empty hard-points: room for the extra ports
  });
}
// extra-port hardware, drawn live at its mount (local coords). ang = barrel angle relative to the ship
function drawPortIcon(id, x, y, ang, lv, T) {
  cx.save(); cx.translate(x, y); cx.lineJoin = 'round';
  const base = () => { cx.fillStyle = '#4a505a'; cx.beginPath(); cx.arc(0, 0, 6.5, 0, TAU); cx.fill(); cx.strokeStyle = '#151820'; cx.lineWidth = 1; cx.stroke(); };
  base(); cx.rotate(ang);
  const barrel = (ox, len, w, col) => { cx.fillStyle = col || '#2a2d33'; cx.fillRect(2, ox - w / 2, len, w); cx.fillStyle = '#ff4a3a'; cx.fillRect(2 + len - 2, ox - w / 2, 2, w); };
  if (id === 'twin') { barrel(-3, 14, 2.4); barrel(3, 14, 2.4); }
  else if (id === 'rockets') { cx.fillStyle = '#8c929c'; cx.fillRect(-2, -6, 14, 12); cx.strokeStyle = '#222'; cx.strokeRect(-2, -6, 14, 12); for (const o of [-3.5, 0, 3.5]) { cx.fillStyle = '#1a1c20'; cx.beginPath(); cx.arc(12, o, 1.8, 0, TAU); cx.fill(); cx.fillStyle = '#ff3a2a'; cx.beginPath(); cx.arc(12, o, 0.9, 0, TAU); cx.fill(); } }
  else if (id === 'scatter') { for (let k = -2; k <= 2; k++) { cx.save(); cx.rotate(k * 0.22); barrel(0, 11, 1.8); cx.restore(); } }
  else if (id === 'beam') { cx.fillStyle = '#20242b'; cx.fillRect(0, -3, 11, 6); cx.strokeStyle = '#ff5a4a'; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(11, 0, 3 + sin(T * 8) * 0.6, 0, TAU); cx.stroke(); cx.fillStyle = '#ff9a8a'; cx.beginPath(); cx.arc(11, 0, 1.4, 0, TAU); cx.fill(); }
  else if (id === 'mines') { cx.rotate(-ang); cx.fillStyle = '#2c3036'; cx.fillRect(-5, -5, 10, 10); cx.fillStyle = (T * 2 | 0) % 2 ? '#f33' : '#600'; cx.beginPath(); cx.arc(0, 0, 2, 0, TAU); cx.fill(); }
  else if (id === 'tractor') { cx.rotate(-ang); cx.strokeStyle = '#6df'; cx.lineWidth = 1.2; for (const r of [3, 5, 7]) { cx.globalAlpha = 0.9 - (r - 3) * 0.12; cx.beginPath(); cx.arc(0, 0, r, 0, TAU); cx.stroke(); } cx.globalAlpha = 1; }
  else if (id === 'aux') { cx.rotate(-ang); cx.fillStyle = '#2a2f38'; cx.fillRect(-5, -6, 10, 12); const gl = 0.6 + sin(T * 5) * 0.25; cx.fillStyle = `rgba(255,220,90,${gl})`; cx.fillRect(-3, -4, 6, 8); }
  else if (id === 'rear') { cx.rotate(-ang + PI); cx.fillStyle = '#26323f'; cx.beginPath(); cx.moveTo(-4, -6); cx.lineTo(6, 0); cx.lineTo(-4, 6); cx.closePath(); cx.fill(); cx.fillStyle = '#3aa8ff'; cx.beginPath(); cx.arc(1, 0, 2.2, 0, TAU); cx.fill(); }
  else if (id === 'reflect') { cx.rotate(-ang); cx.strokeStyle = '#8fd8ff'; cx.lineWidth = 1; for (let k = 0; k < 6; k++) { const a = k * PI / 3; cx.beginPath(); cx.moveTo(cos(a) * 5, sin(a) * 5); cx.lineTo(cos(a + PI / 3) * 5, sin(a + PI / 3) * 5); cx.stroke(); } cx.fillStyle = 'rgba(100,200,255,.4)'; cx.beginPath(); cx.arc(0, 0, 3, 0, TAU); cx.fill(); }
  else if (id === 'capbank') { cx.rotate(-ang); for (let k = -1; k <= 1; k++) { cx.fillStyle = '#2f3a52'; cx.fillRect(-6 + k * 4.5, -5, 3.6, 10); cx.fillStyle = '#4ac0ff'; cx.fillRect(-5.6 + k * 4.5, -3 + (k + 1) % 2, 2.8, 4); } }
  else if (id === 'drone2') { cx.rotate(-ang); cx.fillStyle = '#26303a'; cx.fillRect(-6, -5, 12, 10); cx.fillStyle = '#c08cff'; cx.fillRect(-2.5, -2.5, 5, 5); }
  else if (id === 'sdrone') { cx.rotate(-ang); cx.strokeStyle = '#9cf'; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(0, 0, 5, 0, TAU); cx.stroke(); cx.fillStyle = '#c08cff'; cx.beginPath(); cx.arc(cos(T * 3) * 5, sin(T * 3) * 5, 1.8, 0, TAU); cx.fill(); }
  else if (id === 'welder') { cx.rotate(-ang); cx.strokeStyle = '#aab'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(-4, 4); cx.lineTo(0, -2); cx.lineTo(5, 0); cx.stroke(); if ((T * 9 | 0) % 3 === 0) { cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(5, 0, 1.6, 0, TAU); cx.fill(); } }
  cx.rotate(-ang); cx.fillStyle = '#ffd54a'; for (let k = 0; k < min(5, (lv / 2) | 0); k++) cx.fillRect(-6 + k * 3, 8, 2, 2); // level pips
  cx.restore();
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
// v3 enemy art
Object.assign(ESPR, {
  warden: (g, R) => { shipBody(g, R, mirror([[18, 0], [8, -7], [-8, -9], [-16, -4], [-16, 0]]), 18, '#aab0c2', '#444a60'); g.strokeStyle = '#c9a0ff'; g.lineWidth = 2; g.beginPath(); g.arc(14, 0, 9, -1.2, 1.2); g.stroke(); g.fillStyle = '#d9b8ff'; g.beginPath(); g.arc(14, 0, 2.5, 0, TAU); g.fill(); for (const s of [-1, 1]) { g.fillStyle = '#2a2d33'; g.fillRect(2, 8 * s - 1, 12, 2); g.fillStyle = '#6f6'; g.fillRect(14, 8 * s - 1, 2, 2); } g.fillStyle = '#9fe'; g.fillRect(6, -2, 4, 4); },
  lancer: (g, R) => { shipBody(g, R, mirror([[26, 0], [14, -5], [-10, -8], [-24, -6], [-26, 0]]), 24, '#9aa2b0', '#3c424e'); g.fillStyle = '#20242b'; g.fillRect(8, -2.5, 24, 5); g.strokeStyle = '#39ff4a'; g.lineWidth = 1.5; for (const x of [12, 18, 24]) { g.beginPath(); g.arc(x, 0, 3.4, 0, TAU); g.stroke(); } for (const s of [-1, 1]) { poly(g, [[-6, 6 * s], [-16, 16 * s], [-24, 14 * s], [-18, 6 * s]]); g.fillStyle = '#4c525e'; g.fill(); g.strokeStyle = '#15171a'; g.stroke(); } g.fillStyle = '#ffcf6a'; g.fillRect(-27, -3, 2, 6); },
  swarm: g => { g.strokeStyle = '#555'; g.lineWidth = 1.2; for (const a of [-0.9, 0, 0.9]) { g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, a * 9); g.stroke(); } poly(g, [[9, 0], [-4, -5], [-4, 5]]); const gr = g.createLinearGradient(-4, 0, 9, 0); gr.addColorStop(0, '#333'); gr.addColorStop(1, '#8a9099'); g.fillStyle = gr; g.fill(); g.strokeStyle = '#111'; g.stroke(); g.fillStyle = '#f33'; g.beginPath(); g.arc(4, 0, 1.4, 0, TAU); g.fill(); },
  corvette: (g, R) => { shipBody(g, R, mirror([[58, 0], [48, -9], [24, -17], [-20, -20], [-46, -16], [-58, -8], [-58, 0]]), 56, '#b6bfd0', '#46506a'); shipBody(g, R, mirror([[30, 0], [14, -8], [-30, -11], [-40, -6]]), 30, '#cfd6e3', '#6b768e'); g.fillStyle = '#26324a'; g.fillRect(-10, -5, 28, 10); for (const x of [-16, 0, 16]) for (const s of [-1, 1]) { g.fillStyle = '#7d89a8'; g.fillRect(x - 3, 17 * s - (s > 0 ? 0 : 2), 6, 2); } g.fillStyle = '#9fe'; g.fillRect(40, -2.5, 8, 5); g.fillStyle = '#6f6'; for (const y of [-10, -3, 3, 10]) g.fillRect(-60, y - 1.5, 3, 3); },
  mcruiser: (g, R) => { shipBody(g, R, mirror([[66, 0], [54, -10], [30, -20], [-30, -24], [-58, -18], [-68, -8], [-68, 0]]), 64, '#c2b9a8', '#5c5040'); for (const s of [-1, 1]) { shipBody(g, R, [[46, 10 * s], [38, 26 * s], [4, 28 * s], [8, 12 * s]], 24, '#8a8f6a', '#3a3d28'); g.fillStyle = '#1a1c14'; for (let k = 0; k < 4; k++) g.fillRect(8 + k * 8, 26 * s - 2, 5, 4); g.fillStyle = '#6f6'; for (let k = 0; k < 4; k++) g.fillRect(8 + k * 8, 26 * s - 1, 5, 2); } g.fillStyle = '#2d281e'; g.fillRect(-60, -6, 8, 12); g.fillStyle = '#9fe'; g.fillRect(50, -2.5, 8, 5); g.fillStyle = '#f93'; g.fillRect(-70, -4, 3, 8); },
  carrier: (g, R) => { shipBody(g, R, mirror([[124, 0], [112, -10], [74, -26], [20, -42], [-70, -46], [-112, -38], [-124, -20], [-124, 0]]), 130, '#c6ccd6', '#4d5666'); g.fillStyle = '#2a303b'; g.fillRect(-100, -30, 150, 60); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let x = -96; x < 48; x += 14) { g.beginPath(); g.moveTo(x, -30); g.lineTo(x, 30); g.stroke(); } g.fillStyle = '#ffd24a'; for (let x = -92; x < 46; x += 14) { g.fillRect(x, -29, 6, 2); g.fillRect(x, 27, 6, 2); } shipBody(g, R, mirror([[90, 0], [70, -8], [40, -12], [40, 0]]), 40, '#dde2ea', '#7a8498'); g.fillStyle = '#9fe'; g.fillRect(100, -3, 10, 6); g.fillStyle = '#7bff9a'; for (const y of [-14, -5, 5, 14]) g.fillRect(-127, y - 2, 4, 4); },
  dreadnought: (g, R) => { const tri = [[200, 0], [-150, -110], [-150, 110]]; shipBody(g, R, tri, 200, '#cfd5df', '#4a5262'); shipBody(g, R, mirror([[150, 0], [60, -14], [-90, -52], [-136, -52], [-136, 0]]), 160, '#dfe3ea', '#6d778c'); shipBody(g, R, mirror([[70, 0], [30, -10], [-96, -30], [-126, -30], [-126, 0]]), 110, '#e8ecf2', '#8791a6'); g.strokeStyle = 'rgba(25,30,40,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(200, 0); g.lineTo(-150, 0); g.stroke(); shipBody(g, R, mirror([[-60, 0], [-70, -22], [-118, -26], [-124, 0]]), 50, '#f0f2f5', '#9aa4b8'); g.fillStyle = '#a6e0ff'; g.beginPath(); g.arc(-96, -16, 5, 0, TAU); g.arc(-96, 16, 5, 0, TAU); g.fill(); g.fillStyle = '#39ff4a'; g.globalAlpha = 0.75; g.fillRect(150, -2, 44, 4); g.globalAlpha = 1; for (const y of [-80, -52, -26, 0, 26, 52, 80]) { g.fillStyle = '#8f8'; g.fillRect(-153, y - 4, 4, 8); } },
});
Object.assign(ESIZE, { warden: [48, 40], lancer: [64, 44], swarm: [28, 24], corvette: [150, 60], mcruiser: [160, 74], carrier: [280, 120], dreadnought: [450, 290] });
// enemy shield bubble (violet: neither the player's blue nor the enemy green)
function enemyShield(x, y, r, f, T) {
  cx.save(); cx.translate(x, y); const pulse = 0.5 + sin(T * 4 + x) * 0.15;
  const gr = cx.createRadialGradient(0, 0, r * 0.7, 0, 0, r * 1.05); gr.addColorStop(0, 'rgba(180,120,255,0)'); gr.addColorStop(0.85, `rgba(190,130,255,${0.12 * pulse + 0.1 * f})`); gr.addColorStop(1, `rgba(220,180,255,${0.5 * f + 0.15})`);
  cx.fillStyle = gr; cx.beginPath(); cx.arc(0, 0, r * 1.05, 0, TAU); cx.fill();
  cx.strokeStyle = `rgba(215,170,255,${0.35 + 0.5 * f})`; cx.lineWidth = 2; cx.setLineDash([10, 6]); cx.lineDashOffset = -T * 20; cx.beginPath(); cx.arc(0, 0, r * 1.04, 0, TAU); cx.stroke(); cx.setLineDash([]); cx.restore();
}

// ---------- planets: per-pixel fractal noise on a lit sphere ----------
const PSIZE = 320;
function h3(x, y, z) { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x, y, z) { const xi = floor(x), yi = floor(y), zi = floor(z), xf = x - xi, yf = y - yi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = (i, j, k) => h3(xi + i, yi + j, zi + k); return lerp(lerp(lerp(a(0, 0, 0), a(1, 0, 0), u), lerp(a(0, 1, 0), a(1, 1, 0), u), v), lerp(lerp(a(0, 0, 1), a(1, 0, 1), u), lerp(a(0, 1, 1), a(1, 1, 1), u), v), w); }
function fbm(x, y, z, o = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vn(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ramp = (stops, t) => { for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i]; return mixc(c0, c1, (t - t0) / (t1 - t0 || 1)); } return stops[stops.length - 1][1]; };
const R3 = a => a.map(([t, c]) => [t, hex(c)]);
const PK = {
  rocky: { atm: '#ffc89a', f: 2.2, ramp: R3([[0, '#3b2c22'], [0.4, '#6b5240'], [0.6, '#9b7b5d'], [0.8, '#c4a27c'], [1, '#e8d3b0']]) },
  desert: { atm: '#ffe0a8', f: 1.8, ramp: R3([[0, '#7a4a22'], [0.4, '#b9803f'], [0.65, '#e0b878'], [1, '#f8e2b0']]), dunes: 1 },
  ice: { atm: '#bfeaff', f: 2.4, ramp: R3([[0, '#7ea8c4'], [0.5, '#cfe8f5'], [1, '#ffffff']]), cracks: 1 },
  lava: { atm: '#ff7a3a', f: 2.6, ramp: R3([[0, '#1a0a06'], [0.45, '#3a1a10'], [0.55, '#8a2a10'], [0.7, '#ff5a1a'], [1, '#ffd070']]), lava: 1 },
  ocean: { atm: '#7fc8ff', f: 2.0, sea: 0.5, deep: '#0b2f66', shallow: '#2a7ad0', land: R3([[0, '#3f7a3a'], [0.5, '#6b8f46'], [0.8, '#8a7a52'], [1, '#d8d4c4']]), clouds: 0.55, caps: 1 },
  jungle: { atm: '#9fe89a', f: 2.2, sea: 0.38, deep: '#0d3a4a', shallow: '#1f8a8c', land: R3([[0, '#134a1c'], [0.5, '#2d7a2a'], [0.8, '#5a9a3a'], [1, '#a8c070']]), clouds: 0.5, caps: 0.5 },
  toxic: { atm: '#c8ff7a', f: 2.4, ramp: R3([[0, '#2e3d10'], [0.4, '#6a8a20'], [0.7, '#b8d040'], [1, '#f0f090']]), clouds: 0.8, cloudCol: '#e8f58a' },
  gas: { atm: '#ffd9a0', bands: R3([[0, '#7a4a2a'], [0.25, '#c48a52'], [0.5, '#e6c898'], [0.75, '#a2643a'], [1, '#f2dcb0']]), spot: 1 },
  storm: { atm: '#9ad0ff', bands: R3([[0, '#1d3a5a'], [0.3, '#3c6a9a'], [0.55, '#8ab4d8'], [0.8, '#2a4a70'], [1, '#c8e0f4']]), swirl: 1 },
  ringed: { atm: '#ffe6b0', bands: R3([[0, '#a07a50'], [0.3, '#d8b888'], [0.6, '#b8946a'], [1, '#efdcb8']]), ring: 1 },
  moon: { atm: null, f: 3.0, ramp: R3([[0, '#4a4a4e'], [0.5, '#8a8a8e'], [1, '#c8c8cc']]), craters: 1 },
  city: { atm: '#7fb0ff', f: 2.0, sea: 0.48, deep: '#0a1f48', shallow: '#1a4a98', land: R3([[0, '#2a4a30'], [0.6, '#4a6a3a'], [1, '#8a8a70']]), clouds: 0.4, lights: 1 },
};
function planetCanvas(pl) {
  const key = 'P' + pl.seed + pl.kind; if (SPR[key]) return SPR[key];
  const size = PSIZE, c = SPR[key] = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const K = PK[pl.kind] || PK.rocky, R = rng(pl.seed), sd = R() * 100, C = size / 2, rad = size * (PK[pl.kind] && PK[pl.kind].ring ? 0.25 : 0.36);
  const tilt = (R() - 0.5) * 0.8, ct = cos(tilt), st = sin(tilt), L = [-0.55, -0.45, 0.7], ll = hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  const img = g.createImageData(size, size), D_ = img.data, atmC = K.atm ? hex(K.atm) : null;
  const craters = []; if (K.craters) for (let i = 0; i < 28; i++) craters.push([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1, 0.05 + R() * R() * 0.22]);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const dx = (px - C) / rad, dy = (py - C) / rad, d2_ = dx * dx + dy * dy, o = (py * size + px) * 4;
    if (d2_ > 1.0) { // atmosphere halo
      if (atmC) { const e = Math.max(0, 1 - (sqrt(d2_) - 1) / 0.16); if (e > 0) { const lit = clamp(0.35 + (dx * L[0] + dy * L[1]) * -0.5, 0.1, 1); D_[o] = atmC[0]; D_[o + 1] = atmC[1]; D_[o + 2] = atmC[2]; D_[o + 3] = e * e * 150 * lit; } }
      continue;
    }
    const dz = sqrt(1 - d2_); let x = dx, y = dy * ct - dz * st, z = dy * st + dz * ct; // rotate for axial tilt
    let col, spec = 0, night = 0;
    if (K.bands) { const warp = fbm(x * 2 + sd, y * 2, z * 2, 3) * (K.swirl ? 0.5 : 0.22); let t = (y + warp * 0.6 + sin(y * 14 + fbm(x * 3, y * 3, sd) * 3) * 0.05) * 3.2; t = (t - floor(t)); const n = fbm(x * 6 + sd, y * 14, z * 6, 4); col = ramp(K.bands, clamp(t * 0.85 + n * 0.3, 0, 1));
      if (K.spot) { const sx = x - 0.35, sy = y - 0.3, e = (sx * sx / 0.04 + sy * sy / 0.012); if (e < 1) col = mixc(col, hex('#b84a2a'), (1 - e) * 0.8); }
      if (K.swirl) { const a = atan2(y - 0.1, x + 0.2), r = hypot(x + 0.2, y - 0.1); const sw = sin(a * 2 + r * 18 + fbm(x * 4, y * 4, z * 4) * 4); if (r < 0.5) col = mixc(col, [235, 245, 255], clamp(sw * 0.4 * (0.5 - r) * 2, 0, 0.5)); } }
    else {
      const f = K.f, h = fbm(x * f + sd, y * f + sd, z * f, 6);
      if (K.sea !== undefined) { // continents + sea
        if (h < K.sea) { const t = clamp(h / K.sea, 0, 1); col = mixc(hex(K.deep), hex(K.shallow), t * t * t); spec = 0.6; } else { col = ramp(K.land, clamp((h - K.sea) / (1 - K.sea) * 1.6, 0, 1)); }
        const lat = abs(y); if (K.caps && lat > 0.82 - fbm(x * 4, y * 4, z * 4 + sd, 3) * 0.2 * K.caps - (h > K.sea ? 0.04 : 0)) col = mixc(col, [245, 248, 255], 0.85);
      } else {
        col = ramp(K.ramp, clamp(h * 1.25 - 0.1, 0, 1));
        if (K.dunes) { const dn = sin((x * 5 + fbm(x * 3, y * 3, z * 3 + sd, 3) * 4) * 3); col = mixc(col, [255, 240, 200], clamp(dn * 0.12, 0, 0.18)); }
        if (K.cracks) { const cr = abs(fbm(x * 7 + sd, y * 7, z * 7, 3) - 0.5); if (cr < 0.018) col = mixc(col, [90, 140, 190], 0.7); }
        if (K.lava) { const cr = abs(fbm(x * 4.5 + sd, y * 4.5, z * 4.5, 4) - 0.5); if (cr < 0.045) { col = mixc(col, [255, 150, 40], 1 - cr / 0.045); night = 1; } }
        if (K.craters) for (const q of craters) { const cd = hypot(x - q[0], y - q[1], z - q[2]); if (cd < q[3] && z > -0.1) { const t = cd / q[3]; col = mixc(col, t > 0.8 ? [220, 220, 224] : [50, 50, 54], t > 0.8 ? (t - 0.8) * 3 : (0.8 - t) * 0.6); } }
      }
      { const dt3 = fbm(x * K.f * 4 + sd * 3, y * K.f * 4, z * K.f * 4, 3), sl = fbm(x * K.f * 9 + sd, y * K.f * 9, z * K.f * 9, 2); col = [col[0], col[1], col[2]].map(v => v * (0.84 + 0.3 * dt3 + 0.06 * (sl - 0.5))); }
      if (K.clouds) { const cl = fbm(x * 3.2 + sd * 2, y * 3.6, z * 3.2, 5); const cc = clamp((cl - (0.72 - K.clouds * 0.25)) * 3.4, 0, 0.8); if (cc > 0) col = mixc(col, K.cloudCol ? hex(K.cloudCol) : [250, 252, 255], cc); }
    }
    // lighting: lambert + terminator softness; atmosphere limb glow
    const nx = dx, ny = dy, nz = dz, lam = nx * L[0] + ny * L[1] + nz * L[2], lit = clamp(lam * 1.15 + 0.08, 0, 1), amb = 0.07;
    let sh = amb + (1 - amb) * lit * lit * (3 - 2 * lit);
    if (K.lights && lit < 0.25) { const cn = fbm(x * 14 + sd, y * 14, z * 14, 3); if (cn > 0.62 && (K.sea === undefined || fbm(x * K.f + sd, y * K.f + sd, z * K.f, 6) > K.sea)) { const li = (cn - 0.62) * 6 * (0.25 - lit) * 4; col = mixc(col, [255, 210, 120], clamp(li, 0, 1)); sh = max(sh, 0.5 * clamp(li, 0, 1)); } }
    let r = col[0] * sh, gg = col[1] * sh, b = col[2] * sh;
    if (night) { r += col[0] * 0.5 * (1 - sh); gg += col[1] * 0.3 * (1 - sh); }
    if (spec) { const hh = clamp(nx * (L[0]) + ny * (L[1]) + nz * (L[2] + 1), 0, 2) / 2; const sp = Math.pow(hh, 40) * spec * lit; r += 255 * sp; gg += 255 * sp; b += 255 * sp; }
    if (atmC) { const rim = Math.pow(1 - nz, 2.6) * (0.2 + 0.8 * clamp(lam + 0.4, 0, 1)); r = r * (1 - rim * 0.6) + atmC[0] * rim * 0.6; gg = gg * (1 - rim * 0.6) + atmC[1] * rim * 0.6; b = b * (1 - rim * 0.6) + atmC[2] * rim * 0.6; }
    const edge = clamp((1 - sqrt(d2_)) * rad / 1.5, 0, 1);
    D_[o] = r; D_[o + 1] = gg; D_[o + 2] = b; D_[o + 3] = 255 * edge;
  }
  g.putImageData(img, 0, 0);
  if (K.ring) { // tilted ring: back half behind the planet already hidden by painting order -> draw whole ring, then redraw the planet front over the near half
    const rr = rad * 1.9, ry = rr * 0.28, rot = -0.35 + (R() - 0.5) * 0.3;
    const pl2 = document.createElement('canvas'); pl2.width = pl2.height = size; pl2.getContext('2d').drawImage(c, 0, 0);
    g.clearRect(0, 0, size, size);
    const drawRing = (back) => { g.save(); g.translate(C, C); g.rotate(rot); g.beginPath(); g.rect(-size, back ? -size : 0, size * 2, size); g.clip();
      for (let k = 0; k < 14; k++) { const t = k / 13, r0 = rr * (0.62 + t * 0.38), a = 0.12 + 0.45 * abs(sin(k * 1.9 + pl.seed)) * (k % 5 === 4 ? 0.2 : 1); g.strokeStyle = `rgba(${220 - k * 3},${196 - k * 4},${150 - k * 4},${a})`; g.lineWidth = rr * 0.035; g.beginPath(); g.ellipse(0, 0, r0, r0 * 0.28, 0, 0, TAU); g.stroke(); } g.restore(); };
    drawRing(true); g.drawImage(pl2, 0, 0); drawRing(false);
  }
  return c;
}

// starfield + nebula
const STARS = []; for (let l = 0; l < 3; l++) for (let i = 0; i < 120; i++) STARS.push({ l, x: random() * 2000, y: random() * 2000, s: random() * 1.3 + 0.3 + l * 0.35, c: ['#9bf', '#fff', '#ffd', '#cdf'][floor(random() * 4)] });
const neb = document.createElement('canvas'); neb.width = neb.height = 512; { const g = neb.getContext('2d'); for (let i = 0; i < 9; i++) { const x = random() * 512, y = random() * 512, r = 80 + random() * 160, col = ['#3a1a6a', '#6a1a3a', '#1a3a6a', '#2a1050'][i % 4]; for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, col + '40'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); } } }
const glowC = {}; function glow(col, r) { if (col.length === 4) col = '#' + col[1] + col[1] + col[2] + col[2] + col[3] + col[3]; const k = col + r; if (glowC[k]) return glowC[k]; const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, col); gr.addColorStop(0.35, col + '88'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return glowC[k] = c; }

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
SFX.lance = function () { tone(90, 0.9, 'sawtooth', 0.14, 900); noise(0.7, 0.15, 3000, 200, 'bandpass'); };
// ---------- section / port names ----------
function portInfo(role, slot) { const c = lastSnap && lastSnap.crew[role]; const p = c && c[7] && c[7][slot]; if (!p) return null; const t = TREES[TREE_OF[role]].ports.find(x => x[0] === p[0]); return { id: p[0], lv: p[1], name: t ? t[1] : p[0], desc: t ? t[2] : '' }; }
function secName(k) { if (k < 6) return PORT_NAMES[k]; const r = (k - 6) >> 1, sl = (k - 6) & 1, p = portInfo(r, sl); return RSHORT[r] + ' ' + (p ? p.name : 'port ' + (sl + 1)); }
function secShort(k) { if (k < 6) return PORT_NAMES[k].replace(' Gun Turret', ' Gun').replace('Deflector Generator', 'Deflector'); const r = (k - 6) >> 1, sl = (k - 6) & 1, p = portInfo(r, sl); return RSHORT[r] + ' ' + (p ? p.name : 'port'); }
const secRole = k => k < 6 ? k : (k - 6) >> 1;
const hitT = new Map(), floaters = [];
function evName(i) { const c = lastSnap && lastSnap.crew[i]; return c ? c[0] : RNAME[i]; }
function secWorldLocal(k, mk) { const g = GEO[mk]; return k < 6 ? g.st[k] : (g.po[(k - 6) >> 1][(k - 6) & 1] || g.st[(k - 6) >> 1]); }
function processEvents(s) {
  for (const e of s.ev) {
    const k = e[0];
    if (k === 'b') { bolts.set(e[1], { x: e[2], y: e[3], vx: e[4], vy: e[5], kind: e[6], life: e[7] }); SFX.laser(e[6], e[2]); if (e[6] !== 4) P({ k: 2, x: e[2], y: e[3], life: 0.06, max: 0.06, r: 10, c: PLAYER_RED }); }
    else if (k === 'x') { const b = bolts.get(e[1]); if (b) { sparks(b.x, b.y, 4, '#ff8a60', 140, 0.25, 1.5); bolts.delete(e[1]); } }
    else if (k === 'ef') { P({ k: 2, x: e[1], y: e[2], life: e[4] ? 0.25 : 0.08, max: e[4] ? 0.25 : 0.08, r: e[4] ? 30 : 12, c: ENEMY_GREEN }); SFX.elaser(e[3], e[1], e[4]); }
    else if (k === 'boom') explosion(e[1], e[2], e[3], e[4]);
    else if (k === 'hit') hitT.set(e[3], performance.now());
    else if (k === 'esh') { hitT.set(e[3], performance.now()); sparks(e[1] + (random() - .5) * 40, e[2] + (random() - .5) * 40, 3, '#d6a8ff', 120, 0.25, 1.5); if (gate('esh', 60)) tone(1500, 0.07, 'triangle', 0.04, 900, e[1]); }
    else if (k === 'shk') { ring(e[1], e[2], 6, e[3] * 1.4, 0.5, '#d6a8ff', 4); sparks(e[1], e[2], 24, '#e6c8ff', 260, 0.6, 2.2); toast('Enemy shield broken: hit the hull now', '#d6a8ff'); tone(300, 0.4, 'sawtooth', 0.07, 1200, e[1]); }
    else if (k === 'arm') { sparks(e[1], e[2], 5, '#cfe6ff', 160, 0.25, 1.5); SFX.armor(e[1]); }
    else if (k === 'pk') { explosion(e[3], e[4], 1, 14); toast(e[5] ? '💥 Enemy shipping dock destroyed: no more fighters' : '💥 Enemy gun port destroyed', '#ffcf6a'); }
    else if (k === 'dock') { ring(e[1], e[2], 4, 40, 0.4, '#ffd24a', 3); sparks(e[1], e[2], 10, '#ffd24a', 120, 0.4, 2); SFX.launch(); }
    else if (k === 'pd') { sparks(e[1], e[2], 6, ENEMY_GREEN, 160, 0.25, 1.5); SFX.pd(e[1]); }
    else if (k === 'blk') { ring(e[1], e[2], 2, 24, 0.25, SHIELD_BLUE, 2); sparks(e[1], e[2], 5, SHIELD_BLUE, 120, 0.25, 1.5); SFX.block(e[3], e[1]); }
    else if (k === 'shb') { toast('🛡 SHIELD DOWN: 20s to power back up', '#7ab8ff'); tone(500, 0.6, 'sawtooth', 0.09, 70); if (lastSnap) { const sh = lastSnap.sh; ring(sh.x, sh.y, 40, 130, 0.5, SHIELD_BLUE, 5); sparks(sh.x, sh.y, 30, SHIELD_BLUE, 260, 0.6, 2); } if (me.role === SHIELD) banner('SHIELD DOWN<br><span style="font-size:.5em">20s recharge</span>', 1.6); }
    else if (k === 'shu') { toast('🛡 Shield online', '#7ab8ff'); [600, 900, 1300].forEach((f, i) => tone(f, 0.15, 'triangle', 0.07, null, null, i * 0.06)); }
    else if (k === 'lance') { SFX.lance(); shake = max(shake, 8); toast(e[1] ? '🛡 NOVA LANCE: shield fired in all directions' : '🛡 SHIELD LANCE fired', '#7ab8ff'); }
    else if (k === 'flare') { ring(e[1], e[2], 10, 360, 0.5, '#ffd890', 3); tone(900, 0.3, 'triangle', 0.07, 200); }
    else if (k === 'warp') { ring(e[1], e[2], 40, 4, 0.4, '#bff', 3); ring(e[3], e[4], 4, 50, 0.4, '#bff', 3); tone(200, 0.35, 'sine', 0.1, 1600); }
    else if (k === 'graze') { sparks(e[1], e[2], 6, '#fff', 150, 0.3, 1.5); }
    else if (k === 'sh') { sparks(e[1], e[2], 14, '#ff6a3a', 260, 0.5, 2); SFX.hit(); shake = max(shake, 9); if (secRole(e[3]) === me.role) { flash = 0.35; flashC = '#f00'; } }
    else if (k === 'sd') { toast('⚠ ' + secName(e[1]) + ' DESTROYED: on fire, benefits lost', '#f66'); SFX.alarm();
      if (e[1] === REPAIR) banner(me.role === REPAIR ? 'YOUR REPAIR BAY IS DESTROYED<br><span style="font-size:.5em">no repairs or drones until your crew fixes it</span>' : 'REPAIR BAY DESTROYED!<br><span style="font-size:.5em;color:#ffd54a">REPAIR IT IMMEDIATELY · CLICK RAPIDLY</span>', 3.2);
      else if (e[1] === me.role) banner('YOUR STATION IS DOWN<br><span style="font-size:.5em">the Repair crew must click it to repair it</span>', 2.6); }
    else if (k === 'dr') { if (me.role === REPAIR) toast(e[1] ? '🛸 Drone disabled: repairs are 50% faster' : '🛸 Drone launched', e[1] ? '#6f6' : '#6df'); }
    else if (k === 'sr') { toast('✔ ' + secName(e[1]) + ' back online', '#7f7'); SFX.fixed(); }
    else if (k === 'port') { toast('🛠 ' + RSHORT[e[1]] + ' port ' + (e[2] + 1) + ' installed: ' + (portInfo(e[1], e[2]) || { name: e[3] }).name, '#6df'); SFX.core(); }
    else if (k === 'cv') { SFX.coin(); }
    else if (k === 'pip') { if (me.role === ENG) SFX.pip(); }
    else if (k === 'ab') { const a = ABIL[e[2]]; if (e[1] === me.role) SFX.ability(); else if (a && a.buff) toast('⚡ ' + evName(e[1]) + ': ' + a.n, '#ffd54a'); if (e[2] === 'cry') { banner('⚔ BATTLE CRY', 1.4); SFX.buff(); } if ((e[2] === 'aegis' || e[2] === 'surge' || e[2] === 'rally' || e[2] === 'medic') && e[1] !== me.role) SFX.buff(); }
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
    else if (k === 'ms') { const lv = e[3] | 0; banner(e[1] + '<br><span style="font-size:.45em">' + (MTYPES[e[2]] || {}).n + ' · Lv ' + lv + '</span>', 2.4); SFX.wave();
      const fk = 'tss_full_' + me.code;
      if (lv > EFIRE_WEAK_LV) { if (!localStorage.getItem(fk)) { localStorage.setItem(fk, '1'); setTimeout(() => { banner('LEVEL ' + lv + ': ENEMY FIRE IS NOW AT FULL STRENGTH<br><span style="font-size:.45em;color:#ffd54a">levels 1–' + EFIRE_WEAK_LV + ' had ' + round((1 - EFIRE_WEAK) * 100) + '% weaker enemy bullets</span>', 5); SFX.alarm(); }, 2600); toast('⚠ Enemy fire is now at FULL strength (level ' + lv + '+)', '#f88'); } else toast('Enemy fire: full strength', '#f88'); }
      else toast('ℹ Level ' + lv + ': enemy bullet damage reduced by ' + round((1 - EFIRE_WEAK) * 100) + '% (full strength from level ' + (EFIRE_WEAK_LV + 1) + ')', '#9cf'); }
    else if (k === 'win') { banner('MISSION COMPLETE', 2.4); SFX.win(); }
    else if (k === 'lose') { banner('SHIP LOST', 2.4); SFX.lose(); }
    else if (k === 'mk') { toast('🛠 Ship upgraded to ' + MK_NAMES[e[1]] + ': the hull grew new hard-points', '#6df'); SFX.core(); }
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
  o.eb = b.eb.map(q => { if (q[7]) { const p = a.bMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), q[3], q[4], q[5]] : q; }
    const dt_ = rt - b.tm, d_ = q[6] * (a.bMap.has(q[0]) ? dt_ : max(0, dt_)); return [q[0], q[1] + cos(q[3]) * d_, q[2] + sin(q[3]) * d_, q[3], q[4], q[5]]; }); // v4: non-homing shots are extrapolated along one straight line
  o.pp = b.pp.map(q => { const p = a.pMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), lerpA(p[3], q[3], t), q[4]] : q; });
  o.al = b.al.map(q => { const p = a.aMap.get(q[0]); return p ? [q[0], q[1], L(p, q, 2), L(p, q, 3), lerpA(p[4], q[4], t), q[5], q[6]] : q; });
  o.wv = b.wv; o.pk = b.pk.map(q => { const p = a.kMap.get(q[0]); return p ? [q[0], L(p, q, 1), L(p, q, 2), q[3]] : q; });
  while (snaps.length > 2 && snaps[1].tm < rt - 0.5) snaps.shift();
  return o;
}

// ---------- input ----------
let lastAct = performance.now(); for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel']) addEventListener(ev, () => lastAct = performance.now(), { passive: true, capture: true });
const K = {}; let mouse = { x: 0, y: 0, down: 0 }, thr = 0.65, rtSel = -1, acts = [];
const joy = { on: 0, id: null, vx: 0, vy: 0, lastA: -PI / 2 }, tb = { f: 0, as: 0 };
function act(a) { acts.push(a); }
function rapTake() { const n = rapClicks; rapClicks = 0; return n; }
function setThr(v) { thr = clamp(v, 0.25, 1); }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && !joined) launch(); return; }
  const k = e.key.toLowerCase(); if (k === ' ' || k === 'tab') e.preventDefault(); if (K[k]) return; K[k] = 1; audioInit(); if (!joined) return;
  if (k === 'q' || k === 'e' || k === 'r') act(k);
  if (k === 'm') setMute(!A.muted); if (k === 'n') setMusic(!A.music);
  if (k === 'h' || k === '?') toggleCard(); if (k === 'tab') togglePanel('rolesp'); if (k === 'u') togglePanel('upp');
  if (k === 'escape') { $('rolesp').classList.add('hide'); $('upp').classList.add('hide'); $('card').classList.add('hide'); }
  if (me.role === ENG && k >= '1' && k <= '4') act('p' + k);
  if (me.role === REPAIR && k === 'g') act('dr');
  if (k === ' ' && me.role !== REPAIR && lastSnap && lastSnap.ph === 'mission' && lastSnap.sh.dn[REPAIR]) rapHit();
  if (me.role === REPAIR && k >= '0' && k <= '6') rtSel = k === '0' ? 18 : +k - 1;
  if (me.role === ENG && (k === 'w' || k === 'arrowup')) setThr(thr + 0.125); if (me.role === ENG && (k === 's' || k === 'arrowdown')) setThr(thr - 0.125);
});
addEventListener('keyup', e => { K[e.key.toLowerCase()] = 0; });
addEventListener('blur', () => { for (const k in K) K[k] = 0; mouse.down = 0; });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { audioInit(); mouse.x = e.clientX; mouse.y = e.clientY; if (e.button !== 2) mouse.down = 1; });
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
  tap('t-q', () => act('q')); tap('t-e', () => act('e')); tap('t-r', () => act('r')); tap('t-up', () => togglePanel('upp'));
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
  send({ t: 'i', ax: round(ax), ay: round(ay), f: fire ? 1 : 0, as: K.f || tb.as ? 1 : 0, thr: round(thr * 1000) / 1000, rt: rtSel, mb: me.role === REPAIR && MG.key ? round(MG.boost * 100) / 100 : 0, ck: rapTake(), idle: performance.now() - lastAct > 30000 ? 1 : 0, a: acts.splice(0, 6) });
}, 50);

// ---------- UI ----------
function toast(m, c) { const d = document.createElement('div'); d.innerHTML = m; if (c) d.style.color = c; $('toasts').appendChild(d); setTimeout(() => d.remove(), 3300); while ($('toasts').children.length > 4) $('toasts').firstChild.remove(); }
let bannerT = 0; function banner(t, d = 2) { $('banner').innerHTML = t; bannerT = d; }
let cardTimer = null;
function abilityList(r) { const T = TREES[TREE_OF[r]], inn = D.INNATE[TREE_OF[r]], P = me.tr && me.tr[TREE_OF[r]], l = []; if (inn) l.push(`<b class="y">Q</b> ${ABIL[inn].n}`); if (P) P.path.forEach((i, rw) => { const n = T.rows[rw][i]; if (n && n.ab) l.push(`<b class="y">${rw < 2 ? 'E' : 'R'}</b> ${ABIL[n.ab].n}`); }); return l.join(' · ') || 'none yet'; }
function showCard() {
  const r = me.role; if (r < 0) return;
  $('card').innerHTML = `<span class="x">H toggles · click to close</span><h2>${RICON[r]} YOU ARE: ${RNAME[r]} · ${PORT_NAMES[r]}</h2><div>${ROLE_HELP[r]}</div><div style="margin-top:4px">Abilities: ${abilityList(r)}</div><div class="small" style="margin-top:6px;color:#bb9">${COMMON}${isTouch ? '<br>Touch: stick aims · FIRE · Q/E/R abilities · ASSIST · ★ upgrades' : ''}</div>`;
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
// ----- upgrade screen: skill pyramid -----
let upTree = 'pilot', portPending = null;
const TREE_LABEL = { pilot: 'Pilot', gun: 'Gunners', engineer: 'Engineer', shield: 'Shields', repair: 'Repair/Drone' };
const cap1 = t => t.charAt(0).toUpperCase() + t.slice(1);
const fxHtml = ls => ls.map(l => { const [a, b] = l.split(': '); return `<span class="fxl"><u>${cap1(a)}</u>: ${b}</span>`; }).join('');
function nodeText(n, P, r, mk) {
  if (n.ab) return `<small>${n.d}</small>`;
  const P2 = { path: P.path.slice(0, r), i: {}, b: {} };   // stats before this row: what the node changes, current -> next
  return `<small class="fxs">${fxHtml(D.fxLines(upTree, P2, n.fx, mk))}${n.edge ? '<span class="fxe">edge bonus +25% included</span>' : ''}</small>`;
}
function pyrNode(T, P, r, i, mk, inMission) {
  const n = T.rows[r][i], picked = P.path[r] === i, next = P.path.length === r, done = P.path.length > r;
  const allowed = next && pyrAllowed(P.path, r).includes(i), cost = NODE_COST[r], can = allowed && me.cr >= cost && !inMission;
  const cls = ['pn', picked ? 'own' : '', allowed ? 'ok' : '', done && !picked ? 'skip' : '', !done && !allowed ? 'lock' : '', n.ab ? 'act' : '', n.edge ? 'edge' : '', n.cap ? 'cap' : ''].join(' ');
  const tag = n.ab ? `<span class="y">[${r < 2 ? 'E' : 'R'}]</span> ` : '';
  return `<button class="${cls}" style="grid-column:${r + 2 * i + 1}/span 2;grid-row:${r + 1}" data-buy="node" data-id="${n.id}" ${can ? '' : 'disabled'} title="${n.d.replace(/"/g, '&quot;')}"><b>${picked ? '✔ ' : ''}${tag}${n.n}</b>${nodeText(n, P, r, mk)}<i>${picked ? 'PICKED' : allowed ? cost + '¢' : done ? '' : 'row ' + (r + 1)}${n.edge ? ' · ◀▶ edge' : ''}</i></button>`;
}
function renderUp() {
  if (me.role < 0 || !me.tr || !lastSnap) return;
  const s = lastSnap, mk = s.mk, T = TREES[upTree], P = me.tr[upTree], inMission = s.ph === 'mission' || s.ph === 'result';
  const btn = (attrs, html, dis, cls = '') => `<button class="nd ${cls}" ${attrs} ${dis ? 'disabled' : ''}>${html}</button>`;
  const myT = TREE_OF[me.role];
  let h = `<h2>★ UPGRADES · <span class="y">${me.cr} ¢</span> · <span class="c">${s.co} ◆ crew cores</span> · ${MK_NAMES[mk]}</h2>`;
  h += `<div class="row" style="margin:4px 0">${Object.keys(TREES).map(k => `<button data-tree="${k}" style="flex:0 0 auto;min-width:0;${k === upTree ? 'border-color:#ffd54a;color:#ffd54a' : ''}">${TREE_LABEL[k]}${k === myT ? ' (you)' : ''}</button>`).join('')}</div>`;
  if (inMission) h += '<div class="small r">Purchases unlock after the mission. You can still plan here.</div>';
  h += `<div class="small">Credits come from kills, big-ship drops and a completion bonus (the whole crew earns the same). Missions are long: expect to need <b>many</b> to finish a tree. Cores (◆) are rare and shared: Mk II costs ${MK_COST[1]} ◆, Mk III ${MK_COST[2]} ◆. After Mk III each spare ◆ converts to <b>${CORE_RATE} ¢</b> per crew member.</div>`;
  // ship tier panel
  const nextMk = mk + 1;
  h += `<div class="mkrow"><canvas id="mkprev" width="260" height="110"></canvas><div>` + (nextMk <= 2
    ? `<div class="small">Ship upgrade: the hull physically grows (Mk II and III are larger) and every crew station gains <b>one new permanent port socket</b>.</div><button data-mk ${s.co < MK_COST[nextMk] || inMission ? 'disabled' : ''} style="border-color:#6df;margin-top:4px">🛠 Upgrade ship to <b>${MK_NAMES[nextMk]}</b> · ${MK_COST[nextMk]} ◆ (crew-wide, resets damage)</button>`
    : `<div class="small g">Ship fully upgraded (Mk III).</div><button data-core ${s.co < 1 || inMission ? 'disabled' : ''} style="border-color:#ffd54a;margin-top:4px">◆ → ¢ Convert 1 core into ${CORE_RATE} ¢ for every crew member (${s.co} ◆ banked)</button>`) + `</div></div>`;
  // pyramid
  const pr = P.path.length;
  h += `<h4 class="ph">${T.name || TREE_LABEL[upTree]} skill pyramid <span class="small">· pick ONE node per row, top to bottom. The next row only offers the nodes touching your last pick (an edge pick leaves one choice, a middle pick two). Edge nodes are ~25% stronger; the bottom two are the best.${pr >= 5 ? ' <b class="g">Complete.</b>' : ' Now choosing row ' + (pr + 1) + ' of 5 · ' + NODE_COST[pr] + '¢'}</span></h4>`;
  h += '<div class="pyr">' + T.rows.map((row, r) => row.map((n, i) => pyrNode(T, P, r, i, mk, inMission)).join('')).join('') + '</div>';
  h += '<div class="row">' + T.inf.map(x => { const lv = P.i[x[0]] || 0, c = infCost(lv), cap = infCap(upTree, x[0], lv); return btn(`data-buy="inf" data-id="${x[0]}"`, `<b>${x[1]}</b> · Lv ${lv} · ${cap ? 'MAX' : c + '¢'}<small class="fxs">${fxHtml(D.fxLines(upTree, P, { [x[2]]: x[3] }, mk))}<span class="fxe">${x[0] === 'i_arc' ? 'each level +5°, max 90°' : 'every level adds the same, no cap'}</span></small>`, cap || me.cr < c || inMission); }).join('') + '</div>';
  h += '<div class="row">' + T.big.map(x => { const own = P.b[x[0]]; return btn(`data-buy="big" data-id="${x[0]}"`, `${own ? '✔ ' : '★ '}<b>${x[1]}</b> ${own ? '' : '· ' + x[3] + '¢'}${x[4] > mk ? ` · <span class="c">needs ${MK_NAMES[x[4]]}</span>` : ''}<small class="fxs"><span class="fxl">${x[2]}</span>${Object.keys(x[5] || {}).length ? fxHtml(D.fxLines(upTree, P, x[5], mk)) : ''}</small>`, own || me.cr < x[3] || x[4] > mk || inMission, own ? 'own' : ''); }).join('') + '</div>';
  // ports (this seat only; permanent)
  if (upTree === myT) {
    const crew = s.crew[me.role], inst = crew[7] || [0, 0];
    h += `<h4 class="ph">Ship ports for your station (${RNAME[me.role]}) <span class="small">· a port is a real section on the hull: it can be destroyed on its own (small fire, benefits lost) and each port is upgraded separately. <b class="r">A port choice is permanent.</b></span></h4><div class="row">`;
    for (let sl = 0; sl < 2; sl++) {
      h += `<div class="col"><h4>Port ${sl + 1} ${sl >= mk ? `<span class="c">(needs ${MK_NAMES[sl + 1]})</span>` : ''}</h4>`;
      const p = inst[sl];
      if (p) { const t = T.ports.find(x => x[0] === p[0]), lv = p[1], c = portUpCost(lv); h += `<div class="nd own"><b>✔ ${t[1]}</b> · Lv ${lv}/${PORT_MAX_LV}<small>${t[2]}<span class="fxs"><span class="fxl"><u>Port effect</u>: ${100 + 12 * lv}% ${lv < PORT_MAX_LV ? '→ ' + (100 + 12 * (lv + 1)) + '%' : '(max)'}</span><span class="fxl"><u>Section HP</u>: +${(0.4 * lv).toFixed(1)} ${lv < PORT_MAX_LV ? '→ +' + (0.4 * (lv + 1)).toFixed(1) : '(max)'}</span></span></small></div>` + btn(`data-pup="${sl}"`, lv >= PORT_MAX_LV ? 'Fully upgraded' : `▲ Upgrade ${t[1]} → Lv ${lv + 1} · ${c}¢`, lv >= PORT_MAX_LV || me.cr < c || inMission); }
      else h += T.ports.map(p => { const pend = portPending && portPending[0] === sl && portPending[1] === p[0]; return btn(`data-port="${sl}" data-id="${p[0]}"`, `<b>${pend ? '⚠ CLICK AGAIN: PERMANENT · ' : ''}${p[1]}</b> · ${PORT_COST[sl]}¢<small class="fxs"><span class="fxl">${p[2]}</span><span class="fxl"><u>Starts at</u>: effect 112%, section HP +0.4 (each level +12% / +0.4)</span></small>`, sl >= mk || me.cr < PORT_COST[sl] || inMission, pend ? 'warn' : ''); }).join('');
      h += '</div>';
    }
    h += '</div>';
  } else h += '<div class="small">Switch to that station (⇄) to buy ports for it.</div>';
  h += '<div id="upfoot"><span id="upst" class="small"></span><span><button data-close>Close (U)</button> <button id="rdy" class="hide">READY ✔</button></span></div>';
  $('upp').innerHTML = h; upFoot();
  { const c = $('mkprev').getContext('2d'); c.clearRect(0, 0, 260, 110); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, 260, 110); const sp = playerSprite(mk), W0 = sp.hw * 2, H0 = sp.hh * 2, sc = min(1, 150 / W0, 100 / H0); c.drawImage(sp, 80 - W0 * sc / 2, 55 - H0 * sc / 2, W0 * sc, H0 * sc);
    if (nextMk <= 2) { const sp2 = playerSprite(nextMk), W2 = sp2.hw * 2, H2 = sp2.hh * 2, sc2 = min(1, 110 / W2, 100 / H2); c.globalAlpha = 0.6; c.drawImage(sp2, 200 - W2 * sc2 / 2, 55 - H2 * sc2 / 2, W2 * sc2, H2 * sc2); c.globalAlpha = 1; c.fillStyle = '#6df'; c.font = '16px monospace'; c.fillText('▶', 142, 60); } }
  $('upp').querySelectorAll('[data-tree]').forEach(b => b.onclick = () => { upTree = b.dataset.tree; SFX.ui(); renderUp(); });
  $('upp').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { send({ t: 'buy', tree: upTree, kind: b.dataset.buy, id: b.dataset.id }); SFX.coin(); });
  $('upp').querySelectorAll('[data-port]').forEach(b => b.onclick = () => { const sl = +b.dataset.port, id = b.dataset.id; if (portPending && portPending[0] === sl && portPending[1] === id) { send({ t: 'buy', tree: upTree, kind: 'port', id, slot: sl }); portPending = null; SFX.core(); } else { portPending = [sl, id]; SFX.ui(); renderUp(); } });
  $('upp').querySelectorAll('[data-pup]').forEach(b => b.onclick = () => { send({ t: 'buy', tree: upTree, kind: 'pup', slot: +b.dataset.pup }); SFX.coin(); });
  const mb = $('upp').querySelector('[data-mk]'); if (mb) mb.onclick = () => { send({ t: 'mk' }); SFX.core(); };
  const cb = $('upp').querySelector('[data-core]'); if (cb) cb.onclick = () => { send({ t: 'core' }); SFX.coin(); };
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
  $('mcards').innerHTML = s.opts.map((o, i) => { const v = s.votes[o.id] || 0, M = MTYPES[o.type]; return `<div class="mc ${o.kind} ${s.my === o.id ? 'voted' : ''}" data-id="${o.id}"><canvas width="240" height="120" data-pl="${i}"></canvas><span class="${o.kind === 'main' ? 'y' : 'small'}">${o.kind === 'main' ? '★ MAIN MISSION' : '◇ SIDE MISSION'}</span> · <span class="d${o.diff}">${DIFFS[o.diff].n}</span> · Lv ${o.level}<b>${o.planet.name}</b><span class="c">${M.n}</span><br><span class="small">${M.d}${o.mod && o.mod !== 'none' ? ' · ☄ ' + o.mod : ''}</span><br><span class="small" style="color:${o.level > EFIRE_WEAK_LV ? '#f99' : '#9cf'}">${o.level > EFIRE_WEAK_LV ? '⚠ enemy fire: FULL strength' : 'enemy fire: -' + round((1 - EFIRE_WEAK) * 100) + '% (levels 1–' + EFIRE_WEAK_LV + ')'}</span><br><span class="small">Reward ×${DIFFS[o.diff].m}${o.diff >= 2 || o.kind === 'main' ? ' · +1 ◆ core' : ''}</span><br><span class="v">${v ? '▮'.repeat(min(v, 12)) + ' ' + v : ''}</span></div>`; }).join('');
  $('mcards').querySelectorAll('canvas[data-pl]').forEach(c => { const o = s.opts[+c.dataset.pl], g = c.getContext('2d'); g.drawImage(neb, 0, 0, 240, 120); for (let i = 0; i < 30; i++) { g.fillStyle = '#fff'; g.fillRect((i * 97) % 240, (i * 53) % 120, 1, 1); } g.drawImage(planetCanvas(o.planet), 40, -22, 160, 160); });
  $('mcards').querySelectorAll('.mc').forEach(d => d.onclick = () => { send({ t: 'vote', id: d.dataset.id }); SFX.ui(); });
}
function phaseChange(from, to, s) {
  $('map').classList.toggle('hide', to !== 'map'); if (to === 'map') renderMap.key = '';
  if (to === 'upgrade') { upTree = TREE_OF[me.role] || 'pilot'; $('rolesp').classList.add('hide'); $('upp').classList.remove('hide'); renderUp(); }
  if (from === 'upgrade' && to === 'map') $('upp').classList.add('hide');
  if (to === 'result' && s.res) setTimeout(() => { const r = s.res; banner((r.win ? 'MISSION COMPLETE' : 'SHIP LOST') + `<br><span style="font-size:.45em">${r.win ? `+${r.bonus} ¢ completion bonus${r.cores ? ' · +' + r.cores + ' ◆' : ''}` : 'Regroup, upgrade, try again'}</span>`, 2.6); }, 300);
  if (to === 'mission' && !$('upp').classList.contains('hide')) $('upp').classList.add('hide');
}
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
  $('crew').innerHTML = s.crew.map((c, i) => crewLine(s, c, i)).join('');
  if (s.ph === 'map') renderMap(s);
  if (s.ph === 'upgrade' || !$('upp').classList.contains('hide')) upFoot();
  if (isTouch) $('touch').style.visibility = (!$('upp').classList.contains('hide') || !$('rolesp').classList.contains('hide') || !$('map').classList.contains('hide')) ? 'hidden' : '';
  const inM = s.ph === 'mission' && me.role >= 0;
  $('abar').classList.toggle('hide', !inM || isTouch); $('engp').classList.toggle('hide', !(inM && me.role === ENG)); $('repp').classList.toggle('hide', !(inM && me.role === REPAIR)); rapPanel(s);
  if (inM) { if (isTouch) touchLabels(s); else abilityBar(s); if (me.role === ENG) engPanel(s); if (me.role === REPAIR) repPanel(s); }
  const myB = me.role >= 0 ? s.crew[me.role][6] : []; $('buffs').innerHTML = inM && myB.length ? myB.map(b => ({ cry: '⚔ Battle Cry', reroute: '⚡ Rerouted engine power', rhalf: '⚡ Split power', stim: '💉 Stim', over: '🔥 Overcharge', ovl: '⚡ Overload' }[b] || b)).join(' · ') : '';
}
// ----- live HUD pieces (v3) -----
const HINTS = [[['Click', 'nose laser'], ['Aim', 'steer']], [['Click', 'fire turrets']], [['Click a port', 'start repair'], ['G', 'drone off: +50%']], [['W/S', 'throttle'], ['1·2·3·4', 'power']], [['Aim', 'aim the arc'], ['Ship turns', 'arc stays put']], [['Click', 'fire turrets']]];
function crewLine(s, c, i) { const sh = s.sh, down = []; for (let k = 0; k < 18; k++) if (sh.dn[k] && secRole(k) === i) down.push(secShort(k)); return `<div class="${i === me.role ? 'me' : c[1] ? 'bot' : ''} ${down.length ? 'dn' : ''}">${RICON[i]} ${RSHORT[i]} ${c[1] ? '🤖' : '👤'} ${c[0]}${c[4] ? ' (idle·bot)' : ''}${c[3] ? ' 🔧' : ''}${down.length ? ' ✖ ' + down.join(', ') + ' DOWN' : ''}${c[6].length ? ' <span class="y">' + c[6].map(b => '⚡' + b).join(' ') + '</span>' : ''}</div>`; }
function abilityBar(s) {
  const r = me.role, ab = s.crew[r][5], key = r + '|' + ab.map(a => a ? a[0] : '-').join();
  if (key !== abKey) {
    abKey = key; const lbl = ['Q', 'E', 'R'];
    $('abar').innerHTML = [0, 1, 2].map(i => { const a = ab[i]; return `<div class="ab ${a ? '' : 'lock'} ${a && ABIL[a[0]].buff ? 'buff' : ''}" data-slot="${i}" title="${a ? ABIL[a[0]].d : 'Pick an active node in the skill pyramid (U)'}"><span class="k">${lbl[i]}</span>${a ? ABIL[a[0]].n : '<br><small>locked · U</small>'}<div class="cdv"></div><div class="cdt"></div></div>`; }).join('') + HINTS[r].map(h => `<div class="ab hint"><span class="k" style="font-size:12px">${h[0]}</span>${h[1]}</div>`).join('') + (r === SHIELD ? `<div class="ab hint" id="modehint"></div>` : '');
    $('abar').querySelectorAll('[data-slot]').forEach(d => { const f = e => { e.preventDefault(); act('qer'[+d.dataset.slot]); }; d.addEventListener('mousedown', f); d.addEventListener('touchstart', f, { passive: false }); });
  }
  $('abar').querySelectorAll('[data-slot]').forEach(d => { const a = ab[+d.dataset.slot]; if (!a) return; const f = a[2] ? a[1] / a[2] : 0; d.querySelector('.cdv').style.height = (f * 100) + '%'; d.querySelector('.cdt').textContent = a[1] > 0 ? Math.ceil(a[1]) : ''; d.classList.toggle('ready', a[1] <= 0); });
  const mh = $('modehint'); if (mh) { const sh = s.sh, dn = sh.shd > 0 || sh.shp <= 0; mh.innerHTML = `<span class="k" style="font-size:12px;color:${dn ? '#f88' : '#7ab8ff'}">${dn ? 'DOWN ' + Math.ceil(sh.shd) + 's' : sh.arc + '° ARC'}</span>${dn ? 'recharging' : 'HP ' + sh.shp.toFixed(1) + '/' + sh.shm.toFixed(1)}`; mh.style.borderColor = dn ? '#f88' : '#7ab8ff'; }
}
function touchLabels(s) {
  const ab = s.crew[me.role][5];
  ['q', 'e', 'r'].forEach((k, i) => { const a = ab[i], b = $('t-' + k); const t = a ? (a[1] > 0 ? Math.ceil(a[1]) + 's' : ABIL[a[0]].n.split(' ').pop().slice(0, 7)) : '🔒'; const h = `<b>${k.toUpperCase()}</b><br><small>${t}</small>`; if (b.dataset.h !== h) { b.dataset.h = h; b.innerHTML = h; } b.style.opacity = a && a[1] <= 0 ? 1 : 0.5; });
  $('t-alt').style.display = 'none';
}
// ---------- v4: repair side panel, per-station minigames, CLICK RAPIDLY ----------
const MGW = 360, MGH = 170;
const MG = { key: '', kind: '', boost: 0, bt: 0, mx: 180, my: 90, dn: 0, clk: 0, t: 0, S: {}, fl: 0 };
const MGN = {
  track: ['SIGNAL TRACE · Cockpit', 'Keep your cursor on the moving beacon'],
  seq: ['BOLT SEQUENCE · Turret', 'Click the numbered bolts in order 1 → 5'],
  press: ['FUEL PRESSURE · Engines', 'HOLD the mouse to raise pressure, release to drop it. Keep the needle in the green band'],
  timing: ['FREQUENCY LOCK · Deflector', 'Click when the sweep is inside the green band'],
  dial: ['BAY CALIBRATION · Repair Bay', 'Click when the dial needle crosses the green arc'],
  weld: ['SEAM WELD · Hull', 'HOLD the mouse and trace the glowing seam with the torch'],
  wire: ['WIRE PATCH · Port', 'Click a terminal on the left, then the matching colour on the right']
};
function mgKind(t) { return t === PILOT ? 'track' : (t === GUNL || t === GUNR) ? 'seq' : t === ENG ? 'press' : t === SHIELD ? 'timing' : t === REPAIR ? 'dial' : t === 18 ? 'weld' : 'wire'; }
const WCOL = ['#ff5a5a', '#5ad0ff', '#ffd54a', '#6dff8a'];
function mgInit(kind) {
  const S = MG.S;
  if (kind === 'seq') { S.next = 1; S.nodes = []; for (let n = 1; n <= 5; n++) { let p, k = 0; do { p = { x: 24 + Math.random() * 312, y: 48 + Math.random() * 108, n }; k++; } while (k < 40 && S.nodes.some(q => hypot(q.x - p.x, q.y - p.y) < 40)); S.nodes.push(p); } }
  if (kind === 'press') S.p = 0.3;
  if (kind === 'timing') S.c = (Math.random() - 0.5) * 1.2;
  if (kind === 'dial') S.c = Math.random() * PI * 2;
  if (kind === 'weld') { S.ph = Math.random() * 6; S.prog = 0; }
  if (kind === 'wire') { const o = [0, 1, 2, 3]; for (let i = 3; i > 0; i--) { const j = floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } S.right = o; S.sel = -1; S.done = [0, 0, 0, 0]; }
}
(function () {
  const c = $('rg'); const pos = e => { const r = c.getBoundingClientRect(); MG.mx = (e.clientX - r.left) * MGW / r.width; MG.my = (e.clientY - r.top) * MGH / r.height; };
  c.addEventListener('pointerdown', e => { pos(e); MG.dn = 1; MG.clk = 1; try { c.setPointerCapture(e.pointerId); } catch (_) { } e.preventDefault(); });
  c.addEventListener('pointermove', pos);
  const up = () => { MG.dn = 0; }; c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
})();
const seamY = (x, ph) => 108 + 26 * sin(x / 46 + ph) + 10 * sin(x / 17 + ph * 2);
function mgGood(ok, dt, tau) { MG.boost += ((ok ? 1 : 0) - MG.boost) * (1 - exp(-dt / tau)); }
function mgBank(dt) { MG.bt = max(0, MG.bt - dt); MG.boost = clamp(MG.bt / 2.5, 0, 1); }
const MGF = {
  track(g, dt, tol) {
    const t = MG.t, bx = 180 + cos(t * 0.9) * 130 + sin(t * 2.1) * 22, by = 98 + sin(t * 1.3) * 42 + cos(t * 2.7) * 10, d = hypot(MG.mx - bx, MG.my - by), ok = d < 28 * tol;
    mgGood(ok, dt, 1.2);
    g.strokeStyle = '#123'; g.lineWidth = 1; for (let x = 0; x <= MGW; x += 30) { g.beginPath(); g.moveTo(x, 24); g.lineTo(x, MGH); g.stroke(); } for (let y = 24; y <= MGH; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(MGW, y); g.stroke(); }
    g.strokeStyle = ok ? '#6f6' : '#fa4'; g.lineWidth = 2; g.beginPath(); g.arc(bx, by, 28 * tol, 0, 7); g.stroke();
    g.fillStyle = ok ? '#6f6' : '#fa4'; g.shadowColor = g.fillStyle; g.shadowBlur = 12; g.beginPath(); g.arc(bx, by, 8, 0, 7); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(MG.mx - 9, MG.my); g.lineTo(MG.mx + 9, MG.my); g.moveTo(MG.mx, MG.my - 9); g.lineTo(MG.mx, MG.my + 9); g.stroke();
  },
  seq(g, dt, tol) {
    const S = MG.S; mgBank(dt);
    if (MG.clk) { const h = S.nodes.find(q => hypot(q.x - MG.mx, q.y - MG.my) < 17 && q.n >= S.next - 0 && q.n === S.next); const any = S.nodes.find(q => hypot(q.x - MG.mx, q.y - MG.my) < 17);
      if (h) { S.next++; MG.fl = 0; SFX.ui && SFX.ui(); if (S.next > 5) { MG.bt = min(7, MG.bt + 4 + tol); mgInit('seq'); } } else if (any && any.n > S.next) { S.next = 1; MG.fl = 0.3; } }
    for (const q of S.nodes) { const done = q.n < S.next; g.fillStyle = done ? '#1c5a2a' : '#1a2a44'; g.strokeStyle = done ? '#6f6' : q.n === S.next ? '#ffd54a' : '#6af'; g.lineWidth = q.n === S.next ? 3 : 2; g.beginPath(); g.arc(q.x, q.y, 15, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.fillText(q.n, q.x, q.y + 6); for (let a = 0; a < 6; a++) { g.fillStyle = '#9ab'; g.fillRect(q.x + cos(a * 1.047) * 15 - 1, q.y + sin(a * 1.047) * 15 - 1, 2, 2); } }
    g.textAlign = 'left'; if (MG.fl > 0) { MG.fl -= dt; g.fillStyle = 'rgba(255,60,60,.25)'; g.fillRect(0, 24, MGW, MGH); }
  },
  press(g, dt, tol) {
    const S = MG.S, t = MG.t, c = 0.55 + 0.2 * sin(t * 0.6) + 0.1 * sin(t * 1.7), hw = 0.12 * tol;
    S.p = clamp(S.p + (MG.dn ? 0.55 : -0.38) * dt + 0.03 * sin(t * 3.1) * dt, 0, 1); const ok = abs(S.p - c) < hw; mgGood(ok, dt, 1.0);
    const x0 = 30, w = 300, y0 = 70, hh = 40; g.fillStyle = '#0a1420'; g.fillRect(x0, y0, w, hh); g.strokeStyle = '#456'; g.strokeRect(x0, y0, w, hh);
    g.fillStyle = 'rgba(60,255,90,.4)'; g.fillRect(x0 + (c - hw) * w, y0, hw * 2 * w, hh); g.strokeStyle = '#6f6'; g.strokeRect(x0 + (c - hw) * w, y0, hw * 2 * w, hh);
    g.fillStyle = '#26466b'; g.fillRect(x0, y0 + 28, S.p * w, 12);
    for (let i = 0; i <= 10; i++) { g.fillStyle = '#678'; g.fillRect(x0 + i * w / 10 - 0.5, y0 + hh + 2, 1, i % 5 ? 4 : 8); }
    g.fillStyle = ok ? '#fff' : '#f84'; g.fillRect(x0 + S.p * w - 3, y0 - 10, 6, hh + 20);
    g.fillStyle = '#9ab'; g.font = '13px monospace'; g.fillText(MG.dn ? 'pressurising…' : 'venting…', x0, 148);
  },
  timing(g, dt, tol) {
    const S = MG.S, p = sin(MG.t * 2.1), hw = 0.17 * tol; mgBank(dt); const ok = abs(p - S.c) < hw;
    if (MG.clk) { if (ok) { MG.bt = min(7, MG.bt + 3); S.c = (Math.random() - 0.5) * 1.3; SFX.ui && SFX.ui(); } else { MG.bt = max(0, MG.bt - 1.5); MG.fl = 0.25; } }
    const X = v => (v + 1) / 2 * 300 + 30; g.fillStyle = '#0a1420'; g.fillRect(30, 60, 300, 56); g.strokeStyle = '#456'; g.strokeRect(30, 60, 300, 56);
    g.fillStyle = 'rgba(60,255,90,.4)'; g.fillRect(X(S.c - hw), 60, X(S.c + hw) - X(S.c - hw), 56); g.strokeStyle = '#6f6'; g.strokeRect(X(S.c - hw), 60, X(S.c + hw) - X(S.c - hw), 56);
    g.strokeStyle = '#1b3550'; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(30 + i * 37.5, 60); g.lineTo(30 + i * 37.5, 116); g.stroke(); }
    g.fillStyle = ok ? '#fff' : '#f84'; g.shadowColor = g.fillStyle; g.shadowBlur = 8; g.fillRect(X(p) - 2, 52, 4, 72); g.shadowBlur = 0;
    if (MG.fl > 0) { MG.fl -= dt; g.fillStyle = 'rgba(255,60,60,.25)'; g.fillRect(0, 24, MGW, MGH); }
  },
  dial(g, dt, tol) {
    const S = MG.S, a = (MG.t * 2.6) % (PI * 2), hw = 0.5 * tol; mgBank(dt); const dd = atan2(sin(a - S.c), cos(a - S.c)), ok = abs(dd) < hw;
    if (MG.clk) { if (ok) { MG.bt = min(7, MG.bt + 3); S.c = Math.random() * PI * 2; SFX.ui && SFX.ui(); } else { MG.bt = max(0, MG.bt - 1.5); MG.fl = 0.25; } }
    const cx = 180, cy = 100, r = 52; g.lineWidth = 10; g.strokeStyle = '#13273d'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(60,255,90,.7)'; g.beginPath(); g.arc(cx, cy, r, S.c - hw, S.c + hw); g.stroke(); g.lineWidth = 1;
    for (let i = 0; i < 24; i++) { const q = i * PI / 12; g.strokeStyle = '#567'; g.beginPath(); g.moveTo(cx + cos(q) * (r + 9), cy + sin(q) * (r + 9)); g.lineTo(cx + cos(q) * (r + (i % 6 ? 12 : 16)), cy + sin(q) * (r + (i % 6 ? 12 : 16))); g.stroke(); }
    g.strokeStyle = ok ? '#fff' : '#f84'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + cos(a) * (r + 4), cy + sin(a) * (r + 4)); g.stroke(); g.fillStyle = '#9ab'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
    if (MG.fl > 0) { MG.fl -= dt; g.fillStyle = 'rgba(255,60,60,.25)'; g.fillRect(0, 24, MGW, MGH); }
  },
  weld(g, dt, tol) {
    const S = MG.S; let on = false;
    if (MG.dn && abs(MG.my - seamY(MG.mx, S.ph)) < 15 * tol && abs(MG.mx - (30 + S.prog)) < 46) { on = true; S.prog = max(S.prog, MG.mx - 30); }
    mgGood(on, dt, 0.7); if (S.prog >= 298) { S.ph = Math.random() * 6; S.prog = 0; MG.boost = 1; }
    g.lineWidth = 10; g.strokeStyle = '#1c2a3c'; g.beginPath(); for (let x = 30; x <= 330; x += 4) g[x === 30 ? 'moveTo' : 'lineTo'](x, seamY(x, S.ph)); g.stroke();
    g.lineWidth = 5; g.strokeStyle = '#ff9a3a'; g.shadowColor = '#fa4'; g.shadowBlur = 8; g.beginPath(); for (let x = 30; x <= 30 + S.prog; x += 4) g[x === 30 ? 'moveTo' : 'lineTo'](x, seamY(x, S.ph)); g.stroke(); g.shadowBlur = 0;
    g.fillStyle = '#9ab'; g.fillRect(30 + S.prog - 1, seamY(30 + S.prog, S.ph) - 12, 2, 24);
    if (on) { for (let i = 0; i < 4; i++) { g.fillStyle = '#ffe9a0'; g.fillRect(MG.mx + (Math.random() - 0.5) * 18, MG.my + (Math.random() - 0.5) * 18, 2, 2); } }
    g.strokeStyle = on ? '#fff' : MG.dn ? '#f84' : '#9ab'; g.lineWidth = 2; g.beginPath(); g.arc(MG.mx, MG.my, 8, 0, 7); g.stroke();
  },
  wire(g, dt, tol) {
    const S = MG.S; mgBank(dt);
    if (MG.clk) {
      for (let i = 0; i < 4; i++) { const y = 52 + i * 34; if (hypot(MG.mx - 40, MG.my - y) < 17 && !S.done[i]) S.sel = i;
        if (hypot(MG.mx - 320, MG.my - y) < 17 && S.sel >= 0) { const col = S.right[i]; if (col === S.sel) { S.done[col] = 1; S.sel = -1; SFX.ui && SFX.ui(); if (S.done.every(v => v)) { MG.bt = min(7, MG.bt + 4 + tol); mgInit('wire'); return; } } else { S.sel = -1; MG.fl = 0.25; } } }
    }
    for (let i = 0; i < 4; i++) {
      const y = 52 + i * 34, col = WCOL[i]; const ri = S.right.indexOf(i), ry = 52 + ri * 34;
      if (S.done[i]) { g.strokeStyle = col; g.lineWidth = 5; g.beginPath(); g.moveTo(40, y); g.bezierCurveTo(130, y, 230, ry, 320, ry); g.stroke(); }
      else if (S.sel === i) { g.strokeStyle = col; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(40, y); g.lineTo(MG.mx, MG.my); g.stroke(); g.setLineDash([]); }
    }
    for (let i = 0; i < 4; i++) { const y = 52 + i * 34; g.fillStyle = '#0a1420'; g.strokeStyle = WCOL[i]; g.lineWidth = S.sel === i ? 4 : 2; g.beginPath(); g.arc(40, y, 12, 0, 7); g.fill(); g.stroke(); g.fillStyle = WCOL[i]; g.beginPath(); g.arc(40, y, 5, 0, 7); g.fill();
      const col = S.right[i]; g.strokeStyle = WCOL[col]; g.lineWidth = 2; g.fillStyle = '#0a1420'; g.beginPath(); g.arc(320, y, 12, 0, 7); g.fill(); g.stroke(); g.fillStyle = WCOL[col]; g.beginPath(); g.arc(320, y, S.done[col] ? 8 : 4, 0, 7); g.fill(); }
    if (MG.fl > 0) { MG.fl -= dt; g.fillStyle = 'rgba(255,60,60,.25)'; g.fillRect(0, 24, MGW, MGH); }
  }
};
const rtOK = (sh, k) => k === 18 ? sh.h < sh.hm - 0.05 : (sh.sc[k] >= 0 && (sh.dn[k] || sh.sc[k] < 0.995));
function mgFrame(dt) {
  if (me.role !== REPAIR || !lastSnap || lastSnap.ph !== 'mission') { MG.boost = 0; return; }
  const c = $('rg'), g = c.getContext('2d'), sh = lastSnap.sh, tk = sh.tk, tgt = tk[0];
  g.clearRect(0, 0, MGW, MGH); g.fillStyle = '#020610'; g.fillRect(0, 0, MGW, MGH);
  if (tgt < 0 || sh.dn[REPAIR]) {
    MG.boost = 0; MG.key = ''; if ($('mgh').dataset.k) { $('mgh').dataset.k = ''; $('mgh').textContent = ''; }
    g.fillStyle = '#34506e'; g.font = 'bold 15px monospace'; g.textAlign = 'center';
    g.fillText(sh.dn[REPAIR] ? 'REPAIR BAY OFFLINE' : 'REPAIR IDLE', 180, 80); g.font = '12px monospace'; g.fillStyle = '#6a86a6';
    g.fillText(sh.dn[REPAIR] ? 'your crewmates must fix it' : 'click a damaged port in the list above', 180, 102); g.textAlign = 'left'; MG.clk = 0; return;
  }
  const kind = mgKind(tgt), key = kind + tgt;
  if (MG.key !== key) { MG.key = key; MG.kind = kind; MG.boost = 0; MG.bt = 0; MG.S = {}; MG.t = 0; MG.fl = 0; mgInit(kind); }
  MG.t += dt; const st = me.tr && D.treeStats('repair', me.tr.repair), tol = 1 + (st ? st.band || 0 : 0);
  MGF[kind](g, dt, tol); MG.clk = 0;
  g.fillStyle = 'rgba(2,6,16,.85)'; g.fillRect(0, 0, MGW, 22); g.fillStyle = '#ffd54a'; g.font = 'bold 13px monospace'; g.fillText(MGN[kind][0], 6, 15);
  g.fillStyle = '#6df'; g.textAlign = 'right'; g.fillText('bonus +' + round(MG.boost * 100) + '%', MGW - 6, 15); g.textAlign = 'left';
  g.fillStyle = '#123'; g.fillRect(0, 21, MGW, 3); g.fillStyle = '#6df'; g.fillRect(0, 21, MGW * MG.boost, 3);
  if ($('mgh').dataset.k !== kind) { $('mgh').dataset.k = kind; $('mgh').textContent = MGN[kind][1]; }
}
// build the panel once
let repBuilt = 0, repKey = '';
function repBuild() {
  repBuilt = 1;
  $('hlist').addEventListener('click', e => { const r = e.target.closest('[data-t]'); if (!r) return; const t = +r.dataset.t; if (r.classList.contains('lock')) { toast('The Repair Bay cannot be repaired by you while it is destroyed. Your crew must click it.', '#f88'); return; } rtSel = rtSel === t ? -1 : t; repKey = ''; SFX.ui && SFX.ui(); });
  $('hullrow').addEventListener('click', () => { rtSel = rtSel === 18 ? -1 : 18; repKey = ''; SFX.ui && SFX.ui(); });
  $('drnb').addEventListener('click', () => act('dr'));
}
function hcol(f, dn) { return dn ? '#f33' : f < 0.35 ? '#f84' : f < 0.7 ? '#fd4' : '#5f8'; }
function repPanel(s) {
  if (!repBuilt) repBuild();
  const sh = s.sh, tk = sh.tk, t = tk[0], off = tk[2], mult = tk[3];
  if (rtSel >= 0 && !rtOK(sh, rtSel) && t < 0) rtSel = -1;
  const down = !!sh.dn[REPAIR], anyDmg = sh.h < sh.hm - 0.05 || sh.sc.some((v, k) => v >= 0 && (sh.dn[k] || v < 0.995));
  let m;
  if (down) m = '<span class="r">⚠ YOUR REPAIR BAY IS DESTROYED.</span> You cannot repair ports or launch drones. Your crewmates are clicking it back online (they must repair it).';
  else if (t < 0) m = anyDmg ? '<b class="y">▶ Click a damaged port below to start repairing it.</b> Repair then runs automatically; the minigame makes it faster.' : '<span class="g">All systems nominal.</span> Repairs start when you click a damaged port.';
  else m = `Repairing <b class="y">${t === 18 ? 'Hull' : secName(t)}</b> · speed <b class="c">×${mult.toFixed(2)}</b> <small>(minigame up to +100%${off ? ', drone-off +50%' : ''})</small>`;
  const key = [down, t, off, m, rtSel, sh.h.toFixed(1), sh.hm, sh.sc.map((v, k) => v < 0 ? '-' : round(v * 100) + (sh.dn[k] ? 'd' : '')).join(','), sh.dr.length, s.mk].join('|');
  if (repKey !== key) {
    repKey = key; $('repmsg').innerHTML = m;
    const hf = sh.h / sh.hm; $('hbi').style.width = round(hf * 100) + '%'; $('hbi').style.background = hcol(hf, 0); $('hbt').textContent = round(sh.h) + ' / ' + round(sh.hm) + ' HP';
    $('hullrow').className = (t === 18 ? 'act ' : '') + (rtSel === 18 ? 'sel' : '') + (hf < 0.995 ? ' dmg' : '');
    const ids = []; for (let k = 0; k < 18; k++) if (sh.sc[k] >= 0) ids.push(k);
    $('hlist').innerHTML = ids.map(k => { const f = sh.sc[k], dn = sh.dn[k], dmg = dn || f < 0.995, lock = k === REPAIR && down;
      return `<div class="hr ${dn ? 'dn' : ''} ${dmg ? 'dmg' : ''} ${rtSel === k ? 'sel' : ''} ${t === k ? 'act' : ''} ${lock ? 'lock' : ''}" data-t="${k}"><span class="hn">${k < 6 ? (k + 1) + ' ' : ''}${secShort(k)}</span><div class="hb"><i style="width:${round(f * 100)}%;background:${hcol(f, dn)}"></i></div><b>${dn ? 'DOWN' : round(f * 100) + '%'}</b><em>${t === k ? 'REPAIRING' : lock ? 'locked' : dmg ? 'click to repair' : ''}</em></div>`; }).join('');
    const d = $('drnb'); d.disabled = down; d.className = off ? 'off' : '';
    d.innerHTML = down ? '🛸 Drone unavailable: Repair Bay destroyed' : off ? '🛸 DRONE DISABLED · <b>repairing 50% faster</b><small>click (or G) to launch the drone again</small>' : '🛸 DRONE ACTIVE · <b>click (or G) to DISABLE it: repairs 50% faster</b><small>the drone follows your cursor and shoots, but slows repairs</small>';
  }
}
// ----- the Repair Bay is destroyed: everybody else must click it back -----
let rapClicks = 0, rapBuilt = 0, rapFixedT = 0;
function rapHit(e) { if (e && e.preventDefault) e.preventDefault(); rapClicks++; lastAct = performance.now(); const b = $('rapb'); b.classList.add('hit'); clearTimeout(rapHit.t); rapHit.t = setTimeout(() => b.classList.remove('hit'), 70); if (rapHit.n++ % 3 === 0) SFX.ui && SFX.ui(); }
rapHit.n = 0;
function rapPanel(s) {
  const sh = s.sh, show = s.ph === 'mission' && me.role >= 0 && me.role !== REPAIR && sh.dn[REPAIR] === 1;
  if (!rapBuilt) { rapBuilt = 1; const b = $('rapb'); b.addEventListener('pointerdown', rapHit); b.addEventListener('keydown', e => e.preventDefault()); }
  const was = !$('rapid').classList.contains('hide'); $('rapid').classList.toggle('hide', !show);
  if (show) { const f = sh.sc[REPAIR] < 0 ? 0 : sh.sc[REPAIR], sp = clamp(sh.tk[4], 0, 1); $('rapf').style.width = round(f * 100) + '%'; $('rapp').textContent = round(f * 100) + '% repaired'; $('raps').textContent = 'crew repair speed: ' + round(sp * 100) + '% of normal'; $('raps').style.color = sp > 0.85 ? '#6f6' : '#fd4'; $('raphint').textContent = me.role >= 0 && sh.dn[me.role] ? 'Your own station is down too, but you can still help!' : 'Click the button (or tap SPACE) as fast as you can. Every crewmate clicking = full speed.'; }
  if (was && !show && s.ph === 'mission') { toast('✔ Repair Bay repaired', '#6f6'); }
}

function engPanel(s) {
  const sh = s.sh, N = ['ENGINES', 'WEAPONS', 'SHIELDS'], C = ['#6cf', '#f66', '#ffd54a'];
  if (!engPanel.built) { engPanel.built = 1; $('pips').innerHTML = N.map((n, k) => `<div><span style="color:${C[k]}">${n}</span><div class="bars">${'<i></i>'.repeat(4)}</div><button data-p="${k + 1}">+ (${k + 1})</button></div>`).join('') + `<div><span>RESET</span><div class="bars" style="justify-content:center;font-size:10px;color:#9ab">2·2·2</div><button data-p="4">(4)</button></div>`; $('pips').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { act('p' + b.dataset.p); }); $('thr-').onclick = () => setThr(thr - 0.125); $('thr+').onclick = () => setThr(thr + 0.125); }
  $('pips').querySelectorAll('.bars').forEach((b, k) => { if (k > 2) return; b.querySelectorAll('i').forEach((i, j) => i.classList.toggle('on', j < sh.pip[k])); });
  $('thrbar').style.width = (thr * 100) + '%';
  $('thrt').innerHTML = `Throttle ${round(thr * 100)}% · speed ${sh.spd}${sh.dn[ENG] ? ' · <span class="r">ENGINES DOWN: stalling</span>' : ''}${sh.dn[PILOT] ? ' · <span class="r">cockpit down: no steering</span>' : ''}`;
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
function resize() { DPR = min(devicePixelRatio || 1, isTouch ? 1.5 : 2); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; Z = clamp(min(W, H) / (isTouch ? 1010 : 1330) * (W > H ? 1 : 1.1), 0.26, 1); }
addEventListener('resize', resize); resize();
let lastT = performance.now(), fps = 60, bgPlanet = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = min(0.05, (now - lastT) / 1000); lastT = now; fps = fps * 0.95 + (1 / max(dt, 0.001)) * 0.05;
  cur = interp(); stepParts(dt);
  for (const [id, b] of bolts) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; if (b.life <= 0) bolts.delete(id); }
  for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.t -= dt; f.y -= 40 * dt; if (f.t <= 0) floaters.splice(i, 1); }
  if (bannerT > 0) { bannerT -= dt; $('banner').style.opacity = min(1, bannerT * 2); } else $('banner').style.opacity = 0;
  draw(dt, now / 1000); mgFrame(dt);
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
  cx.strokeStyle = 'rgba(255,80,80,.25)'; cx.lineWidth = 6; cx.setLineDash([30, 20]); cx.strokeRect(-ARENA, -ARENA, ARENA * 2, ARENA * 2); cx.setLineDash([]);
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
  drawWaves(o, T); drawBeams(o, T);
  // player bolts (always red)
  for (const b of bolts.values()) { if (!view(b.x, b.y, 30)) continue; const a = atan2(b.vy, b.vx); if (b.kind === 4) { cx.drawImage(glow('#ff3030', 8), b.x - 8, b.y - 8); } else streak(b.x, b.y, a, b.kind === 2 ? 26 : b.kind === 3 ? 14 : 22, b.kind === 3 ? 1.5 : 2.2, PLAYER_RED, 12); }
  drawPlayerShots(o);
  for (const b of s.bo) { cx.drawImage(glow('#ffaa33', 22), b[0] - 22, b[1] - 22); cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(b[0], b[1], 4, 0, TAU); cx.fill(); }
  // enemy fire (all lasers neon green)
  drawEnemyFire(o, view);
  // particles
  for (const p of parts) { const f = p.life / p.max; if (!view(p.x, p.y, 120)) continue;
    if (p.k === 0) { cx.globalAlpha = f; cx.fillStyle = p.c; cx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
    else if (p.k === 1) { cx.globalAlpha = f; cx.strokeStyle = p.c; cx.lineWidth = p.w * f + 0.5; cx.beginPath(); cx.arc(p.x, p.y, lerp(p.r1, p.r0, f), 0, TAU); cx.stroke(); }
    else if (p.k === 2) { cx.globalAlpha = f; const r = p.r * (1.2 - f * 0.4); cx.drawImage(glow(p.c === '#fff' ? '#ffffff' : p.c, 64), p.x - r, p.y - r, r * 2, r * 2); }
    else if (p.k === 3) { cx.globalAlpha = f * 0.5; cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, p.s * (1.6 - f), 0, TAU); cx.fill(); }
    else if (p.k === 4) { cx.globalAlpha = f; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.beginPath(); cx.moveTo(p.s, 0); cx.lineTo(-p.s * 0.7, -p.s * 0.6); cx.lineTo(-p.s, p.s * 0.3); cx.closePath(); cx.fill(); cx.strokeStyle = 'rgba(255,200,120,.7)'; cx.lineWidth = 0.8; cx.stroke(); cx.restore(); }
    else if (p.k === 6) { cx.globalAlpha = f; cx.strokeStyle = p.c; cx.lineWidth = p.s; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); cx.stroke(); cx.lineCap = 'butt'; }
    else if (p.k === 5) { cx.globalAlpha = f; const r = p.s * (1.5 - f * 0.5); cx.drawImage(glow(f > 0.6 ? '#ffd890' : f > 0.3 ? '#ff7a2a' : '#7a2a10', 64), p.x - r, p.y - r, r * 2, r * 2); } }
  cx.globalAlpha = 1;
  for (const f of floaters) { cx.globalAlpha = min(1, f.t * 2); cx.fillStyle = f.c; cx.font = 'bold 15px monospace'; cx.textAlign = 'center'; cx.fillText(f.s, f.x, f.y); } cx.globalAlpha = 1;
  // my aim cursor (world)
  if (joined && me.role >= 0 && s.ph === 'mission') { const [ax, ay] = aimWorld(o); cx.strokeStyle = me.role === SHIELD ? SHIELD_BLUE : me.role === REPAIR ? '#c8f' : '#ff5050'; cx.lineWidth = 2 / Z; cx.beginPath(); cx.arc(ax, ay, 10 / Z, 0, TAU); cx.moveTo(ax - 16 / Z, ay); cx.lineTo(ax - 6 / Z, ay); cx.moveTo(ax + 6 / Z, ay); cx.lineTo(ax + 16 / Z, ay); cx.stroke(); }
}
// ---------- v3 world drawing ----------
function drawWaves(o, T) {
  for (const w of o.s.wv || []) { const half = w.half !== undefined ? w.half : w[3], x = w[0], y = w[1], a = w[2], r = w[4], hf = w[3]; cx.save(); cx.translate(x, y);
    for (let k = 0; k < 4; k++) { const rr = r - k * 16; if (rr < 20) continue; cx.strokeStyle = `rgba(${120 + k * 30},${190 + k * 15},255,${0.85 - k * 0.2})`; cx.lineWidth = 16 - k * 3; cx.lineCap = 'round'; cx.beginPath(); cx.arc(0, 0, rr, a - hf, a + hf); cx.stroke(); }
    cx.drawImage(glow('#6cf', 90), cos(a) * r - 90, sin(a) * r - 90, 180, 180); cx.lineCap = 'butt'; cx.restore(); }
}
function hullPoint(Tt, a, x, y, px, py) { const c = cos(a), s_ = sin(a); return [x + px * c - py * s_, y + px * s_ + py * c]; }
function drawEnemy(e, T, view) {
  const [id, t, x, y, a, hp, warp, paint, ports, shf] = e, Tt = ETYPES[t]; if (!view(x, y, Tt.r + 80)) return;
  if (warp) { cx.strokeStyle = 'rgba(160,255,170,.7)'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(x - cos(a) * 200, y - sin(a) * 200); cx.lineTo(x, y); cx.stroke(); cx.drawImage(glow('#aaffaa', 30), x - 30, y - 30); return; }
  if (t === 10) { blit(rockSprite(hp, id), x, y, a); return; }
  const sp = enemySprite(t); if (!sp) return;
  const big = Tt.mp;
  const back = big ? (Tt.hull.k === 'tri' ? Tt.hull.a * 0.75 : Tt.hull.k === 'circ' ? 0 : (Tt.hull.a || Tt.r) + 4) : Tt.r * 0.6, gr_ = big ? 20 + Tt.sz * 6 : 10;
  if (Tt.spd > 0) { const nB = big && Tt.sz >= 2 ? 3 : 1; for (let q = 0; q < nB; q++) { const off = (q - (nB - 1) / 2) * (Tt.r * 0.16); cx.drawImage(glow('#88ffaa', gr_), x - cos(a) * back - sin(a) * off - gr_, y - sin(a) * back + cos(a) * off - gr_, gr_ * 2, gr_ * 2); } }
  blit(sp, x, y, a);
  const ht = hitT.get(id); if (ht && performance.now() - ht < 70) { cx.globalCompositeOperation = 'lighter'; blit(sp, x, y, a, 1, 0.35); cx.globalCompositeOperation = 'source-over'; }
  if (t === 5 && (T * 4 | 0) % 2) cx.drawImage(glow('#ff3030', 12), x - 12, y - 12);
  if (ports) ports.forEach((p, k) => {
    const P_ = Tt.ports[k], [px, py] = hullPoint(Tt, a, x, y, P_.x, P_.y);
    if (P_.w === 'dock') { // shipping dock / hangar bay
      const pa_ = a + (P_.f || PI);
      if (p[0] <= 0) { cx.fillStyle = '#111'; cx.beginPath(); cx.arc(px, py, 14, 0, TAU); cx.fill(); cx.fillStyle = 'rgba(255,120,40,.7)'; cx.beginPath(); cx.arc(px, py, 5 + sin(T * 9 + k) * 2, 0, TAU); cx.fill(); cx.drawImage(glow('#ff6a20', 30), px - 30, py - 30, 60, 60); if (random() < 0.2) P({ k: 3, x: px, y: py, vx: (random() - .5) * 20, vy: (random() - .5) * 20, life: 1.2, max: 1.2, s: 8, c: '#333' }); return; }
      cx.save(); cx.translate(px, py); cx.rotate(pa_); const open = 0.5 + 0.5 * sin(T * 1.5 + k);
      cx.fillStyle = '#20242c'; cx.fillRect(-16, -15, 32, 30); cx.strokeStyle = '#ffd24a'; cx.lineWidth = 2; cx.strokeRect(-16, -15, 32, 30);
      cx.fillStyle = `rgba(255,210,70,${0.25 + open * 0.4})`; cx.fillRect(-12, -11, 24, 22);
      cx.fillStyle = '#ffd24a'; for (let q = -2; q <= 2; q++) { cx.save(); cx.translate(-14, q * 6); cx.rotate(0.6); cx.fillRect(-3, -1, 6, 2); cx.restore(); }
      cx.restore(); cx.drawImage(glow('#ffd24a', 34), px - 34, py - 34, 68, 68);
      cx.strokeStyle = p[0] > 0.5 ? '#5f5' : p[0] > 0.25 ? '#fd4' : '#f44'; cx.lineWidth = 3.5; cx.beginPath(); cx.arc(px, py, 22, -PI / 2, -PI / 2 + TAU * p[0]); cx.stroke();
      if (Tt.sz >= 2 && p[0] > 0) { cx.fillStyle = '#ffd24a'; cx.font = 'bold 10px monospace'; cx.textAlign = 'center'; cx.fillText('DOCK', px, py - 28); }
      return; }
    if (p[0] <= 0) { cx.fillStyle = '#111'; cx.beginPath(); cx.arc(px, py, 9, 0, TAU); cx.fill(); cx.fillStyle = 'rgba(255,120,40,.6)'; cx.beginPath(); cx.arc(px, py, 3 + sin(T * 9 + k) * 1.5, 0, TAU); cx.fill(); if (random() < 0.1) P({ k: 3, x: px, y: py, vx: (random() - .5) * 20, vy: (random() - .5) * 20, life: 1, max: 1, s: 5, c: '#333' }); return; }
    const pa = a + p[1], heavy = P_.w === 'ion', len = heavy ? 18 : 13;
    cx.strokeStyle = '#2a2d33'; cx.lineWidth = heavy ? 6 : 4; cx.beginPath(); cx.moveTo(px, py); cx.lineTo(px + cos(pa) * len, py + sin(pa) * len); cx.stroke();
    cx.fillStyle = P_.w === 'msl' ? '#8a8f6a' : P_.w === 'flak' ? '#8a7a6a' : '#7d838c'; cx.beginPath(); cx.arc(px, py, heavy ? 10 : 7.5, 0, TAU); cx.fill(); cx.strokeStyle = '#111'; cx.lineWidth = 1.5; cx.stroke();
    cx.strokeStyle = p[0] > 0.5 ? '#5f5' : p[0] > 0.25 ? '#fd4' : '#f44'; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(px, py, heavy ? 13 : 10.5, -PI / 2, -PI / 2 + TAU * p[0]); cx.stroke();
    if (p[2]) cx.drawImage(glow('#39ff4a', 26), px + cos(pa) * len - 26, py + sin(pa) * len - 26);
  });
  if (shf !== undefined && shf > 0) enemyShield(x, y, Tt.r * (big ? 1.05 : 1.5), shf, T);
  if (!big && hp < 1) hpBar(x, y - Tt.r - 10, Tt.r * 2, hp, '#5f5');
  if (!big && shf > 0) hpBar(x, y - Tt.r - 15, Tt.r * 2, shf, '#c9a0ff');
  if (big && shf > 0) hpBar(x, y - Tt.r - 22, min(160, Tt.r * 1.6), shf, '#c9a0ff');
  if (paint) { cx.strokeStyle = '#ff4040'; cx.lineWidth = 2; const r = Tt.r + 12; cx.save(); cx.translate(x, y); cx.rotate(T * 2); for (let i = 0; i < 4; i++) { cx.rotate(PI / 2); cx.beginPath(); cx.arc(0, 0, r, 0.2, 0.9); cx.stroke(); } cx.restore(); }
}
function drawShip(o, T) {
  const sh = o.sh, x = o.x, y = o.y, a = o.a, s = o.s, mk = s.mk, G = GEO[mk], ca = cos(a), sa_ = sin(a);
  const L2W = (lx, ly) => [x + lx * ca - ly * sa_, y + lx * sa_ + ly * ca];
  // shield: BLUE only, aimed in world space (turning the ship does not rotate it)
  if (s.ph === 'mission' || s.ph === 'result') {
    const R = G.sr, f = sh.shm ? clamp(sh.shp / sh.shm, 0, 1) : 0;
    if (sh.shd > 0 || sh.shp <= 0) { // recharging: dotted ghost + timer
      cx.strokeStyle = 'rgba(80,150,255,.28)'; cx.lineWidth = 2; cx.setLineDash([5, 9]); cx.beginPath(); cx.arc(x, y, R, o.sa - sh.arc * PI / 360, o.sa + sh.arc * PI / 360); cx.stroke(); cx.setLineDash([]);
      cx.fillStyle = '#7ab8ff'; cx.font = 'bold 12px monospace'; cx.textAlign = 'center'; cx.fillText(Math.ceil(sh.shd) + 's', x + cos(o.sa) * (R + 16), y + sin(o.sa) * (R + 16) + 4);
    } else {
      const half = sh.arc * PI / 360;
      if (sh.bub) { cx.strokeStyle = `rgba(150,215,255,.85)`; cx.lineWidth = 4; cx.beginPath(); cx.arc(x, y, R, 0, TAU); cx.stroke(); cx.fillStyle = 'rgba(80,160,255,.1)'; cx.fill(); }
      const arcs = [[o.sa, half]]; if (sh.rear) arcs.push([o.sa + PI, half * 0.6]);
      for (const [c, h] of arcs) {
        const gr = cx.createRadialGradient(x, y, R - 20, x, y, R + 4); gr.addColorStop(0, 'rgba(60,140,255,0)'); gr.addColorStop(1, `rgba(90,170,255,${0.15 + 0.3 * f})`);
        cx.fillStyle = gr; cx.beginPath(); cx.moveTo(x, y); cx.arc(x, y, R + 4, c - h, c + h); cx.closePath(); cx.globalAlpha = 0.8; cx.fill(); cx.globalAlpha = 1;
        cx.lineCap = 'round'; cx.strokeStyle = '#2a7fff'; cx.globalAlpha = 0.3 + 0.25 * f; cx.lineWidth = 24; cx.beginPath(); cx.arc(x, y, R, c - h, c + h); cx.stroke(); cx.globalAlpha = 0.55 + 0.45 * f; cx.strokeStyle = '#7cc4ff'; cx.lineWidth = 7; cx.stroke(); cx.strokeStyle = '#e8f6ff'; cx.lineWidth = 2; cx.stroke(); cx.globalAlpha = 1; cx.lineCap = 'butt';
        for (const e of [-1, 1]) cx.drawImage(glow('#6cf', 12), x + cos(c + e * h) * R - 12, y + sin(c + e * h) * R - 12, 24, 24);
      }
      if (sh.fort) { cx.strokeStyle = 'rgba(160,220,255,.7)'; cx.lineWidth = 2; cx.setLineDash([10, 8]); cx.beginPath(); cx.arc(x, y, R + 9, T, T + TAU); cx.stroke(); cx.setLineDash([]); }
    }
  }
  if (sh.aeg) { cx.strokeStyle = 'rgba(255,215,80,.7)'; cx.lineWidth = 2; cx.setLineDash([8, 6]); cx.beginPath(); cx.arc(x, y, G.hr + 34, T, T + TAU); cx.stroke(); cx.setLineDash([]); }
  // engines
  const eg = sh.dn[ENG] ? 0.2 : clamp(sh.spd / 300, 0.2, 1.4) * (sh.burn ? 1.6 : 1);
  for (const [lx, ly] of ENGN[mk]) { const [ex, ey] = L2W(lx - 2, ly), r = (10 + mk * 3) + eg * (14 + mk * 4) + random() * 3; cx.drawImage(glow(sh.burn ? '#ffd890' : mk === 2 ? '#7fe8ff' : mk === 1 ? '#ffc070' : '#8fd8ff', 32), ex - r, ey - r, r * 2, r * 2); if (eg > 0.4 && random() < 0.5) P({ k: 0, x: ex, y: ey, vx: -ca * 200 + (random() - .5) * 40, vy: -sa_ * 200 + (random() - .5) * 40, life: 0.25, max: 0.25, s: 2, c: '#9df' }); }
  const roll = sh.roll || 0; cx.save(); cx.translate(x, y); cx.rotate(a); cx.scale(1, 1 - abs(roll) * 0.5); cx.translate(-x, -y);
  blit(playerSprite(mk), x, y, 0, 1, sh.inv ? 0.55 : 1);
  // installed port hardware (drawn live)
  for (let r = 0; r < 6; r++) for (let sl = 0; sl < mk; sl++) { const p = s.crew[r][7] && s.crew[r][7][sl]; if (!p) continue; const k = 6 + r * 2 + sl, pos = G.po[r][sl]; if (!pos) continue; const dead = sh.dn[k], pang = (sh.pa.find(q => q[0] === k) || [0, 0])[1];
    if (dead) { cx.fillStyle = '#1b1210'; cx.beginPath(); cx.arc(x + pos[0], y + pos[1], 7, 0, TAU); cx.fill(); continue; }
    drawPortIcon(p[0], x + pos[0], y + pos[1], r === 1 || r === 5 ? pang - a : 0, p[1], T); }
  cx.restore();
  // station turrets (GUNR=1 starboard, GUNL=5 port)
  for (const [gi, ta] of [[1, o.tr], [5, o.tl]]) { const [lx, ly] = G.st[gi], [px, py] = L2W(lx, ly), wa = a + ta, sc = 1 + mk * 0.12; cx.strokeStyle = '#2a2d33'; cx.lineWidth = 3; for (const off of [-2.5 * sc, 2.5 * sc]) { cx.beginPath(); cx.moveTo(px - sin(wa) * off, py + cos(wa) * off); cx.lineTo(px + cos(wa) * 17 * sc - sin(wa) * off, py + sin(wa) * 17 * sc + cos(wa) * off); cx.stroke(); } cx.fillStyle = sh.dn[gi] ? '#422' : '#a9afb8'; cx.beginPath(); cx.arc(px, py, 7 * sc, 0, TAU); cx.fill(); cx.strokeStyle = '#222'; cx.lineWidth = 1.2; cx.stroke(); cx.fillStyle = '#c33'; cx.fillRect(px + cos(wa) * 15 * sc - 1.5, py + sin(wa) * 15 * sc - 1.5, 3, 3); }
  // gunner port turrets (separate barrels aimed independently)
  // damaged / destroyed sections: small fire + smoke
  for (let k = 0; k < 18; k++) { const r = sh.sc[k]; if (r < 0) continue; const [lx, ly] = k < 6 ? G.st[k] : (G.po[(k - 6) >> 1][(k - 6) & 1] || [0, 0]), [px, py] = L2W(lx, ly);
    if (sh.dn[k]) { const fl = 14 + sin(T * 18 + k) * 3; cx.drawImage(glow('#ff5a18', 24), px - fl, py - fl, fl * 2, fl * 2); cx.drawImage(glow('#ffd070', 12), px - 7, py - 9 - random() * 3, 14, 14); if (random() < 0.35) P({ k: 3, x: px, y: py, vx: (random() - .5) * 30, vy: (random() - .5) * 30, life: 1.2, max: 1.2, s: 6, c: '#333' }); if (random() < 0.2) sparks(px, py, 2, '#ffb050', 120, 0.3, 1.5); }
    else if (r < 0.5 && random() < 0.06) P({ k: 3, x: px, y: py, vx: 0, vy: 0, life: 0.8, max: 0.8, s: 4, c: '#555' }); }
  // repair target highlight
  if (me.role === REPAIR && sh.tk[0] >= 0 && sh.tk[0] < 18) { const k = sh.tk[0], [lx, ly] = k < 6 ? G.st[k] : (G.po[(k - 6) >> 1][(k - 6) & 1] || [0, 0]), [px, py] = L2W(lx, ly); cx.strokeStyle = '#c8f'; cx.lineWidth = 2; cx.beginPath(); cx.arc(px, py, 12 + sin(T * 8) * 2, 0, TAU); cx.stroke(); }
}
function drawBeams(o, T) {
  for (const b of o.sh.bm) { if (!b) continue; const px = b[1], py = b[2], ex = px + cos(b[3]) * b[4], ey = py + sin(b[3]) * b[4]; cx.lineCap = 'round'; cx.strokeStyle = 'rgba(255,40,40,.35)'; cx.lineWidth = 12 + sin(T * 40) * 3; cx.beginPath(); cx.moveTo(px, py); cx.lineTo(ex, ey); cx.stroke(); cx.strokeStyle = '#ff6060'; cx.lineWidth = 4; cx.stroke(); cx.strokeStyle = '#fff'; cx.lineWidth = 1.5; cx.stroke(); cx.lineCap = 'butt'; cx.drawImage(glow('#ff4040', 20), ex - 20, ey - 20); }
}
function drawEnemyFire(o, view) {
  for (const b of o.eb) { if (!view(b[1], b[2], 30)) continue;
    if (b[4] === 0) streak(b[1], b[2], b[3], b[5] ? 34 : 20, b[5] ? 4 : 2.2, ENEMY_GREEN, b[5] ? 24 : 12);
    else if (b[4] === 1) { cx.save(); cx.translate(b[1], b[2]); cx.rotate(b[3]); cx.fillStyle = '#9aa'; cx.fillRect(-7, -2.5, 14, 5); cx.fillStyle = ENEMY_GREEN; cx.fillRect(5, -2.5, 3, 5); cx.restore(); cx.drawImage(glow(ENEMY_GREEN, 16), b[1] - cos(b[3]) * 9 - 16, b[2] - sin(b[3]) * 9 - 16); if (random() < 0.5) P({ k: 3, x: b[1] - cos(b[3]) * 9, y: b[2] - sin(b[3]) * 9, vx: 0, vy: 0, life: 0.5, max: 0.5, s: 4, c: '#2a4a2a' }); }
    else { cx.drawImage(glow(ENEMY_GREEN, 14), b[1] - 14, b[2] - 14); cx.fillStyle = '#d8ffd0'; cx.beginPath(); cx.arc(b[1], b[2], 3, 0, TAU); cx.fill(); } }
}
function drawPlayerShots(o) {
  for (const p of o.pp) { if (p[4]) { streak(p[1], p[2], p[3], 12, 2, PLAYER_RED, 12); P({ k: 0, x: p[1], y: p[2], vx: 0, vy: 0, life: 0.2, max: 0.2, s: 2, c: '#ff6050' }); } else { cx.save(); cx.translate(p[1], p[2]); cx.rotate(p[3]); cx.fillStyle = '#ccc'; cx.fillRect(-6, -2, 12, 4); cx.fillStyle = '#f22'; cx.fillRect(4, -2, 3, 4); cx.restore(); cx.drawImage(glow('#ff2a2a', 16), p[1] - cos(p[3]) * 8 - 16, p[2] - sin(p[3]) * 8 - 16); P({ k: 3, x: p[1] - cos(p[3]) * 8, y: p[2] - sin(p[3]) * 8, vx: 0, vy: 0, life: 0.5, max: 0.5, s: 5, c: '#633' }); } }
}
function hudBar(x, y, w, h, f, col, bg) {
  f = clamp(f, 0, 1); cx.fillStyle = bg; cx.fillRect(x, y, w, h); cx.fillStyle = col; cx.fillRect(x, y, w * f, h);
  const g = cx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); cx.fillStyle = g; cx.fillRect(x, y, w * f, h);
  cx.fillStyle = 'rgba(0,0,0,.4)'; for (let i = 1; i < 10; i++) cx.fillRect(x + w * i / 10, y, 1, h); cx.strokeStyle = 'rgba(160,210,240,.5)'; cx.lineWidth = 1; cx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
function drawHUD(o, T) {
  const s = o.s, sh = o.sh; if (s.ph !== 'mission') return;
  const ind = (x, y, col, sz) => { const dx = x - camX, dy = y - camY, hw = W / 2 / Z, hh = H / 2 / Z; if (abs(dx) < hw && abs(dy) < hh) return; const a = atan2(dy, dx), k = min((W / 2 - 24) / abs(cos(a) || 1e-6), (H / 2 - 24) / abs(sin(a) || 1e-6)); const px = W / 2 + cos(a) * k, py = H / 2 + sin(a) * k; cx.save(); cx.translate(px, py); cx.rotate(a); cx.fillStyle = col; cx.beginPath(); cx.moveTo(sz, 0); cx.lineTo(-sz * 0.6, -sz * 0.6); cx.lineTo(-sz * 0.6, sz * 0.6); cx.closePath(); cx.fill(); cx.restore(); };
  for (const e of o.e) if (e[1] !== 10) ind(e[2], e[3], ETYPES[e[1]].mp ? '#9f9' : 'rgba(57,255,74,.7)', ETYPES[e[1]].mp ? 12 : 7);
  for (const a of o.al) ind(a[2], a[3], a[1] === 'pod' ? '#7f7' : '#6cf', 10);
  if (s.mi && s.mi.type === 'escort') ind(s.mi.jx, s.mi.jy, '#9cf', 12);
  for (const p of o.pk) if (p[3]) ind(p[1], p[2], '#6df', 8);
  const bw = min(230, W * 0.32), bx = 12, by = H - (isTouch ? 230 : 96);
  cx.textAlign = 'left'; cx.font = 'bold 11px monospace';
  { const g_ = cx.createLinearGradient(0, by - 22, 0, by + 86); g_.addColorStop(0, 'rgba(14,26,44,.62)'); g_.addColorStop(1, 'rgba(4,8,16,.5)'); cx.fillStyle = g_; cx.fillRect(bx - 8, by - 22, bw + 16, 110); cx.strokeStyle = 'rgba(110,170,230,.45)'; cx.lineWidth = 1; cx.strokeRect(bx - 7.5, by - 21.5, bw + 15, 109); cx.fillStyle = 'rgba(110,170,230,.8)'; for (const [qx, qy] of [[bx - 8, by - 22], [bx + bw + 8, by - 22], [bx - 8, by + 88], [bx + bw + 8, by + 88]]) cx.fillRect(qx - 2, qy - 2, 4, 4); }
  cx.fillStyle = '#cde'; cx.fillText(`HULL ${sh.h.toFixed(1)}/${sh.hm}`, bx, by - 4);
  hudBar(bx, by, bw, 10, sh.h / sh.hm, sh.h / sh.hm < 0.35 ? '#f44' : '#8ff', 'rgba(0,30,40,.75)');
  const down = sh.shd > 0 || sh.shp <= 0;
  cx.fillStyle = down ? '#f88' : '#7ab8ff'; cx.fillText(down ? `SHIELD DOWN · ${Math.ceil(sh.shd)}s` : `SHIELD ${sh.shp.toFixed(1)}/${sh.shm.toFixed(1)} · ${sh.arc}° arc`, bx, by + 20);
  hudBar(bx, by + 24, bw, 10, down ? 1 - sh.shd / 20 : clamp(sh.shp / sh.shm, 0, 1), down ? '#a44' : '#4aa8ff', 'rgba(0,20,50,.75)');
  cx.fillStyle = '#ffd54a'; cx.fillText(`ENERGY ${sh.en}/${sh.em}`, bx, by + 48); hudBar(bx, by + 52, bw, 8, sh.en / sh.em, '#ffd54a', 'rgba(40,40,0,.75)');
  cx.fillStyle = '#9ab'; cx.fillText(isTouch ? `SPD ${sh.spd}` : `SPD ${sh.spd} · THR ${round(sh.thr * 100)}% · PWR E${sh.pip[0]} W${sh.pip[1]} S${sh.pip[2]}`, bx, by + 76);
  // ship schematic: every section, extra ports included
  const scx = W - 74, scy = isTouch ? 300 : 124, G = GEO[s.mk], K_ = 0.6;
  cx.fillStyle = 'rgba(5,10,20,.6)'; cx.beginPath(); cx.arc(scx, scy, 62, 0, TAU); cx.fill();
  const kk = K_ * 100 / G.len * 1.1;
  cx.save(); cx.translate(scx, scy); cx.rotate(-PI / 2); cx.scale(kk, kk); const sp = playerSprite(s.mk); cx.globalAlpha = 0.5; cx.drawImage(sp, -sp.hw, -sp.hh, sp.hw * 2, sp.hh * 2); cx.globalAlpha = 1; cx.restore();
  for (let k = 0; k < 18; k++) { const r = sh.sc[k]; if (r < 0) continue; const [lx, ly] = k < 6 ? G.st[k] : (G.po[(k - 6) >> 1][(k - 6) & 1] || [0, 0]); const px = scx + ly * kk, py = scy - lx * kk, mine = secRole(k) === me.role;
    cx.fillStyle = sh.dn[k] ? ((T * 4 | 0) % 2 ? '#f33' : '#600') : r < 1 ? '#fd4' : '#4d8'; cx.beginPath(); cx.arc(px, py, k < 6 ? 5.5 : 3.8, 0, TAU); cx.fill(); if (mine) { cx.strokeStyle = '#fff'; cx.lineWidth = 1.5; cx.stroke(); } }
  cx.fillStyle = '#9ab'; cx.font = '9px monospace'; cx.textAlign = 'center'; cx.fillText('▲ NOSE', scx, scy - 68);
  const warn = []; if (sh.dn[PILOT]) warn.push('COCKPIT DOWN: ship drifting, no steering'); if (sh.dn[ENG]) warn.push('ENGINES DOWN: stalling'); if (sh.dn[SHIELD]) warn.push('DEFLECTOR GENERATOR DOWN: shield offline'); if (sh.dead) warn.push('SHIP DESTROYED');
  if (warn.length) { cx.textAlign = 'center'; cx.font = 'bold 14px monospace'; cx.fillStyle = (T * 3 | 0) % 2 ? '#f55' : '#fa5'; warn.forEach((w, i) => cx.fillText('⚠ ' + w, W / 2, (isTouch ? 170 : 96) + i * 18)); }
  cx.fillStyle = '#456'; cx.font = '10px monospace'; cx.textAlign = 'right'; cx.fillText(round(fps) + 'fps', W - 6, H - 4);
}

window.TSS = { planet: planetCanvas, PK, send, get snap() { return lastSnap; }, get cur() { return cur; }, me, get camZ() { return Z; }, setZ(v) { Z = v; }, setUp(t) { upTree = t; renderUp(); } };
})();
