'use strict';
// Team Space Ship v2: server-authoritative co-op. Node + ws.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./public/defs.js');
const { ROLES, TREE_OF, TREES, ABIL, NODE_COST, infCost, ETYPES, WEAP, DIFFS, MTYPES, MK_COST, BOT_PORTS } = D;
const PORT = +process.env.PORT || 8080;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data'); fs.mkdirSync(DATA, { recursive: true });

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let files = {};
function loadFiles() {
  const f2 = {};
  for (const f of fs.readdirSync(PUB)) {
    const p = path.join(PUB, f); if (!fs.statSync(p).isFile()) continue;
    const b = fs.readFileSync(p);
    f2['/' + f] = { raw: b, gz: zlib.gzipSync(b, { level: 9 }), type: MIME[path.extname(f)] || 'application/octet-stream', etag: '"' + crypto.createHash('md5').update(b).digest('hex').slice(0, 12) + '"' };
  }
  f2['/'] = f2['/index.html']; files = f2;
}
loadFiles();

// ---------- constants & helpers ----------
const TICK = 30, DT = 1 / TICK, SEND_EVERY = 2, ARENA = 2600, SR = 66, HULL_R = 28;
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5;
const JOIN_ORDER = [PILOT, GUNL, GUNR, SHIELD, ENG, REPAIR];
const { sin, cos, atan2, hypot, min, max, abs, PI, random, floor, round, sqrt } = Math;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const rnd = (a, b) => a + random() * (b - a);
const pick = arr => arr[floor(random() * arr.length)];
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const segD2 = (x1, y1, x2, y2, px, py) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = clamp(((px - x1) * dx + (py - y1) * dy) / L, 0, 1); return (x1 + dx * t - px) ** 2 + (y1 + dy * t - py) ** 2; };
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[floor(random() * CODE_CH.length)]; } while (rooms.has(c)); return c; }
const blankInput = () => ({ ax: 0, ay: -300, f: 0, as: 0, thr: 0.7, rt: -1, idle: 0 });
function emptyT() { const t = {}; for (const k in TREES) t[k] = { n: {}, i: {}, b: {}, p: [null, null] }; return t; }
function fixProf(p) { p.t = p.t || {}; for (const k in TREES) { const x = p.t[k] = p.t[k] || {}; x.n = x.n || {}; x.i = x.i || {}; x.b = x.b || {}; x.p = x.p || [null, null]; } p.cr = p.cr || 0; p.earned = p.earned || 0; return p; }
function planetName() { return pick(D.PLANET_A) + pick(D.PLANET_B) + pick(D.PLANET_C); }

// ---------- profiles ----------
const PROF_FILE = path.join(DATA, 'profiles2.json');
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROF_FILE, 'utf8')); } catch (e) { }
function getProfile(cid, name) {
  if (!cid || typeof cid !== 'string' || cid.length > 64) cid = crypto.randomBytes(8).toString('hex');
  let p = profiles[cid]; if (!p) p = profiles[cid] = { name: name || 'Cadet' };
  fixProf(p); if (name) p.name = name; return [cid, p];
}
setInterval(() => { try { fs.writeFileSync(PROF_FILE, JSON.stringify(profiles)); } catch (e) { } }, 30000).unref();

// purchase logic shared by humans & bots. returns error string or null
function buy(prof, treeKey, kind, id, slot, mk) {
  const T = TREES[treeKey], P = prof.t[treeKey]; if (!T || !P) return 'bad tree';
  if (kind === 'node') {
    for (const br of T.br) { const j = br.nodes.findIndex(n => n[0] === id); if (j < 0) continue;
      if (P.n[id]) return 'owned'; if (j > 0 && !P.n[br.nodes[j - 1][0]]) return 'buy the previous upgrade first';
      if ((br.nodes[j][4] || 0) > mk) return 'needs a ship upgrade';
      if (prof.cr < NODE_COST[j]) return 'not enough credits'; prof.cr -= NODE_COST[j]; P.n[id] = 1; return null; }
    return 'bad node';
  }
  if (kind === 'inf') { if (!T.inf.some(x => x[0] === id)) return 'bad'; const lv = P.i[id] || 0, c = infCost(lv); if (prof.cr < c) return 'not enough credits'; prof.cr -= c; P.i[id] = lv + 1; return null; }
  if (kind === 'big') { const b = T.big.find(x => x[0] === id); if (!b) return 'bad'; if (P.b[id]) return 'owned'; if (b[4] > mk) return 'needs a ship upgrade'; if (prof.cr < b[3]) return 'not enough credits'; prof.cr -= b[3]; P.b[id] = 1; return null; }
  if (kind === 'port') { if (!(slot === 0 || slot === 1) || slot >= mk) return 'needs a ship upgrade'; if (!T.ports.some(x => x[0] === id)) return 'bad'; P.p[slot] = id; return null; }
  return 'bad';
}
function botSpend(prof, treeKey, mk, seatIdx) {
  const T = TREES[treeKey], P = prof.t[treeKey];
  for (let s = 0; s < mk && s < 2; s++) if (!P.p[s]) P.p[s] = BOT_PORTS[seatIdx][s];
  for (let guard = 0; guard < 60; guard++) {
    let best = null, bc = 1e9;
    for (const br of T.br) { const j = br.nodes.findIndex(n => !P.n[n[0]]); if (j < 0) continue; if ((br.nodes[j][4] || 0) > mk) continue; if (NODE_COST[j] < bc) { bc = NODE_COST[j]; best = ['node', br.nodes[j][0]]; } }
    if (best) { if (prof.cr < bc) return; buy(prof, treeKey, best[0], best[1], 0, mk); continue; }
    const bg = T.big.find(b => !P.b[b[0]] && b[4] <= mk);
    if (bg) { if (prof.cr >= bg[3]) { buy(prof, treeKey, 'big', bg[0], 0, mk); continue; } }
    let ic = null, icc = 1e9; for (const x of T.inf) { const c = infCost(P.i[x[0]] || 0); if (c < icc) { icc = c; ic = x[0]; } }
    if (!ic || prof.cr - icc < (bg ? bg[3] * 0.5 : 0)) return; buy(prof, treeKey, 'inf', ic, 0, mk);
  }
}

// ---------- rooms ----------
const rooms = new Map();
const BOT_NAMES = ['ARC-7', 'VEGA', 'BOLT', 'NOVA', 'RIVET', 'HALO', 'ZIP', 'ORBIT', 'FLUX', 'K-9X', 'JAX', 'TESS'];
const MAIN_SEQ = ['pirates', 'hostages', 'escort', 'station', 'defend', 'flagship'];

class Room {
  constructor(code, isPublic) {
    this.code = code; this.pub = isPublic; this.clients = new Set(); this.nameOff = floor(random() * BOT_NAMES.length);
    this.seats = ROLES.map((r, i) => ({ role: r, idx: i, human: null, cur: blankInput(), bi: blankInput(), bacts: [], acts: [], cd: {}, cdm: {}, bf: {}, botName: BOT_NAMES[(i + this.nameOff) % BOT_NAMES.length], bot: fixProf({ name: 'bot' }), hes: 0 }));
    this.mainDone = 0; this.failStreak = 0; this.crewEarned = 0; this.score = 0; this.t = 0; this.idc = 1; this.tickN = 0;
    this.mk = 0; this.cores = 0;
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.events = [];
    this.phase = 'map'; this.phaseT = 3; this.mission = null; this.votes = new Map(); this.ready = new Set(); this.result = null; this.emptySince = Date.now();
    this.makeOptions(); this.resetShip();
  }
  id() { return this.idc++; }
  humans() { return this.seats.filter(s => s.human).length; }
  occ(i) { const s = this.seats[i]; return s.human ? s.human.prof : s.bot; }
  T(i) { return this.occ(i).t[TREE_OF[i]]; }
  has(i, id) { return !!this.T(i).n[id]; }
  inf(i, id) { return this.T(i).i[id] || 0; }
  big(i, id) { return !!this.T(i).b[id]; }
  ports(i) { const p = this.T(i).p, o = []; for (let s = 0; s < this.mk && s < 2; s++) if (p[s]) o.push(p[s]); return o; }
  hasPort(i, id) { return this.ports(i).includes(id); }
  bf(i, k) { return (this.seats[i].bf[k] || 0) > 0; }
  stMax(i) { return 2 + (this.big(i, 'b_armor') ? 1 : 0); }
  pipF(k) { return 1 + (this.ship.pip[k] - 2) * 0.15 * (this.has(ENG, 'e_conduit') ? 1.3 : 1); }
  ev(...a) { this.events.push(a); }
  grant(v) { // credits are equal for every crew member
    v = round(v); if (v <= 0) return; this.crewEarned += v;
    for (const s of this.seats) { s.bot.cr += v; s.bot.earned += v; }
    for (const c of this.clients) { c.prof.cr += v; c.prof.earned = max(c.prof.earned + v, this.crewEarned); c.dirty = 1; }
  }
  resetShip() {
    const hm = 10 + 2 * this.mk;
    this.ship = { x: 0, y: 0, a: -PI / 2, vx: 0, vy: -100, spd: 100, thr: 0.65, hull: hm, hm, st: [0, 1, 2, 3, 4, 5].map(i => this.stMax(i)), down: [0, 0, 0, 0, 0, 0], en: 70, sa: 0, sm: 0, tl: -80 * PI / 180, tr: 80 * PI / 180,
      bl: -80 * PI / 180, br: 80 * PI / 180, beam: [0, 0, 0, 0, 0, 0], drones: [], sdr: { a: 0, hp: 4, cd: 0 }, task: { i: -1, bc: 0, bw: 0.3 }, inv: 0, vent: 0, bubble: 0, aegis: 0, rally: 0, burn: 0, slip: 0, reroute: 0, dod: 0,
      nose: 0, noseN: 0, scat: 0, gl: 0, gr: 0, gp: { 1: { rk: 0, sc: 0 }, 5: { rk: 0, sc: 0 } }, mineT: 3, flipT: 0, dead: 0, pip: [2, 2, 2], em: 100 };
    for (const s of this.seats) { s.cd = {}; s.cdm = {}; s.bf = {}; }
  }
  // ----- overworld -----
  mkPlanet() { return { name: planetName(), seed: floor(random() * 1e6), kind: pick(D.PLANET_K) }; }
  makeOptions() {
    const n = this.mainDone + 1, opts = [];
    const mt = MAIN_SEQ[(n - 1) % MAIN_SEQ.length];
    opts.push({ id: 'm' + n, kind: 'main', level: n, diff: 1, type: mt, planet: this.mkPlanet() });
    const types = Object.keys(MTYPES).filter(t => t !== 'flagship' || n >= 3);
    for (let d = 0; d < 4; d++) opts.push({ id: 's' + this.id(), kind: 'side', level: max(1, max(1, n - 1) + DIFFS[d].lv), diff: d, type: pick(types), planet: this.mkPlanet(), mod: pick(['none', 'none', 'asteroids', 'nebula']) });
    for (const o of opts) o.name = o.planet.name;
    this.options = opts; this.votes.clear();
  }
  startMission(m) {
    const M = this.mission = Object.assign({}, m, { wave: 0, waveT: 1.5, got: 0, need: 0, lost: 0, time: 0, bossSpawned: 0, trickle: 6, waves: 0 });
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = [];
    for (let i = 0; i < 6; i++) { const P = this.T(i); for (let s = 0; s < this.mk && s < 2; s++) if (!P.p[s]) P.p[s] = BOT_PORTS[i][s]; }
    this.resetShip(); this.phase = 'mission';
    const L = M.level;
    M.fac = M.type === 'pirates' || M.type === 'hostages' || (random() < 0.3 && M.type !== 'flagship') ? 'pir' : 'dom';
    if (M.type === 'pirates') M.waves = min(5, 3 + floor(L / 4));
    if (M.type === 'flagship') M.waves = 2;
    if (M.type === 'defend') { M.waves = min(6, 3 + floor(L / 3)); this.allies.push({ id: this.id(), k: 'fs', x: 0, y: 0, a: 0, hp: 80 + 18 * L, mhp: 80 + 18 * L, r: 90 }); this.ship.y = 260; }
    if (M.type === 'escort') {
      const a = random() * 2 * PI; M.jx = cos(a) * 2200; M.jy = sin(a) * 2200;
      for (let k = 0; k < 3; k++) this.allies.push({ id: this.id(), k: 'fr', x: -cos(a) * 300 + (k - 1) * -sin(a) * 140, y: -sin(a) * 300 + (k - 1) * cos(a) * 140, a, hp: 30 + 4 * L, mhp: 30 + 4 * L, r: 34, spd: 62 });
      this.ship.x = -cos(a) * 450; this.ship.y = -sin(a) * 450; this.ship.a = a; M.need = 1;
    }
    if (M.type === 'hostages') {
      M.pods = 4; M.need = 3;
      for (let k = 0; k < 4; k++) { const a = k * PI / 2 + rnd(-0.5, 0.5), d = rnd(500, 1100); const p = { id: this.id(), k: 'pod', x: cos(a) * d, y: sin(a) * d, a: 0, hp: 6, mhp: 6, r: 16, resc: 0 }; this.allies.push(p); for (let g = 0; g < 1 + floor(L / 3); g++) this.addEnemy(L >= 3 ? 4 : 0, p.x + rnd(-150, 150), p.y + rnd(-150, 150), L, 'pir'); }
    }
    if (M.type === 'station') { const a = random() * 2 * PI; this.addEnemy(9, cos(a) * 1350, sin(a) * 1350, L, M.fac, true); M.bossSpawned = 1; this.spawnWave(L, 0, M.fac); }
    if (M.mod === 'asteroids') for (let i = 0; i < 12; i++) { const a = random() * 2 * PI, d = rnd(450, 2200); this.addEnemy(10, cos(a) * d, sin(a) * d, L, 'dom', true); }
    this.ev('ms', M.name, M.type);
  }
  endMission(win) {
    const M = this.mission, dm = DIFFS[M.diff].m;
    let bonus = 0, cores = 0;
    if (win) {
      bonus = round((30 + 12 * M.level) * dm); cores = (M.diff >= 2 || M.kind === 'main') ? 1 : 0;
      if (M.kind === 'main') { this.mainDone = max(this.mainDone, M.level); this.failStreak = 0; } else this.failStreak = 0;
      this.grant(bonus); this.cores += cores;
    } else if (M.kind === 'main') this.failStreak++;
    this.result = { win: win ? 1 : 0, bonus, cores, name: M.name, type: M.type };
    this.phase = 'result'; this.phaseT = 2.8; this.ev(win ? 'win' : 'lose');
    this.makeOptions();
  }
  // ----- enemies -----
  addEnemy(type, x, y, L, fac, instant) {
    const T = ETYPES[type], hpm = 1 + 0.22 * (L - 1) + 0.012 * (L - 1) * (L - 1);
    const e = { id: this.id(), type, x: clamp(x, -ARENA + 80, ARENA - 80), y: clamp(y, -ARENA + 80, ARENA - 80), vx: 0, vy: 0, a: random() * 2 * PI, hp: T.hp * hpm, mhp: T.hp * hpm, r: T.r, L, fac: fac || 'dom',
      cd: rnd(0.4, 1.6), warp: instant ? 0 : 0.8, orbit: random() < 0.5 ? 1 : -1, paint: 0, spot: 0, tgt: null, tgtT: 0 };
    if (type === 10) { e.r = rnd(26, 46); e.vx = rnd(-30, 30); e.vy = rnd(-30, 30); e.spin = rnd(-1, 1); }
    if (T.mp) { e.cdm = type >= 8 ? (L < 6 ? 2 : L < 10 ? 1.3 : 1) : 1; const ph = T.php * (1 + 0.25 * (L - 1) + 0.004 * (L - 1) * (L - 1)) * (type === 9 ? 1.1 : 1) * ((type >= 8 && L < 6) ? 0.7 : 1); e.ports = T.ports.map(p => ({ hp: ph, mhp: ph, pa: p.f, cd: rnd(0.5, 2.5), ch: 0 })); }
    this.enemies.push(e); return e;
  }
  spawnWave(L, w, fac, anchor) {
    const A = anchor || this.ship;
    let budget = min(24, 3 + floor(L * 0.9) + w * 2), bigs = 0;
    const pool = [];
    if (fac === 'pir') { pool.push([4, 4], [1, 2], [0, 1]); if (L >= 2) pool.push([5, 1]); if (L >= 5) pool.push([6, 1]); if (L >= 8) pool.push([7, 0.5]); }
    else { for (let t = 0; t <= 5; t++) if (ETYPES[t].minL <= L && t !== 4) pool.push([t, t === 0 ? max(0.5, 3 - L * 0.4) : t === 5 ? 1 : 3]); if (L >= 5) pool.push([6, 1.1]); if (L >= 7) pool.push([7, 0.6]); if (L >= 10) pool.push([8, 0.25]); }
    const tot = pool.reduce((a, p) => a + p[1], 0);
    while (budget > 0) {
      let r = random() * tot, t = pool[0][0]; for (const p of pool) { r -= p[1]; if (r <= 0) { t = p[0]; break; } }
      if (ETYPES[t].mp) { if (bigs >= (L >= 16 ? 3 : L >= 9 ? 2 : 1)) t = 1; else { bigs++; budget -= 2; } }
      const a = random() * 2 * PI, d = rnd(800, 1100) + ETYPES[t].r;
      this.addEnemy(t, A.x + cos(a) * d, A.y + sin(a) * d, L, fac); budget--;
    }
  }
  fireEB(x, y, ang, w, tg, L, extra = {}) {
    const W = WEAP[w], spd = W.spd + 6 * L;
    const mk = (a) => this.eb.push(Object.assign({ id: this.id(), x, y, vx: cos(a) * spd, vy: sin(a) * spd, t: W.t, r: W.r, life: W.life || 5, passed: 0, hv: W.heavy || W.t === 1 ? 1 : 0, home: W.home || 0, tg, spd }, extra));
    if (W.n) for (let k = 0; k < W.n; k++) mk(ang + (k - (W.n - 1) / 2) * W.spread + rnd(-0.05, 0.05)); else mk(ang);
    this.ev('ef', round(x), round(y), W.t, w === 'ion' ? 1 : 0);
  }
  // ----- loop -----
  step() {
    this.t += DT;
    for (const s of this.seats) {
      const h = s.human, useH = h && !h.inp.idle;
      s.prev = s.cur; s.cur = Object.assign({}, useH ? h.inp : s.bi);
      s.acts = useH ? h.acts.splice(0) : s.bacts.splice(0); if (h && !useH) h.acts.length = 0;
    }
    if (this.phase === 'map') {
      this.phaseT -= DT; const hum = this.humans();
      if (hum && this.votes.size >= hum && this.phaseT > 1) this.phaseT = 1;
      if (this.phaseT <= 0) this.startMission(this.chooseMission());
      this.idleCruise();
    } else if (this.phase === 'mission') {
      if (this.tickN % 3 === 0) this.botThink();
      if (!this.ship.dead) this.simShip();
      this.simWorld(); this.missionLogic();
    } else if (this.phase === 'result') {
      this.phaseT -= DT; this.simWorld();
      if (this.phaseT <= 0) {
        this.phase = 'upgrade'; this.ready.clear(); this.phaseT = this.humans() ? 45 : 1.5;
        for (const s of this.seats) botSpend(s.bot, TREE_OF[s.idx], this.mk, s.idx);
        if (!this.humans() && this.mk < 2 && this.cores >= MK_COST[this.mk + 1]) this.buyMk();
        for (const c of this.clients) c.dirty = 1;
      }
    } else if (this.phase === 'upgrade') {
      this.phaseT -= DT; this.idleCruise();
      const hum = this.humans(); if (hum && this.ready.size >= hum && this.phaseT > 0.4) this.phaseT = 0.4;
      if (this.phaseT <= 0) {
        if (this.pub && !hum && Date.now() - this.emptySince > 15 * 60e3 && this.mainDone > 4) { this.mainDone = 0; this.failStreak = 0; this.mk = 0; this.cores = 0; this.makeOptions(); }
        this.phase = 'map'; this.phaseT = hum ? 16 : 2; this.enemies = []; this.eb = []; this.allies = []; this.picks = []; this.resetShip(); this.votes.clear();
      }
    }
    if (++this.tickN % SEND_EVERY === 0) this.broadcast();
  }
  buyMk() { if (this.mk >= 2 || this.cores < MK_COST[this.mk + 1]) return false; this.cores -= MK_COST[this.mk + 1]; this.mk++; this.ev('mk', this.mk); for (const c of this.clients) c.dirty = 1; return true; }
  idleCruise() { const s = this.ship; s.a = wrap(s.a + 0.12 * DT); s.vx = cos(s.a) * 70; s.vy = sin(s.a) * 70; s.x += s.vx * DT; s.y += s.vy * DT; s.sa = wrap(s.sa + 0.6 * DT); }
  chooseMission() {
    const hum = this.humans(); const tally = new Map();
    for (const c of this.clients) {
      const v = this.votes.get(c.pid); if (!v) continue; const seat = this.seatOf(c);
      const w = seat && seat.idx === PILOT ? max(1, hum - 1) : 1;
      const t = tally.get(v) || { w: 0, others: 0 }; t.w += w; if (!(seat && seat.idx === PILOT)) t.others++; tally.set(v, t);
    }
    let best = null, bt = null;
    for (const [v, t] of tally) if (!bt || t.w > bt.w || (t.w === bt.w && t.others > bt.others)) { best = v; bt = t; }
    let m = this.options.find(o => o.id === best);
    if (!m) m = this.failStreak >= 2 ? this.options[1] : this.options[0];
    return m;
  }
  hostiles() { let n = 0; for (const e of this.enemies) if (e.type !== 10 && !e.dead) n++; return n; }
  missionLogic() {
    const M = this.mission, s = this.ship; if (!M) return; M.time += DT;
    if (s.dead) { s.deadT -= DT; if (s.deadT <= 0) this.endMission(false); return; }
    const L = M.level, H = this.hostiles();
    const waveCheck = () => {
      if (H === 0 || (M.type === 'defend' && M.waveT < -16)) {
        M.waveT -= DT;
        if (M.waveT <= 0 || M.type === 'defend' && M.waveT < -16) {
          if (M.wave < M.waves) { M.wave++; const anc = M.type === 'defend' ? this.allies.find(a => a.k === 'fs') : null; this.spawnWave(L, M.wave - 1, M.fac, anc); M.waveT = 1.5; this.ev('wave', M.wave); return; }
          if (M.type === 'flagship' && !M.bossSpawned) { M.bossSpawned = 1; const a = random() * 2 * PI; this.addEnemy(8, s.x + cos(a) * 1200, s.y + sin(a) * 1200, L, 'dom'); this.spawnWave(L, 0, 'dom'); this.ev('boss'); return; }
          if (H === 0) this.endMission(true);
        }
      } else if (M.type === 'defend') M.waveT -= DT;
    };
    if (M.type === 'pirates' || M.type === 'flagship' || M.type === 'defend') waveCheck();
    if (M.type === 'defend') { const fs_ = this.allies.find(a => a.k === 'fs'); if (!fs_ && this.phase === 'mission') return this.endMission(false); }
    if (M.type === 'station') {
      const st = this.enemies.find(e => e.type === 9);
      M.trickle -= DT; if (st && M.trickle <= 0 && H < 12) { M.trickle = 28; this.spawnWave(L, 0, M.fac, st); }
      if (!st && H === 0) this.endMission(true);
    }
    if (M.type === 'escort') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 14) { M.trickle = 12; const f = this.allies.find(a => a.k === 'fr'); this.spawnWave(L, floor(M.time / 30), M.fac, f || s); }
      const alive = this.allies.filter(a => a.k === 'fr').length;
      if (!alive) this.endMission(M.got >= 1);
    }
    if (M.type === 'hostages') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 10) { M.trickle = 15; this.spawnWave(L, 0, 'pir'); }
      if (M.lost > M.pods - M.need) return this.endMission(false);
      if (!this.allies.some(a => a.k === 'pod')) this.endMission(M.got >= M.need);
    }
  }
  // ----- ship -----
  inp(i) { return this.seats[i].cur; }
  up(i) { return !this.ship.down[i]; }
  busy(i) { return this.seats[i].cur.as && this.up(i); }
  can(i) { return this.up(i) && !this.busy(i); }
  repairPriority() {
    const s = this.ship, ord = [REPAIR, SHIELD, PILOT, ENG, GUNL, GUNR];
    for (const i of ord) if (s.down[i]) return i;
    for (const i of ord) if (s.st[i] < this.stMax(i)) return i;
    return s.hull < s.hm - 0.05 ? 6 : -1;
  }
  abilityOf(i, slot) { const br = TREES[TREE_OF[i]].br[slot]; for (const n of br.nodes) if (n[3] && this.has(i, n[0])) return n[3]; return null; }
  buffDur(i, base) { const k = { pilot: 'p_long', engineer: 'e_long', shield: 's_long', repair: 'r_long' }[TREE_OF[i]]; return base + (k && this.has(i, k) ? 2 : 0); }
  stationAt(rel) { return ((round(wrap(rel) / (PI / 3)) % 6) + 6) % 6; }
  act(i, a) {
    const s = this.ship;
    if (a === 'q' || a === 'e' || a === 'r') return this.useAbility(i, 'qer'.indexOf(a));
    if (a === 'alt' && i === SHIELD && this.can(SHIELD)) { s.sm ^= 1; s.flipT = 0; this.ev('flip', s.sm); }
    if (i === ENG && this.can(ENG) && a[0] === 'p') {
      const k = +a[1] - 1, P = s.pip;
      if (k === 3) { s.pip = [2, 2, 2]; this.ev('pip'); return; }
      if (k < 0 || k > 2 || P[k] >= 4) return;
      let j = -1; for (let q = 0; q < 3; q++) if (q !== k && P[q] > 0 && (j < 0 || P[q] > P[j])) j = q;
      if (j >= 0) { P[j]--; P[k]++; this.ev('pip'); }
    }
  }
  useAbility(i, slot) {
    const s = this.ship, seat = this.seats[i], ab = this.abilityOf(i, slot), I = this.inp(i);
    if (!ab || s.dead || !this.up(i)) return;
    if ((seat.cd[ab] || 0) > 0) return;
    let cd = ABIL[ab].cd; const has = id => this.has(i, id);
    const aimRel = wrap(atan2(I.ay - s.y, I.ax - s.x) - s.a);
    switch (ab) {
      case 'roll': { s.inv = max(s.inv, 0.7 + (has('p_roll2') ? 0.3 : 0)); const side = aimRel >= 0 ? 1 : -1; s.vx += cos(s.a + side * PI / 2) * 300; s.vy += sin(s.a + side * PI / 2) * 300; if (has('p_slip')) s.slip = 2; if (has('p_roll2')) cd -= 3; s.roll = 0.7 * side; break; }
      case 'volley': { const n = 6 + (has('p_volley2') ? 4 : 0); const tg = this.enemies.filter(e => !e.dead && e.warp <= 0 && e.type !== 10 && d2(e, s) < 800 * 800).sort((a, b) => d2(a, s) - d2(b, s)); if (!tg.length) return; for (let k = 0; k < n; k++) { const e = tg[k % tg.length], a = s.a + (k - n / 2) * 0.25; this.pp.push({ id: this.id(), x: s.x, y: s.y, vx: cos(a) * 500, vy: sin(a) * 500, spd: 700, home: 6, tgt: e.id, dmg: 1.6 * (1 + 0.04 * this.inf(i, 'i_nose')), life: 2.5, k: 'dart', splash: 0 }); } break; }
      case 'cry': { const d = this.buffDur(i, 5); for (const st of this.seats) st.bf.cry = d; if (has('p_rally')) s.en = min(s.em, s.en + 20); if (has('p_inspire')) cd -= 8; break; }
      case 'overcharge': seat.bf.over = 3 + (has('g_over2') ? 2 : 0); break;
      case 'flak': { const rings = has('g_flak3') ? 2 : 1; for (let r = 0; r < rings; r++) for (let k = 0; k < 18; k++) { const a = k / 18 * 2 * PI + r * 0.17; this.addBolt(s.x + cos(a) * 30, s.y + sin(a) * 30, a, 820 - r * 200, has('g_flak2') ? 1 : 0.35, 0, 4, 0.4, 16); } if (has('g_flak3')) cd -= 4; break; }
      case 'paint': { const n = has('g_spread') ? 3 : 1; const pt = { x: I.ax, y: I.ay }; const tg = this.enemies.filter(e => !e.dead && e.warp <= 0 && e.type !== 10).sort((a, b) => d2(a, pt) - d2(b, pt)).slice(0, n); if (!tg.length) return; for (const e of tg) { e.paint = 6 + (has('g_paint2') ? 3 : 0); e.spot = has('g_spot') ? 1 : 0; this.ev('paint', e.id); } break; }
      case 'reroute': { const tgt = aimRel >= 0 ? GUNR : GUNL, d = this.buffDur(i, 5); this.seats[tgt].bf.reroute = d; this.seats[tgt].bf.ovl = has('e_overload') ? d : 0; if (has('e_split')) this.seats[tgt === GUNR ? GUNL : GUNR].bf.rhalf = d; s.reroute = d; if (has('e_overload')) cd -= 4; this.ev('buff', 'reroute', tgt); break; }
      case 'burner': s.burn = 2.5; if (has('e_damp')) { s.inv = max(s.inv, 1); cd -= 4; } break;
      case 'bomb': { let dx = I.ax - s.x, dy = I.ay - s.y, d = hypot(dx, dy) || 1; const r = min(d, 650); this.bombs.push({ id: this.id(), x: s.x, y: s.y, tx: s.x + dx / d * r, ty: s.y + dy / d * r, rad: 150 * (has('e_yield') ? 1.25 : 1), dmg: 7 * (has('e_seismic') ? 1.6 : 1), cl: has('e_cluster') }); if (has('e_seismic')) cd -= 4; this.ev('bl'); break; }
      case 'bubble': s.bubble = 2 + (has('s_bubble2') ? 1 : 0); s.mirror = has('s_mirror'); if (s.mirror) cd -= 6; break;
      case 'vent': s.vent = 2; s.en = min(s.em, s.en + 30 + (has('s_vent2') ? 20 : 0)); break;
      case 'aegis': { const d = this.buffDur(i, 4); s.aegis = d; if (has('s_rally')) s.rally = d; break; }
      case 'nano': { const t = s.task.i; if (t >= 0 && t < 6) this.healStation(t, this.stMax(t) * 0.4); else if (s.hull < s.hm) s.hull = min(s.hm, s.hull + 1.5); else return; break; }
      case 'droneod': s.dod = 4; break;
      case 'stim': { const k = this.stationAt(aimRel), d = this.buffDur(i, 5); const tg = [k === REPAIR ? GUNL : k]; if (has('r_medbay')) { tg.push((tg[0] + 1) % 6 === REPAIR ? (tg[0] + 2) % 6 : (tg[0] + 1) % 6); cd -= 5; } for (const t of tg) { this.seats[t].bf.stim = d; if (has('r_stimfix')) this.healStation(t, 1); this.ev('buff', 'stim', t); } break; }
    }
    if (i === ENG) cd *= max(0.6, 1 - 0.02 * this.inf(ENG, 'i_cdr'));
    seat.cd[ab] = cd; seat.cdm[ab] = cd; this.ev('ab', i, ab);
  }
  healStation(i, amt) { const s = this.ship, m = this.stMax(i); s.st[i] = min(m, s.st[i] + amt); if (s.st[i] >= m - 1e-6 && s.down[i]) { s.st[i] = m; s.down[i] = 0; this.ev('sr', i); } }
  simShip() {
    const s = this.ship, P = this.inp(PILOT), E = this.inp(ENG), S = this.inp(SHIELD), R = this.inp(REPAIR);
    for (const seat of this.seats) { for (const a of seat.acts) this.act(seat.idx, a); for (const k in seat.cd) seat.cd[k] -= DT; for (const k in seat.bf) seat.bf[k] -= DT; }
    for (const k of ['inv', 'vent', 'bubble', 'aegis', 'rally', 'burn', 'slip', 'reroute', 'dod', 'nose', 'gl', 'gr', 'scat']) s[k] -= DT;
    s.roll = (s.roll || 0) * 0.9;
    const up = i => !s.down[i];
    // energy
    s.em = 100 + (this.has(SHIELD, 's_cap') ? 25 : 0) + (this.big(ENG, 'b_hyper') ? 25 : 0) + (this.hasPort(SHIELD, 'capbank') ? 50 : 0);
    const regen = 3.2 * (this.has(ENG, 'e_reactor') ? 1.3 : 1) * (1 + 0.04 * this.inf(ENG, 'i_regen')) * (this.big(ENG, 'b_hyper') ? 1.4 : 1) * (this.hasPort(ENG, 'aux') ? 1.35 : 1) * (this.hasPort(SHIELD, 'capbank') ? 1.2 : 1) * (up(SHIELD) ? 1 : 0.5);
    s.en = min(s.em, s.en + regen * DT);
    // helm: pilot only. Cockpit destroyed => the ship keeps its heading, no steering at all
    if (this.can(PILOT)) {
      const turn = 2.5 * (this.has(PILOT, 'p_agile') ? 1.15 : 1) * (1 + 0.03 * this.inf(PILOT, 'i_turn')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * sqrt(this.pipF(0));
      const dx = P.ax - s.x, dy = P.ay - s.y; if (dx * dx + dy * dy > 900) s.a = wrap(s.a + clamp(wrap(atan2(dy, dx) - s.a), -turn * DT, turn * DT));
    }
    // speed: engineer only. Engines destroyed => slow stall to zero
    if (this.can(ENG)) s.thr = clamp(E.thr, 0.25, 1);
    const maxSp = 290 * (this.has(ENG, 'e_turbine') ? 1.12 : 1) * (1 + 0.02 * this.inf(ENG, 'i_speed')) * this.pipF(0) * (this.bf(ENG, 'stim') ? 1.25 : 1);
    if (up(ENG)) { const tgt = maxSp * s.thr * (s.burn > 0 ? 1.8 : 1) * (s.slip > 0 ? 1.4 : 1) * (s.reroute > 0 ? 0.6 : 1); s.spd += clamp(tgt - s.spd, -260 * DT, 260 * DT); }
    else { const tgt = this.has(ENG, 'e_limp') ? maxSp * 0.35 * s.thr : 0; s.spd = s.spd > tgt ? max(tgt, s.spd - 30 * DT) : tgt; }
    const k = min(1, 2.8 * DT);
    s.vx += (cos(s.a) * s.spd - s.vx) * k; s.vy += (sin(s.a) * s.spd - s.vy) * k;
    s.x += s.vx * DT; s.y += s.vy * DT;
    const B = ARENA - 40;
    // arena edge: the nav computer bounces the ship back in (keeps a drifting, unsteerable ship in play)
    if (s.x < -B || s.x > B) { s.x = clamp(s.x, -B, B); s.vx = -s.vx * 0.5; s.a = wrap(PI - s.a); }
    if (s.y < -B || s.y > B) { s.y = clamp(s.y, -B, B); s.vy = -s.vy * 0.5; s.a = wrap(-s.a); }
    const cry = i => this.bf(i, 'cry') ? 1.25 : 1, rally = s.rally > 0 ? 1.25 : 1, pipW = this.pipF(1);
    // nose laser + pilot ports
    if (this.can(PILOT) && P.f && s.nose <= 0) {
      const rate = 4 * (this.has(PILOT, 'p_cap') ? 1.3 : 1) * (1 + 0.03 * this.inf(PILOT, 'i_nrate')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * cry(PILOT) * rally * pipW * ((s.down[GUNL] || s.down[GUNR]) ? 1.5 : 1);
      s.nose = 1 / rate; s.noseN++;
      const dmg = 0.8 * (this.has(PILOT, 'p_lens') ? 1.25 : 1) * (1 + 0.04 * this.inf(PILOT, 'i_nose')), pier = this.has(PILOT, 'p_pierce') ? 1 : 0;
      let a = s.a;
      if (this.big(PILOT, 'b_tc')) { let best = null, bd = 0.27; for (const e of this.enemies) { if (e.dead || e.warp > 0 || d2(e, s) > 8e5) continue; const q = abs(wrap(atan2(e.y - s.y, e.x - s.x) - s.a)); if (q < bd) { bd = q; best = e; } } if (best) a = atan2(best.y - s.y, best.x - s.x); }
      this.addBolt(s.x + cos(s.a) * 44, s.y + sin(s.a) * 44, a, 1250, dmg, pier, 2, 0.65);
      if (this.hasPort(PILOT, 'twin')) for (const sd of [-1, 1]) this.addBolt(s.x + cos(s.a) * 10 + cos(s.a + sd * PI / 2) * 40, s.y + sin(s.a) * 10 + sin(s.a + sd * PI / 2) * 40, a, 1250, dmg * 0.8, 0, 2, 0.6);
      if (this.hasPort(PILOT, 'rockets') && s.noseN % 4 === 0) this.addRocket(s.x, s.y, s.a, 4 * dmg / 0.8, 0);
      if (this.hasPort(PILOT, 'scatter') && s.scat <= 0) { s.scat = 1; for (let q = -2; q <= 2; q++) this.addBolt(s.x + cos(s.a) * 40, s.y + sin(s.a) * 40, a + q * 0.09, 1100, dmg * 0.8, 0, 2, 0.4); }
    }
    // turrets
    const shieldsDown = s.down[SHIELD] || s.vent > 0;
    for (const [gi, key, cdk, side, bk] of [[GUNL, 'tl', 'gl', -1, 'bl'], [GUNR, 'tr', 'gr', 1, 'br']]) {
      s.beam[gi] = 0; if (!this.can(gi)) continue;
      const G = this.inp(gi), other = gi === GUNL ? GUNR : GUNL, sb = this.seats[gi].bf;
      const rr = sb.reroute > 0 ? 1 : 0, rh = sb.rhalf > 0 ? 1 : 0;
      const center = side * 80 * PI / 180, half = s.down[other] ? PI : 110 * PI / 180;
      let rel = wrap(atan2(G.ay - s.y, G.ax - s.x) - s.a);
      const off = wrap(rel - center); if (abs(off) > half) rel = center + clamp(off, -half, half);
      const slew = 7 * (this.has(gi, 'g_swivel') ? 1.25 : 1) * (1 + 0.04 * this.inf(gi, 'i_slew')) * (this.has(PILOT, 'p_steady') ? 1.2 : 1) * (rr ? 1.5 : rh ? 1.25 : 1) * (this.bf(gi, 'stim') ? 1.4 : 1);
      s[key] = wrap(s[key] + clamp(wrap(rel - s[key]), -slew * DT, slew * DT));
      s[bk] = wrap(s[bk] + clamp(wrap(rel - s[bk]), -slew * 0.45 * DT, slew * 0.45 * DT));
      const dmgM = (this.has(gi, 'g_coils') ? 1.2 : 1) * (1 + 0.04 * this.inf(gi, 'i_dmg')) * (rr ? (sb.ovl > 0 ? 1.6 : 1.3) : rh ? 1.15 : 1);
      const la = s.a + side * 60 * PI / 180, px = s.x + cos(la) * 22, py = s.y + sin(la) * 22, wa = s.a + s[key];
      if (G.f && s[cdk] <= 0) {
        const over = sb.over > 0;
        let rate = 4.2 * (1 + 0.03 * this.inf(gi, 'i_rof')) * cry(gi) * rally * pipW * (over ? 2 : 1) * (rr ? 1.5 : rh ? 1.25 : 1) * (this.bf(gi, 'stim') ? 1.4 : 1) * (s.down[other] ? 1.25 : 1) * (this.has(gi, 'g_cover') && shieldsDown ? 1.3 : 1);
        if (s.en >= 0.4) s.en -= 0.4; else rate *= 0.5;
        s[cdk] = 1 / rate;
        const pier = this.has(gi, 'g_pierce') ? 1 : 0, pd = this.has(gi, 'g_pd') ? 24 : 12;
        const spreads = over && this.has(gi, 'g_tri') ? [-0.08, 0, 0.08] : [0];
        for (const sp of spreads) {
          if (this.big(gi, 'b_twin')) for (const o of [-4, 4]) this.addBolt(px + cos(wa) * 14 - sin(wa) * o, py + sin(wa) * 14 + cos(wa) * o, wa + sp, 1300, dmgM, pier, 1, 0.62, pd);
          else this.addBolt(px + cos(wa) * 14, py + sin(wa) * 14, wa + sp, 1300, dmgM, pier, 1, 0.62, pd);
        }
      }
      // extra gun ports fire in tandem with the main guns
      const gp = s.gp[gi]; gp.rk -= DT; gp.sc -= DT;
      if (G.f) {
        if (this.hasPort(gi, 'rockets') && gp.rk <= 0) { gp.rk = 1.1; this.addRocket(px, py, wa, 4.5 * dmgM, 1); }
        if (this.hasPort(gi, 'scatter') && gp.sc <= 0) { gp.sc = 0.9; for (let q = -2; q <= 2; q++) this.addBolt(px, py, wa + q * 0.1, 1100, 0.8 * dmgM, 0, 1, 0.36); }
        if (this.hasPort(gi, 'beam')) this.fireBeam(gi, px, py, s.a + s[bk], 3.4 * dmgM * cry(gi));
      }
    }
    // shield
    if (this.can(SHIELD)) {
      const rel = wrap(atan2(S.ay - s.y, S.ax - s.x) - s.a), spin = 4.2 * (this.has(SHIELD, 's_spin') ? 1.3 : 1) * (1 + 0.04 * this.inf(SHIELD, 'i_spin')) * (this.bf(SHIELD, 'stim') ? 1.4 : 1) * sqrt(this.pipF(2));
      s.sa = wrap(s.sa + clamp(wrap(rel - s.sa), -spin * DT, spin * DT));
      if (this.has(SHIELD, 's_smart')) { s.flipT += DT; if (s.flipT > 0.35) { s.flipT = 0; const th = this.threats(); if (th[0] && th[0].tti < 1.2) { const m = th[0].b.t ? 1 : 0; if (m !== s.sm) { s.sm = m; this.ev('flip', m); } } } }
    }
    // engineer port: mines
    if (this.hasPort(ENG, 'mines') && up(ENG)) { s.mineT -= DT; if (s.mineT <= 0) { s.mineT = 3; this.mines.push({ id: this.id(), x: s.x - cos(s.a) * 40, y: s.y - sin(s.a) * 40, life: 20 }); } }
    // repair task (calibration needle), self-patching, assisting
    const rq = (this.has(REPAIR, 'r_quick') ? 1.25 : 1) * (1 + 0.04 * this.inf(REPAIR, 'i_rep')) * cry(REPAIR) * (this.bf(REPAIR, 'stim') ? 1.4 : 1);
    const T = s.task;
    if (this.can(REPAIR)) {
      const tg = (R.rt >= 0 && R.rt <= 6 && (R.rt === 6 ? s.hull < s.hm - 0.05 : s.st[R.rt] < this.stMax(R.rt))) ? R.rt : this.repairPriority();
      if (tg !== T.i) { T.i = tg; T.bc = rnd(-0.55, 0.55); T.mark = tg >= 0 && tg < 6 ? s.st[tg] / this.stMax(tg) : 0; }
      T.bw = 0.3 * (this.has(REPAIR, 'r_band') ? 1.35 : 1);
      if (tg >= 0 && R.f && this.needleIn(this.t - 0.2)) {
        if (tg === 6) s.hull = min(s.hm, s.hull + 0.4 * rq * DT);
        else { const m = this.stMax(tg); this.healStation(tg, m / 6 * rq * DT); const frac = s.st[tg] / m; if (frac - T.mark > 0.25) { T.mark = frac; T.bc = rnd(-0.55, 0.55); } }
      }
      const hreg = 0.03 * (this.has(REPAIR, 'r_hull') ? 2 : 1) * (this.hasPort(REPAIR, 'welder') ? 3 : 1);
      s.hull = min(s.hm, s.hull + hreg * DT);
    } else T.i = -1;
    for (let i = 0; i < 6; i++) {
      const c = this.inp(i), m = this.stMax(i);
      if (s.down[i] && c.f) this.healStation(i, m / 22 * (this.has(REPAIR, 'r_kits') ? 2 : 1) * DT);
      else if (this.busy(i)) { const t = s.down[REPAIR] ? REPAIR : this.repairPriority(); if (t >= 0 && t < 6 && t !== i) this.healStation(t, this.stMax(t) / 20 * DT); }
      if (s.down[i] && this.big(REPAIR, 'b_auto')) this.healStation(i, m / 40 * DT);
    }
    // drones: auto-deploy only while every port is at full health
    const healthy = s.st.every((v, i) => v >= this.stMax(i) - 1e-6) && up(REPAIR);
    const nD = healthy ? 1 + (this.hasPort(REPAIR, 'drone2') ? 1 : 0) : 0;
    const dl = (this.has(REPAIR, 'r_dlaser') ? 1.3 : 1) * (1 + 0.05 * this.inf(REPAIR, 'i_ddmg')), dhp = 3 + (this.has(REPAIR, 'r_darmor') ? 2 : 0) + 0.3 * this.inf(REPAIR, 'i_darm');
    while (s.drones.length < 2) s.drones.push({ x: s.x, y: s.y, hp: dhp, on: 0, cd: 0, fc: 0, mc: 3 });
    s.drones.forEach((Dr, k) => {
      Dr.cd -= DT; Dr.fc -= DT; Dr.mc -= DT;
      const want = k < nD && Dr.cd <= 0;
      if (want && !Dr.on) { Dr.on = 1; Dr.hp = dhp; Dr.x = s.x; Dr.y = s.y; this.ev('launch'); }
      if (!want && Dr.on) { Dr.on = 0; this.ev('recall'); }
      if (!Dr.on) { Dr.x = s.x; Dr.y = s.y; return; }
      let tx = R.ax + k * 70, ty = R.ay + k * 40; const ddx = tx - s.x, ddy = ty - s.y, dd = hypot(ddx, ddy);
      if (dd > 650) { tx = s.x + ddx / dd * 650; ty = s.y + ddy / dd * 650; }
      const vx = tx - Dr.x, vy = ty - Dr.y, vd = hypot(vx, vy) || 1, sp = min(460 * (s.dod > 0 ? 1.5 : 1), vd * 4);
      Dr.x += vx / vd * sp * DT; Dr.y += vy / vd * sp * DT;
      if (Dr.fc <= 0) {
        let best = null, bd = 420 * 420; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const q = d2(e, Dr); if (q < bd) { bd = q; best = e; } }
        if (best) { Dr.fc = 1 / (3 * (s.dod > 0 ? 3 : 1)); this.addBolt(Dr.x, Dr.y, atan2(best.y - Dr.y, best.x - Dr.x), 1100, 0.8 * dl, 0, 3, 0.45, 12); if (this.has(REPAIR, 'r_dmsl') && Dr.mc <= 0) { Dr.mc = 3; this.pp.push({ id: this.id(), x: Dr.x, y: Dr.y, vx: 0, vy: 0, spd: 520, home: 4, tgt: best.id, dmg: 3 * dl, life: 3, k: 'dart', splash: 40 }); } }
      }
    });
    // shield drone port
    const SD = s.sdr; SD.cd -= DT; SD.on = this.hasPort(REPAIR, 'sdrone') && SD.cd <= 0 && up(REPAIR); SD.a += 2.2 * DT;
    if (SD.on) { SD.x = s.x + cos(SD.a) * 92; SD.y = s.y + sin(SD.a) * 92; }
  }
  needleIn(t) { const T = this.ship.task; return abs(sin(t * 1.7) - T.bc) < T.bw; }
  fireBeam(gi, px, py, a, dps) {
    const s = this.ship, L = 380, cx = cos(a), cy = sin(a); let hitD = L, hitE = null, hitP = -1;
    for (const e of this.enemies) {
      if (e.dead || e.warp > 0) continue;
      const ex = e.x - px, ey = e.y - py, t = ex * cx + ey * cy; if (t < -e.r || t > L + e.r) continue;
      const perp = abs(ex * cy - ey * cx); if (perp > e.r + 6) continue;
      if (ETYPES[e.type].mp) {
        let pk = -1, pd = 1e9; e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [wx, wy] = this.portPos(e, k); const qx = wx - px, qy = wy - py, tt = qx * cx + qy * cy; if (tt > 0 && tt < pd && abs(qx * cy - qy * cx) < 14) { pd = tt; pk = k; } });
        const armour = max(0, t - e.r * 0.6);
        if (pk >= 0 && pd < hitD && pd <= armour + 30) { hitD = pd; hitE = e; hitP = pk; } else if (armour < hitD) { hitD = armour; hitE = e; hitP = -2; }
      } else { const tt = max(0, t - e.r * 0.5); if (tt < hitD) { hitD = tt; hitE = e; hitP = -1; } }
    }
    for (const b of this.eb) { if (b.dead) continue; const ex = b.x - px, ey = b.y - py, t = ex * cx + ey * cy; if (t > 0 && t < hitD && abs(ex * cy - ey * cx) < 9) { b.dead = 1; this.ev('pd', round(b.x), round(b.y), b.t); } }
    if (hitE && hitP !== -2) this.damageEnemy(hitE, hitP, dps * DT * (hitE.paint > 0 ? 1.5 : 1));
    s.beam[gi] = [round(a * 100) / 100, round(hitD)];
  }
  addBolt(x, y, a, spd, dmg, pierce, kind, life, pd = 0) {
    const b = { id: this.id(), x, y, vx: cos(a) * spd, vy: sin(a) * spd, dmg, pierce, kind, life, hit: [], pd };
    this.bolts.push(b); this.ev('b', b.id, round(x), round(y), round(b.vx), round(b.vy), kind, life);
  }
  addRocket(x, y, a, dmg, home) { const s = this.ship; this.pp.push({ id: this.id(), x, y, vx: cos(a) * 520 + s.vx * 0.5, vy: sin(a) * 520 + s.vy * 0.5, spd: 560, home: home ? 1.2 : 0, tgt: null, dmg, life: 1.6, k: 'rk', splash: 70 }); this.ev('rk'); }
  // ----- world -----
  portPos(e, k) { const p = ETYPES[e.type].ports[k], c = cos(e.a), s_ = sin(e.a); return [e.x + p.x * c - p.y * s_, e.y + p.x * s_ + p.y * c]; }
  inHull(e, wx, wy) { // local-space hull test
    const H = ETYPES[e.type].hull, dx = wx - e.x, dy = wy - e.y, c = cos(-e.a), s_ = sin(-e.a), lx = dx * c - dy * s_, ly = dx * s_ + dy * c;
    if (H.k === 'ell') return (lx / H.a) ** 2 + (ly / H.b) ** 2 < 1;
    if (H.k === 'circ') return lx * lx + ly * ly < H.r * H.r;
    const P = H.p; let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1]; if (((yi > ly) !== (yj > ly)) && lx < (xj - xi) * (ly - yi) / (yj - yi) + xi) inside = !inside; } return inside;
  }
  losClear(e, px, py, a) { for (let d = 10; d <= 200; d += 10) if (this.inHull(e, px + cos(a) * d, py + sin(a) * d)) return false; return true; }
  pickTarget(e) {
    e.tgtT -= DT; if (e.tgt && e.tgtT > 0 && !e.tgt.dead) return e.tgt;
    e.tgtT = 2; let t = this.ship.dead ? null : this.ship;
    if (this.allies.length && random() < (this.mission && this.mission.type === 'defend' ? 0.55 : 0.4)) { const a = this.allies.filter(a => a.k !== 'pod'); if (a.length) t = pick(a); }
    return e.tgt = t;
  }
  simWorld() {
    const s = this.ship, L = this.mission ? this.mission.level : 1, dm = this.mission ? DIFFS[this.mission.diff].m : 1;
    // enemies
    for (const e of this.enemies) {
      if (e.dead) continue; const T = ETYPES[e.type];
      if (e.warp > 0) { e.warp -= DT; continue; }
      e.paint -= DT;
      if (e.type === 10) { e.x += e.vx * DT; e.y += e.vy * DT; e.a += e.spin * DT; if (d2(e, s) < (e.r + HULL_R) ** 2 && !s.dead) { this.hitShip(e.x, e.y, 1, 2, null); this.damageEnemy(e, -1, 99); } continue; }
      const tg = this.phase === 'mission' ? this.pickTarget(e) : null; if (!tg) { e.vx *= 0.98; e.vy *= 0.98; e.x += e.vx * DT; e.y += e.vy * DT; continue; }
      const dx = tg.x - e.x, dy = tg.y - e.y, d = hypot(dx, dy) || 1, ta = atan2(dy, dx), spd = T.spd * (1 + 0.02 * L);
      let vx, vy;
      if (e.type === 5) { vx = dx / d * spd; vy = dy / d * spd; if (d < e.r + (tg.r || HULL_R) + 4) { if (tg === s) this.hitShip(e.x, e.y, 2, 2, null); else tg.hp -= 6; this.killEnemy(e, 0); continue; } }
      else if (T.spd === 0) { vx = 0; vy = 0; }
      else {
        const want = T.want + (T.mp ? 0 : 0); const rad = d > want ? 1 : d < want * 0.7 ? -0.8 : 0;
        vx = (dx / d * rad - dy / d * e.orbit * 0.8) * spd; vy = (dy / d * rad + dx / d * e.orbit * 0.8) * spd;
        if (random() < 0.004) e.orbit *= -1;
      }
      const tf = T.mp ? 0.5 : 4, desired = (e.type === 5 || !T.mp) && T.g && !T.g.turret ? ta : atan2(vy, vx);
      e.a = wrap(e.a + clamp(wrap((T.mp ? ta : desired) - e.a), -tf * DT, tf * DT));
      const k = min(1, 2 * DT); e.vx += (vx - e.vx) * k; e.vy += (vy - e.vy) * k;
      e.x = clamp(e.x + e.vx * DT, -ARENA, ARENA); e.y = clamp(e.y + e.vy * DT, -ARENA, ARENA);
      // ram
      if (!T.mp && d2(e, s) < (e.r + HULL_R) ** 2 && !s.dead) { if (s.burn > 0 && this.has(ENG, 'e_ram')) this.damageEnemy(e, -1, 9); else { this.hitShip(e.x, e.y, 1, 1, null); this.damageEnemy(e, -1, 3); } }
      if (this.phase !== 'mission' || s.dead) continue;
      // weapons
      const rateM = 1 / (0.82 + 0.18 * dm) * (1 + 0.04 * L);
      if (T.g) {
        e.cd -= DT * rateM; const G = T.g, rel = abs(wrap(ta - e.a));
        if (e.cd <= 0 && d < G.rng && (G.turret || rel < G.arc)) {
          e.cd = WEAP[G.w].cd * rnd(0.85, 1.25) / (G.burst ? 0.6 : 1);
          const lead = d / WEAP[G.w].spd, ax = tg.x + (tg.vx || 0) * lead * 0.6, ay = tg.y + (tg.vy || 0) * lead * 0.6, aa = atan2(ay - e.y, ax - e.x);
          for (let q = 0; q < G.n; q++) {
            const off = G.n > 1 ? (q - (G.n - 1) / 2) * 0.05 : 0; const px = e.x + cos(e.a) * e.r, py = e.y + sin(e.a) * e.r;
            this.fireEB(px, py, (G.turret ? aa : e.a + clamp(wrap(aa - e.a), -0.12, 0.12)) + off, G.w, tg, L);
          }
        }
      }
      if (T.mp) e.ports.forEach((p, k) => {
        if (p.hp <= 0) return; const PT = T.ports[k], [px, py] = this.portPos(e, k), pa = atan2(tg.y - py, tg.x - px), pd = hypot(tg.x - px, tg.y - py);
        const rel = wrap(pa - e.a), cr = wrap(rel - PT.f), clampRel = PT.f + clamp(cr, -PT.arc, PT.arc);
        p.pa = wrap(p.pa + clamp(wrap(clampRel - p.pa), -2.2 * DT, 2.2 * DT));
        p.cd -= DT * rateM;
        const W = WEAP[PT.w];
        if (p.ch > 0) { p.ch -= DT; if (p.ch <= 0) { const a = e.a + p.pa; if (this.losClear(e, px, py, a)) this.fireEB(px, py, a, PT.w, tg, L); } return; }
        if (p.cd <= 0 && pd < PT.rng && abs(cr) <= PT.arc && abs(wrap(clampRel - p.pa)) < 0.15) {
          const a = e.a + p.pa; if (!this.losClear(e, px, py, a)) { p.cd = 0.4; return; }
          p.cd = W.cd * rnd(0.9, 1.3) * e.cdm; if (W.charge) { p.ch = W.charge; this.ev('chg', e.id, k); } else this.fireEB(px, py, a, PT.w, tg, L);
        }
      });
    }
    // player bolts
    for (const b of this.bolts) {
      b.life -= DT; if (b.life <= 0) { b.dead = 1; continue; }
      const ox = b.x, oy = b.y; b.x += b.vx * DT; b.y += b.vy * DT;
      if (b.pd) for (const q of this.eb) { if (q.dead || q.t === 0 && !q.hv) continue; if ((q.x - b.x) ** 2 + (q.y - b.y) ** 2 < (b.pd + q.r) ** 2) { q.dead = 1; this.ev('pd', round(q.x), round(q.y), q.t); if (!b.pierce) { b.dead = 1; break; } } }
      if (b.dead) continue;
      for (const e of this.enemies) {
        if (e.dead || e.warp > 0 || b.hit.includes(e.id)) continue;
        const rr = e.r + 4 + (ETYPES[e.type].mp ? 44 : 0); if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > rr * rr) continue;
        if (ETYPES[e.type].mp) {
          let hitP = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || hitP >= 0) return; const [wx, wy] = this.portPos(e, k); if (segD2(ox, oy, b.x, b.y, wx, wy) < 19 * 19) hitP = k; }); // swept test: bolts move ~43px per tick
          if (hitP >= 0) { this.damageEnemy(e, hitP, b.dmg * (e.paint > 0 ? 1.5 : 1)); b.hit.push(e.id); if (!b.pierce) { b.dead = 1; this.ev('x', b.id); break; } }
          else if (this.inHull(e, b.x, b.y)) { // armour absorbs it, unless it lands right next to a live gun port
            let nk = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || nk >= 0) return; const [wx, wy] = this.portPos(e, k); if ((wx - b.x) ** 2 + (wy - b.y) ** 2 < 34 * 34) nk = k; });
            b.dead = 1; if (nk >= 0) this.damageEnemy(e, nk, b.dmg * (e.paint > 0 ? 1.5 : 1)); else this.ev('arm', round(b.x), round(b.y)); this.ev('x', b.id); break; }
        } else { this.damageEnemy(e, -1, b.dmg * (e.paint > 0 ? 1.5 : 1)); b.hit.push(e.id); if (!b.pierce) { b.dead = 1; this.ev('x', b.id); break; } }
      }
    }
    this.bolts = this.bolts.filter(b => !b.dead);
    // homing player projectiles
    for (const p of this.pp) {
      p.life -= DT; if (p.life <= 0) { p.dead = 1; if (p.splash) this.splash(p.x, p.y, p.splash, p.dmg * 0.5); continue; }
      if (p.home) {
        let t = p.tgt ? this.enemies.find(e => e.id === p.tgt && !e.dead) : null;
        if (!t) { let bd = 500 * 500; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const q = d2(e, p); if (q < bd) { bd = q; t = e; } } if (t) p.tgt = t.id; }
        if (t) { const a = atan2(t.y - p.y, t.x - p.x), ca = atan2(p.vy, p.vx), na = ca + clamp(wrap(a - ca), -p.home * DT, p.home * DT); p.vx = cos(na) * p.spd; p.vy = sin(na) * p.spd; }
      } else { const sp = hypot(p.vx, p.vy) || 1; if (sp < p.spd) { p.vx *= 1.04; p.vy *= 1.04; } }
      p.x += p.vx * DT; p.y += p.vy * DT;
      for (const e of this.enemies) {
        if (e.dead || e.warp > 0 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (e.r + 6) ** 2) continue;
        if (ETYPES[e.type].mp) { let hk = -1, hd = 1e9; e.ports.forEach((q, k) => { if (q.hp <= 0) return; const [wx, wy] = this.portPos(e, k), dd = (wx - p.x) ** 2 + (wy - p.y) ** 2; if (dd < hd) { hd = dd; hk = k; } }); if (hk >= 0 && hd < 60 * 60) this.damageEnemy(e, hk, p.dmg); else if (!this.inHull(e, p.x, p.y)) continue; }
        else this.damageEnemy(e, -1, p.dmg);
        if (p.splash) this.splash(p.x, p.y, p.splash, p.dmg * 0.5, e);
        p.dead = 1; this.ev('boom', round(p.x), round(p.y), 0); break;
      }
    }
    this.pp = this.pp.filter(p => !p.dead);
    // engineer bombs
    for (const b of this.bombs) {
      const dx = b.tx - b.x, dy = b.ty - b.y, d = hypot(dx, dy);
      if (d < 18) { b.dead = 1; this.splash(b.tx, b.ty, b.rad, b.dmg); this.ev('boom', round(b.tx), round(b.ty), 2, round(b.rad)); for (const q of this.eb) if (!q.dead && (q.x - b.tx) ** 2 + (q.y - b.ty) ** 2 < b.rad * b.rad) q.dead = 1;
        if (b.cl) for (let k = 0; k < 3; k++) { const a = k * 2.1 + random(); this.bombs.push({ id: this.id(), x: b.tx, y: b.ty, tx: b.tx + cos(a) * 130, ty: b.ty + sin(a) * 130, rad: b.rad * 0.5, dmg: b.dmg * 0.4 }); }
        continue; }
      b.x += dx / d * min(d, 700 * DT); b.y += dy / d * min(d, 700 * DT);
    }
    this.bombs = this.bombs.filter(b => !b.dead);
    // mines (engineer port)
    for (const m of this.mines) { m.life -= DT; if (m.life <= 0) { m.dead = 1; continue; } for (const e of this.enemies) if (!e.dead && e.warp <= 0 && d2(e, m) < (e.r + 30) ** 2) { m.dead = 1; this.splash(m.x, m.y, 90, 4); this.ev('boom', round(m.x), round(m.y), 1); break; } }
    this.mines = this.mines.filter(m => !m.dead);
    // enemy shots
    for (const b of this.eb) {
      if (b.dead) continue; b.life -= DT; if (b.life <= 0) { b.dead = 1; if (b.t === 2) this.ev('boom', round(b.x), round(b.y), 0); continue; }
      if (b.home && b.tg && !b.tg.dead) { const a = atan2(b.tg.y - b.y, b.tg.x - b.x), ca = atan2(b.vy, b.vx), na = ca + clamp(wrap(a - ca), -b.home * DT, b.home * DT); b.vx = cos(na) * b.spd; b.vy = sin(na) * b.spd; }
      b.x += b.vx * DT; b.y += b.vy * DT;
      // drones & shield drone soak shots
      for (const Dr of s.drones) if (Dr.on && (Dr.x - b.x) ** 2 + (Dr.y - b.y) ** 2 < (14 + b.r) ** 2) { b.dead = 1; Dr.hp -= b.hv ? 2 : 1; this.ev('pd', round(b.x), round(b.y), b.t); if (Dr.hp <= 0) { Dr.on = 0; Dr.cd = 8; this.ev('boom', round(Dr.x), round(Dr.y), 0); } break; }
      if (b.dead) continue;
      const SD = s.sdr; if (SD.on && (SD.x - b.x) ** 2 + (SD.y - b.y) ** 2 < (26 + b.r) ** 2) { b.dead = 1; SD.hp -= 1; this.ev('pd', round(b.x), round(b.y), b.t); if (SD.hp <= 0) { SD.cd = 10; SD.hp = 4; } continue; }
      if (!s.dead) {
        const dd = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
        if (dd < (SR + b.r) ** 2 && dd > (SR - 18) ** 2 && !b.passed) {
          const ang = wrap(atan2(b.y - s.y, b.x - s.x) - s.a), cov = this.shieldCovers(ang, b);
          if (cov) {
            b.dead = 1; const gain = (b.hv ? 4 : 2) * (this.has(SHIELD, 's_absorb') ? 1.5 : 1) * this.pipF(2); s.en = min(s.em, s.en + gain);
            if (this.has(SHIELD, 's_overflow') && s.en > s.em * 0.9) s.hull = min(s.hm, s.hull + 0.08);
            this.ev('blk', round(b.x), round(b.y), b.t);
            if ((cov === 2 && s.mirror) || (this.hasPort(SHIELD, 'reflect') && random() < 0.3)) this.addBolt(b.x, b.y, atan2(-b.vy, -b.vx), 900, 1.5, 0, 1, 0.8);
            continue;
          }
          b.passed = 1;
        }
        if (dd < (HULL_R + b.r) ** 2) { b.dead = 1; this.hitShip(b.x, b.y, b.hv ? 1.5 : 1, b.hv ? 2 : 1, b); continue; }
      }
      for (const a of this.allies) if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2) { b.dead = 1; a.hp -= b.hv ? 3 : 1; this.ev('hit', round(b.x), round(b.y)); break; }
    }
    this.eb = this.eb.filter(b => !b.dead);
    // allies
    const M = this.mission;
    for (const a of this.allies) {
      if (a.hp <= 0) { a.dead = 1; this.ev('boom', round(a.x), round(a.y), 2, round(a.r * 1.5)); if (a.k === 'pod' && M) M.lost++; continue; }
      if (a.k === 'fr' && M && this.phase === 'mission') {
        const dx = M.jx - a.x, dy = M.jy - a.y, d = hypot(dx, dy); a.a = atan2(dy, dx);
        const near = d2(a, s) < 700 * 700 ? 1 : 0.45; a.x += dx / d * a.spd * near * DT; a.y += dy / d * a.spd * near * DT;
        if (d < 80) { a.dead = 1; M.got++; this.grant(15 * DIFFS[M.diff].m); this.ev('jump', round(a.x), round(a.y)); }
      }
      if (a.k === 'pod' && M && this.phase === 'mission' && !s.dead) {
        if (d2(a, s) < 110 * 110) { a.resc += DT; if (a.resc > 1.0) { a.dead = 1; M.got++; this.grant(12 * DIFFS[M.diff].m); this.ev('resc', round(a.x), round(a.y)); } } else a.resc = max(0, a.resc - DT);
      }
      if (a.k === 'fs') a.a += 0.1 * DT;
    }
    this.allies = this.allies.filter(a => !a.dead);
    // pickups: credit chips and cores
    const mag = 150 * (this.hasPort(ENG, 'tractor') ? 3 : 1) * (this.has(REPAIR, 'r_magnet') ? 1.5 : 1);
    for (const p of this.picks) {
      p.life -= DT; if (p.life <= 0) { p.dead = 1; continue; }
      let col = null; if (!s.dead && d2(p, s) < mag * mag) col = s; else for (const Dr of s.drones) if (Dr.on && this.has(REPAIR, 'r_magnet') && d2(p, Dr) < 120 * 120) col = Dr;
      if (col) { const dx = col.x - p.x, dy = col.y - p.y, d = hypot(dx, dy) || 1; p.x += dx / d * 620 * DT; p.y += dy / d * 620 * DT; if (d < 30) { p.dead = 1; if (p.k === 'core') { this.cores++; this.ev('core'); } else this.grant(p.v); this.ev('pick', p.k === 'core' ? 1 : 0, p.v); } }
      else { p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.97; p.vy *= 0.97; }
    }
    this.picks = this.picks.filter(p => !p.dead);
    this.enemies = this.enemies.filter(e => !e.dead);
  }
  splash(x, y, rad, dmg, skip) { for (const e of this.enemies) { if (e.dead || e === skip || e.warp > 0) continue; const dd = (e.x - x) ** 2 + (e.y - y) ** 2; if (dd > (rad + e.r) ** 2) continue; if (ETYPES[e.type].mp) { e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [wx, wy] = this.portPos(e, k); if ((wx - x) ** 2 + (wy - y) ** 2 < rad * rad) this.damageEnemy(e, k, dmg); }); } else this.damageEnemy(e, -1, dmg); } }
  damageEnemy(e, port, dmg) {
    if (e.dead) return;
    if (port >= 0) { const p = e.ports[port]; if (p.hp <= 0) return; p.hp -= dmg; this.ev('hit', round(e.x), round(e.y), e.id, port);
      if (p.hp <= 0) { p.hp = 0; const [wx, wy] = this.portPos(e, port); this.ev('pk', e.id, port, round(wx), round(wy)); this.dropCredits(wx, wy, 2); if (e.ports.every(q => q.hp <= 0)) this.killEnemy(e, 1); }
      return; }
    if (ETYPES[e.type].mp) return;
    e.hp -= dmg; this.ev('hit', round(e.x), round(e.y), e.id, -1); if (e.hp <= 0) this.killEnemy(e, 1);
  }
  dropCredits(x, y, v) { this.picks.push({ id: this.id(), k: 'cr', x, y, vx: rnd(-80, 80), vy: rnd(-80, 80), v, life: 14 }); }
  killEnemy(e, byPlayer) {
    if (e.dead) return; e.dead = 1; const T = ETYPES[e.type], dm = this.mission ? DIFFS[this.mission.diff].m : 1;
    this.ev('boom', round(e.x), round(e.y), T.mp ? 3 : e.r > 18 ? 2 : 1, round(e.r));
    if (!byPlayer) return;
    this.score += T.cr;
    const tot = T.cr * dm * (e.spot ? 2 : 1), chips = clamp(round(tot / 3), 1, 12);
    for (let k = 0; k < chips; k++) this.dropCredits(e.x + rnd(-e.r, e.r) * 0.5, e.y + rnd(-e.r, e.r) * 0.5, max(1, round(tot / chips)));
    if ((T.mp && random() < 0.4) || (e.type !== 10 && random() < 0.006 * dm)) this.picks.push({ id: this.id(), k: 'core', x: e.x, y: e.y, vx: rnd(-40, 40), vy: rnd(-40, 40), v: 1, life: 25 });
  }
  shieldCovers(ang, b) {
    const s = this.ship; if (s.down[SHIELD] || s.vent > 0 || s.en < 1) return 0;
    if (s.bubble > 0) return 2;
    const half = (55 + (this.has(SHIELD, 's_wide') ? 15 : 0) + 3 * this.inf(SHIELD, 'i_arc')) * PI / 180;
    const inArc = abs(wrap(ang - s.sa)) < min(PI, half) || ((this.big(SHIELD, 'b_dual') || this.hasPort(SHIELD, 'rear')) && abs(wrap(ang - s.sa - PI)) < half * 0.7);
    if (!inArc) return 0;
    const match = s.sm === 0 ? b.t === 0 : b.t !== 0;
    if (match) return 1;
    return this.has(SHIELD, 's_partial') && random() < 0.4 ? 1 : 0;
  }
  hitShip(x, y, hullDmg, stDmg, b) {
    const s = this.ship; if (s.dead || s.inv > 0) { if (s.inv > 0) this.ev('blk', round(x), round(y), 0); return; }
    if (this.has(PILOT, 'p_ace') && random() < 0.15) { this.ev('graze', round(x), round(y)); return; }
    s.hull -= hullDmg * (1 + 0.03 * ((this.mission ? this.mission.level : 1) - 1)) * max(0.5, 1 - 0.02 * this.inf(SHIELD, 'i_abs'));
    const rel = wrap(atan2(y - s.y, x - s.x) - s.a), st = this.stationAt(rel);
    if (s.aegis <= 0 && !s.down[st]) { s.st[st] -= stDmg; if (s.st[st] <= 0) { s.st[st] = this.has(REPAIR, 'r_emerg') ? this.stMax(st) * 0.25 : 0; s.down[st] = 1; this.ev('sd', st); } }
    this.ev('sh', round(x), round(y), st);
    if (s.hull <= 0) { s.hull = 0; s.dead = 1; s.deadT = 2.2; this.ev('boom', round(s.x), round(s.y), 3, 80); }
  }
  threats() {
    const s = this.ship, out = [];
    for (const b of this.eb) { if (b.dead || b.passed) continue; const rx = s.x - b.x, ry = s.y - b.y, sp = hypot(b.vx, b.vy) || 1, tti = (rx * b.vx + ry * b.vy) / (sp * sp); if (tti < 0 || tti > 2.2) continue; const cx = b.x + b.vx * tti - s.x, cy = b.y + b.vy * tti - s.y; if (cx * cx + cy * cy > (SR + 20) ** 2) continue; out.push({ b, tti, ang: wrap(atan2(b.y - s.y, b.x - s.x) - s.a) }); }
    return out.sort((a, b) => a.tti - b.tti);
  }
  // ----- bots -----
  botCtl(i) { const st = this.seats[i]; return !st.human || st.human.inp.idle; }
  botAb(i, slot, cond) { const ab = this.abilityOf(i, slot), st = this.seats[i]; if (ab && cond && (st.cd[ab] || 0) <= 0) st.bacts.push('qer'[slot]); }
  botThink() {
    const s = this.ship, M = this.mission; if (!M || s.dead) return;
    const live = this.enemies.filter(e => !e.dead && e.warp <= 0 && e.type !== 10), th = this.threats();
    const near = (p, r) => live.filter(e => d2(e, p) < r * r);
    const los = (e, x, y) => { const dx = x - s.x, dy = y - s.y, d = hypot(dx, dy); for (let t = 12; t < d - 22; t += 12) if (this.inHull(e, s.x + dx / d * t, s.y + dy / d * t)) return false; return true; };
    const aimPt = e => { if (!ETYPES[e.type].mp) return [e.x + e.vx * 0.25, e.y + e.vy * 0.25]; let best = null, bd = 1e18; e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [x, y] = this.portPos(e, k), q = ((x - s.x) ** 2 + (y - s.y) ** 2) * (los(e, x, y) ? 1 : 9); if (q < bd) { bd = q; best = [x, y]; } }); return best || [e.x, e.y]; };
    const nearest = (pred) => { let b = null, bd = 1e18; for (const e of live) { if (pred && !pred(e)) continue; const q = d2(e, s); if (q < bd) { bd = q; b = e; } } return b; };
    const B = i => { const st = this.seats[i]; st.bi.idle = 0; return st.bi; };
    const ctl = i => this.botCtl(i);
    // down stations self-patch; idle healthy bots assist the repair bay when it is out
    for (let i = 0; i < 6; i++) if (ctl(i)) { const b = B(i); b.as = 0; b.f = s.down[i] ? 1 : 0; }
    // pilot: objective-driven helm
    if (ctl(PILOT)) {
      const b = B(PILOT); let goal = null;
      if (M.type === 'hostages') { let bd = 1e18; for (const a of this.allies) if (a.k === 'pod') { const q = d2(a, s); if (q < bd) { bd = q; goal = a; } } }
      if (M.type === 'escort') { const f = this.allies.find(a => a.k === 'fr'); if (f && d2(f, s) > 450 * 450) goal = f; }
      if (M.type === 'defend') { const f = this.allies.find(a => a.k === 'fs'); if (f && d2(f, s) > 600 * 600) goal = f; }
      const tgt = nearest(e => !ETYPES[e.type].mp || M.type !== 'escort') || nearest();
      if (!goal && tgt) {
        if (ETYPES[tgt.type].mp) { // stand off from capital ships: circle outside flak range and let the turrets work
          let pk = -1, pd = 1e18; tgt.ports.forEach((p, k) => { if (p.hp <= 0) return; const [x, y] = this.portPos(tgt, k), q = (x - s.x) ** 2 + (y - s.y) ** 2; if (q < pd) { pd = q; pk = k; } });
          if (pk >= 0) { const [px, py] = this.portPos(tgt, pk), ox = px - tgt.x, oy = py - tgt.y, ol = hypot(ox, oy) || 1, a = atan2(oy, ox) + 0.35 * tgt.orbit; goal = { x: px + cos(a) * 380, y: py + sin(a) * 380 }; }
          else goal = { x: tgt.x, y: tgt.y };
        } else { const [x, y] = aimPt(tgt); goal = { x, y }; }
      }
      if (!goal) { const pk = this.picks[0]; goal = pk || { x: 0, y: 0 }; }
      b.ax = goal.x; b.ay = goal.y;
      b.f = s.down[PILOT] ? 1 : (tgt && abs(wrap(atan2(tgt.y - s.y, tgt.x - s.x) - s.a)) < 0.25 && d2(tgt, s) < 900 * 900 ? 1 : 0);
      this.botAb(PILOT, 0, th.length >= 3 && th[0].tti < 0.5);
      this.botAb(PILOT, 1, near(s, 700).length >= 2);
      this.botAb(PILOT, 2, near(s, 900).length >= 4);
    }
    // gunners
    for (const [gi, side] of [[GUNL, -1], [GUNR, 1]]) {
      if (!ctl(gi) || s.down[gi]) continue; const b = B(gi);
      const center = side * 80 * PI / 180, other = gi === GUNL ? GUNR : GUNL, half = s.down[other] ? PI : 110 * PI / 180;
      const missile = th.find(t => t.b.t !== 0 && abs(wrap(t.ang - center)) < half);
      let tgt = null, bd = 1e18;
      for (const e of live) { const ang = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); if (abs(wrap(ang - center)) > half) continue; const q = d2(e, s) * (e.paint > 0 ? 0.5 : 1) * (ETYPES[e.type].mp ? 1.5 : 1); if (q < bd) { bd = q; tgt = e; } }
      if (missile && this.has(gi, 'g_pd')) { b.ax = missile.b.x; b.ay = missile.b.y; b.f = 1; }
      else if (tgt) { const [x, y] = aimPt(tgt), d = sqrt(d2(tgt, s)), lead = d / 1300; b.ax = x + (tgt.vx || 0) * lead; b.ay = y + (tgt.vy || 0) * lead; b.f = d < 820 ? 1 : 0; }
      else { b.f = 0; if (s.down[REPAIR] && !s.down[gi]) b.as = 1; }
      this.botAb(gi, 0, tgt && d2(tgt, s) < 700 * 700);
      this.botAb(gi, 1, th.length >= 3 || near(s, 220).length >= 2);
      this.botAb(gi, 2, tgt && (ETYPES[tgt.type].mp || near(s, 800).length >= 3));
    }
    // shield: face the most imminent threat with the right mode
    if (ctl(SHIELD) && !s.down[SHIELD]) {
      const b = B(SHIELD), t0 = th[0];
      if (t0) { const a = s.a + t0.ang; b.ax = s.x + cos(a) * 300; b.ay = s.y + sin(a) * 300; const m = t0.b.t ? 1 : 0; if (m !== s.sm && !this.has(SHIELD, 's_smart') && this.t - (this.lastFlip || 0) > 0.3) { this.seats[SHIELD].bacts.push('alt'); this.lastFlip = this.t; } }
      else { const e = nearest(); if (e) { b.ax = e.x; b.ay = e.y; } }
      this.botAb(SHIELD, 0, th.length >= 4);
      this.botAb(SHIELD, 1, s.en < 25 && th.length === 0);
      this.botAb(SHIELD, 2, th.length >= 3 && s.hull < s.hm * 0.6 || s.down.filter(x => x).length >= 2);
    }
    // engineer: throttle, power routing, buffs, bombs
    if (ctl(ENG) && !s.down[ENG]) {
      const b = B(ENG), n = near(s, 800).length, seat = this.seats[ENG];
      let travel = M.type === 'hostages' || M.type === 'escort' || n === 0;
      b.thr = travel ? 1 : 0.7;
      const want = s.down[SHIELD] || th.length >= 4 ? [1, 1, 4] : n >= 3 ? [1, 4, 1] : travel ? [4, 1, 1] : [2, 2, 2];
      if (this.t - (this.lastPip || 0) > 0.6) { for (let k = 0; k < 3; k++) if (s.pip[k] < want[k]) { seat.bacts.push('p' + (k + 1)); this.lastPip = this.t; break; } }
      const sideCount = sd => live.filter(e => { const a = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); return sd > 0 ? a > 0 : a < 0; }).length;
      const rs = sideCount(1) >= sideCount(-1) ? 1 : -1, ra = s.a + rs * PI / 2;
      const cl = nearest();
      if (cl && n >= 2 && this.abilityOf(ENG, 2) && (seat.cd.bomb || 0) <= 0) { b.ax = cl.x; b.ay = cl.y; seat.bacts.push('r'); }
      else { b.ax = s.x + cos(ra) * 200; b.ay = s.y + sin(ra) * 200; this.botAb(ENG, 0, n >= 2 && !s.down[rs > 0 ? GUNR : GUNL]); }
      this.botAb(ENG, 1, (travel && n === 0 && M.type !== 'defend') || (th.length >= 3 && s.hull < s.hm * 0.5));
    }
    // repair: hit the calibration band, steer the drones, use kit abilities
    if (ctl(REPAIR) && !s.down[REPAIR]) {
      const b = B(REPAIR); b.rt = -1;
      b.f = s.task.i >= 0 && this.needleIn(this.t - 0.15) && this.needleIn(this.t - 0.25) ? 1 : 0;
      const e = nearest(); if (e) { b.ax = e.x; b.ay = e.y; } else if (this.picks.length) { b.ax = this.picks[0].x; b.ay = this.picks[0].y; }
      this.botAb(REPAIR, 0, s.down.some(x => x) && s.task.i >= 0 && s.task.i < 6);
      this.botAb(REPAIR, 1, s.drones.some(d => d.on) && near(s, 600).length >= 2);
      if (this.abilityOf(REPAIR, 2) && (this.seats[REPAIR].cd.stim || 0) <= 0 && near(s, 800).length >= 2) { const gi = s.down[GUNR] ? GUNL : GUNR, a = s.a + (gi === GUNR ? PI / 3 : -PI / 3); const sv = [b.ax, b.ay]; b.ax = s.x + cos(a) * 200; b.ay = s.y + sin(a) * 200; this.seats[REPAIR].bacts.push('r'); }
    }
  }
  // ----- net -----
  seatOf(c) { return this.seats.find(s => s.human === c); }
  addClient(c, pref) {
    let seat = null;
    if (pref >= 0 && pref < 6 && !this.seats[pref].human) seat = this.seats[pref];
    if (!seat) for (const i of JOIN_ORDER) if (!this.seats[i].human) { seat = this.seats[i]; break; }
    if (!seat) return false;
    seat.human = c; c.inp = Object.assign(blankInput(), { ax: this.ship.x, ay: this.ship.y - 300 }); c.acts = []; c.room = this;
    this.clients.add(c);
    if (c.prof.earned < this.crewEarned) { c.prof.cr += this.crewEarned - c.prof.earned; c.prof.earned = this.crewEarned; }
    c.dirty = 1; this.ev('join', c.prof.name, seat.idx); return true;
  }
  removeClient(c) {
    const seat = this.seatOf(c); if (seat) { seat.human = null; seat.bi = blankInput(); this.ev('leave', c.prof.name, seat.idx); }
    this.clients.delete(c); this.votes.delete(c.pid); this.ready.delete(c.pid);
    if (!this.clients.size) this.emptySince = Date.now();
  }
  switchRole(c, idx) {
    const cur = this.seatOf(c), tgt = this.seats[idx]; if (!cur || !tgt || tgt === cur) return;
    if (tgt.human) { sendTo(c, { t: 'toast', m: tgt.human.prof.name + ' is already on that station' }); return; }
    cur.human = null; cur.bi = blankInput(); tgt.human = c; c.dirty = 1; this.ev('swap', c.prof.name, idx);
  }
  snapshot() {
    const s = this.ship, r1 = v => round(v * 10) / 10, r2 = v => round(v * 100) / 100, M = this.mission;
    const o = { t: 's', ph: this.phase, pt: r1(max(0, this.phaseT)), T: r2(this.t), mk: this.mk, co: this.cores, md: this.mainDone, sc: this.score, ce: this.crewEarned };
    o.sh = { x: round(s.x), y: round(s.y), a: r2(s.a), vx: round(s.vx), vy: round(s.vy), h: r1(s.hull), hm: s.hm, st: s.st.map(r2), mx: [0, 1, 2, 3, 4, 5].map(i => this.stMax(i)), dn: s.down, en: round(s.en), em: s.em, sa: r2(s.sa), sm: s.sm, tl: r2(s.tl), tr: r2(s.tr), thr: r2(s.thr), spd: round(s.spd),
      burn: s.burn > 0 ? 1 : 0, dr: s.drones.map(d => d.on ? [round(d.x), round(d.y)] : 0), sd: s.sdr.on ? [round(s.sdr.x), round(s.sdr.y)] : 0, tk: [s.task.i, r2(s.task.bc), r2(s.task.bw), s.task.i >= 0 && s.task.i < 6 ? r2(s.st[s.task.i] / this.stMax(s.task.i)) : r2(s.hull / s.hm)],
      vent: s.vent > 0 ? 1 : 0, bub: s.bubble > 0 ? 1 : 0, aeg: s.aegis > 0 ? 1 : 0, inv: s.inv > 0 ? 1 : 0, roll: r2(s.roll || 0), dead: s.dead, pip: s.pip, bm: s.beam, rr: s.reroute > 0 ? 1 : 0, rear: this.big(SHIELD, 'b_dual') || this.hasPort(SHIELD, 'rear') ? 1 : 0,
      arc: round(55 + (this.has(SHIELD, 's_wide') ? 15 : 0) + 3 * this.inf(SHIELD, 'i_arc')) };
    o.e = this.enemies.map(e => { const a = [e.id, e.type, round(e.x), round(e.y), r2(e.a), ETYPES[e.type].mp ? 1 : r2(max(0, e.hp / e.mhp)), e.warp > 0 ? 1 : 0, e.paint > 0 ? 1 : 0]; if (e.ports) a.push(e.ports.map(p => [r2(p.hp / p.mhp), r2(p.pa), p.ch > 0 ? 1 : 0])); if (e.type === 10) a[5] = round(e.r); return a; });
    o.eb = this.eb.map(b => [b.id, round(b.x), round(b.y), r2(atan2(b.vy, b.vx)), b.t, b.hv ? 1 : 0]);
    o.pp = this.pp.map(p => [p.id, round(p.x), round(p.y), r2(atan2(p.vy, p.vx)), p.k === 'rk' ? 0 : 1]);
    o.al = this.allies.map(a => [a.id, a.k, round(a.x), round(a.y), r2(a.a), r2(max(0, a.hp / a.mhp)), r2(a.resc || 0)]);
    o.pk = this.picks.map(p => [p.id, round(p.x), round(p.y), p.k === 'core' ? 1 : 0]);
    o.mn = this.mines.map(m => [round(m.x), round(m.y)]);
    o.bo = this.bombs.map(b => [round(b.x), round(b.y)]);
    o.crew = this.seats.map(st => [st.human ? st.human.prof.name : st.botName, st.human ? 0 : 1, st.human ? st.human.pid : 0, st.cur.as && !s.down[st.idx] ? 1 : 0, st.human && st.human.inp.idle ? 1 : 0,
      [0, 1, 2].map(k => { const ab = this.abilityOf(st.idx, k); return ab ? [ab, r1(max(0, st.cd[ab] || 0)), r1(st.cdm[ab] || ABIL[ab].cd)] : 0; }), Object.keys(st.bf).filter(k => st.bf[k] > 0), this.ports(st.idx)]);
    if (M) o.mi = { name: M.name, type: M.type, lv: M.level, diff: M.diff, kind: M.kind, planet: M.planet, wave: M.wave, waves: M.waves, got: M.got, need: M.need, lost: M.lost, pods: M.pods, jx: M.jx, jy: M.jy, left: this.hostiles(), fac: M.fac, mod: M.mod };
    if (this.phase === 'map') { const hum = this.humans(), w = {}; for (const c of this.clients) { const v = this.votes.get(c.pid); if (!v) continue; const seat = this.seatOf(c); w[v] = (w[v] || 0) + (seat && seat.idx === PILOT ? max(1, hum - 1) : 1); } o.opts = this.options; o.votes = w; o.pw = max(1, hum - 1); o.my = {}; }
    if (this.phase === 'result' || this.phase === 'upgrade') o.res = this.result;
    if (this.phase === 'upgrade') o.rdy = [...this.ready];
    o.ev = this.events; return o;
  }
  broadcast() {
    if (!this.clients.size) { this.events = []; return; }
    const snap = this.snapshot(), base = JSON.stringify(snap);
    for (const c of this.clients) {
      if (c.dirty) { c.dirty = 0; sendMe(c); }
      if (c.ws.readyState !== 1) continue;
      if (this.phase === 'map') { const v = this.votes.get(c.pid); c.ws.send(v ? base.replace('"my":{}', '"my":' + JSON.stringify(v)) : base); }
      else c.ws.send(base);
    }
    this.events = [];
  }
}

function sendTo(c, o) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); }
function sendMe(c) { const r = c.room, seat = r && r.seatOf(c); sendTo(c, { t: 'me', pid: c.pid, cid: c.cid, role: seat ? seat.idx : -1, cr: c.prof.cr, tr: c.prof.t, name: c.prof.name, code: r ? r.code : '', pub: r && r.pub ? 1 : 0 }); }
function getRoom(code) {
  if (code) { code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (code && code !== 'PUBLIC') { let r = rooms.get(code); if (!r) { r = new Room(code, false); rooms.set(code, r); } return r; } }
  for (const r of rooms.values()) if (r.pub && r.humans() < 6) return r;
  const r = new Room(rooms.has('PUBLIC') ? newCode() : 'PUBLIC', true); rooms.set(r.code, r); return r;
}
const ACTS = new Set(['q', 'e', 'r', 'alt', 'p1', 'p2', 'p3', 'p4']);
function onMessage(c, m) {
  if (m.t === 'join' && !c.room) {
    const name = String(m.name || '').replace(/[^\w \-\.!?]/g, '').trim().slice(0, 14) || ('Cadet' + (100 + floor(random() * 900)));
    [c.cid, c.prof] = getProfile(m.cid, name);
    let r = getRoom(m.room);
    if (!r.addClient(c, +m.role)) { if (!r.pub) sendTo(c, { t: 'toast', m: 'Ship ' + r.code + ' is full (6 crew) - joining the public ship' }); r = getRoom(''); r.addClient(c, +m.role); }
    return sendMe(c);
  }
  const R = c.room; if (!R) return;
  if (m.t === 'i') {
    const I = c.inp, n = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
    I.ax = clamp(n(m.ax), -9999, 9999); I.ay = clamp(n(m.ay), -9999, 9999); I.f = m.f ? 1 : 0; I.as = m.as ? 1 : 0;
    I.thr = clamp(n(m.thr) || 0.65, 0.25, 1); I.idle = m.idle ? 1 : 0; I.rt = Number.isInteger(m.rt) ? clamp(m.rt, -1, 6) : -1;
    if (Array.isArray(m.a)) for (const a of m.a.slice(0, 6)) if (ACTS.has(a) && c.acts.length < 12) c.acts.push(a);
  } else if (m.t === 'role') R.switchRole(c, m.role | 0);
  else if (m.t === 'buy') {
    if (R.phase === 'mission') return sendTo(c, { t: 'toast', m: 'Upgrades are bought between missions' });
    const seat = R.seatOf(c), tk = TREES[m.tree] ? m.tree : TREE_OF[seat ? seat.idx : 0];
    const err = buy(c.prof, tk, String(m.kind), String(m.id), m.slot | 0, R.mk); if (err) sendTo(c, { t: 'toast', m: err }); c.dirty = 1;
  } else if (m.t === 'mk') { if (R.phase !== 'mission') { if (!R.buyMk()) sendTo(c, { t: 'toast', m: 'Not enough crew cores' }); } }
  else if (m.t === 'ready' && R.phase === 'upgrade') { if (m.v === 0) R.ready.delete(c.pid); else R.ready.add(c.pid); }
  else if (m.t === 'vote' && R.phase === 'map') { if (R.options.some(o => o.id === m.id)) R.votes.set(c.pid, m.id); }
  else if (m.t === 'name') { c.prof.name = String(m.name || '').replace(/[^\w \-\.!?]/g, '').trim().slice(0, 14) || c.prof.name; c.dirty = 1; }
  else if (m.t === 'ping') sendTo(c, { t: 'pong', ts: m.ts });
}
rooms.set('PUBLIC', new Room('PUBLIC', true));

function tickAll() { for (const r of rooms.values()) { try { r.step(); } catch (e) { console.error('room', r.code, e); } } }
function start() {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: 1, v: 2, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0), uptime: process.uptime() | 0 })); }
    if (u === '/rooms') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...rooms.values()].map(r => ({ code: r.code, pub: r.pub, humans: r.humans(), phase: r.phase, mission: r.mission && r.mission.name, type: r.mission && r.mission.type, mainDone: r.mainDone, mk: r.mk, score: r.score })))); }
    if (u === '/new') { res.writeHead(302, { location: '/?room=' + newCode() }); return res.end(); }
    let f = files[u]; if (!f && /^\/r\/[A-Za-z0-9]+$/.test(u)) f = files['/'];
    if (!f) { res.writeHead(404); return res.end('not found'); }
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304); return res.end(); }
    const gz = /gzip/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-cache', etag: f.etag, ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gz ? f.gz : f.raw);
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 3 } } });
  let pidc = 1;
  wss.on('connection', ws => {
    const c = { ws, pid: pidc++, room: null, inp: blankInput(), acts: [], prof: null, dirty: 0, alive: 1 };
    ws.on('pong', () => c.alive = 1);
    ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (e) { return; } try { onMessage(c, m); } catch (e) { console.error('msg', e); } });
    ws.on('close', () => { if (c.room) c.room.removeClient(c); });
    ws.on('error', () => { });
  });
  setInterval(() => { for (const ws of wss.clients) { if (ws._dead) { ws.terminate(); continue; } ws._dead = 1; ws.ping(); } }, 30000);
  wss.on('connection', ws => ws.on('pong', () => ws._dead = 0));
  let last = process.hrtime.bigint(), acc = 0;
  setInterval(() => {
    const now = process.hrtime.bigint(); acc += Number(now - last) / 1e9; last = now; if (acc > 0.25) acc = 0.25;
    while (acc >= DT) { acc -= DT; tickAll(); }
    for (const [code, r] of rooms) if (code !== 'PUBLIC' && !r.clients.size && Date.now() - r.emptySince > (r.pub ? 60e3 : 15 * 60e3)) rooms.delete(code);
  }, 1000 / 60);
  if (process.env.WATCH) fs.watch(PUB, () => { try { loadFiles(); } catch (e) { } });
  server.listen(PORT, () => console.log('Team Space Ship v2 on :' + PORT));
}
if (require.main === module) start();
module.exports = { Room, buy, botSpend, rooms };
