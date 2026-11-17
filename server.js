'use strict';
// Team Space Ship v3: server-authoritative co-op. Node + ws.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./public/defs.js');
const { ROLES, TREE_OF, TREES, ABIL, INNATE, NODE_COST, infCost, PORT_COST, portUpCost, PORT_MAX_LV, ETYPES, WEAP, DIFFS, MTYPES, MK_COST, CORE_RATE, BOT_PORTS, BOT_PATH, GEO, secIdx, pyrAllowed, treeStats, infCap, SHIELD_ARC0, SHIELD_ARC_MAX, SHIELD_DOWN } = D;
const PORT = +process.env.PORT || 8080;
const DEV = process.env.DEV_TOOLS === '1'; // test-only hooks (screenshots); never set in production
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
const TICK = 30, DT = 1 / TICK, SEND_EVERY = 2, ARENA = 3200;
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5;
const JOIN_ORDER = [PILOT, GUNL, GUNR, SHIELD, ENG, REPAIR];
const NSEC = 18, HULL_T = 18; // 6 stations + 12 extra-port sections; repair target 18 = hull
const BOLT_SPD = 800, NOSE_LIFE = 0.75, GUN_LIFE = 0.8;
const { sin, cos, atan2, hypot, min, max, abs, PI, random, floor, round, sqrt, ceil } = Math;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrap = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const rnd = (a, b) => a + random() * (b - a);
const pick = arr => arr[floor(random() * arr.length)];
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const segD2 = (x1, y1, x2, y2, px, py) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1, t = clamp(((px - x1) * dx + (py - y1) * dy) / L, 0, 1); return (x1 + dx * t - px) ** 2 + (y1 + dy * t - py) ** 2; };
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[floor(random() * CODE_CH.length)]; } while (rooms.has(c)); return c; }
const blankInput = () => ({ ax: 0, ay: -300, f: 0, as: 0, thr: 0.7, rt: -1, idle: 0 });
function fixProf(p) { p.t = p.t || {}; for (const k in TREES) { const x = p.t[k] = p.t[k] || {}; x.path = Array.isArray(x.path) ? x.path : []; x.i = x.i || {}; x.b = x.b || {}; } p.cr = p.cr || 0; p.earned = p.earned || 0; return p; }
function planetName() { return pick(D.PLANET_A) + pick(D.PLANET_B) + pick(D.PLANET_C); }
const secRole = k => k < 6 ? k : (k - 6) >> 1, secSlot = k => k < 6 ? -1 : (k - 6) & 1;

// ---------- profiles ----------
const PROF_FILE = path.join(DATA, 'profiles3.json');
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROF_FILE, 'utf8')); } catch (e) { }
function getProfile(cid, name) {
  if (!cid || typeof cid !== 'string' || cid.length > 64) cid = crypto.randomBytes(8).toString('hex');
  let p = profiles[cid]; if (!p) p = profiles[cid] = { name: name || 'Cadet' };
  fixProf(p); if (name) p.name = name; return [cid, p];
}
setInterval(() => { try { fs.writeFileSync(PROF_FILE, JSON.stringify(profiles)); } catch (e) { } }, 30000).unref();

// personal purchases (skill pyramid, infinite, big). Ports live on the ship (Room.buyPort).
function buy(prof, treeKey, kind, id, mk) {
  const T = TREES[treeKey], P = prof.t[treeKey]; if (!T || !P) return 'bad tree';
  if (kind === 'node') {
    const r = P.path.length; if (r >= 5) return 'pyramid complete';
    const i = T.rows[r].findIndex(n => n.id === id); if (i < 0) return T.rows.some(row => row.some(n => n.id === id)) ? 'pick one node per row, top to bottom' : 'bad node';
    if (!pyrAllowed(P.path, r).includes(i)) return 'only nodes adjacent to your previous pick are allowed';
    if (prof.cr < NODE_COST[r]) return 'not enough credits'; prof.cr -= NODE_COST[r]; P.path.push(i); return null;
  }
  if (kind === 'inf') { const x = T.inf.find(x => x[0] === id); if (!x) return 'bad'; const lv = P.i[id] || 0; if (infCap(treeKey, id, lv)) return 'maxed (shield arc is capped at ' + SHIELD_ARC_MAX + '°)'; const c = infCost(lv); if (prof.cr < c) return 'not enough credits'; prof.cr -= c; P.i[id] = lv + 1; return null; }
  if (kind === 'big') { const b = T.big.find(x => x[0] === id); if (!b) return 'bad'; if (P.b[id]) return 'owned'; if (b[4] > mk) return 'needs a ship upgrade'; if (prof.cr < b[3]) return 'not enough credits'; prof.cr -= b[3]; P.b[id] = 1; return null; }
  return 'bad';
}
function botSpend(room, prof, i) {
  const tk = TREE_OF[i], T = TREES[tk], P = prof.t[tk], mk = room.mk;
  for (let guard = 0; guard < 80; guard++) {
    const r = P.path.length;
    if (r < 5) { // pyramid first: follow the bot's preferred path, nearest allowed node
      const al = pyrAllowed(P.path, r), want = BOT_PATH[tk][r]; let best = al[0]; for (const a of al) if (abs(a - want) < abs(best - want)) best = a;
      if (prof.cr < NODE_COST[r]) return; buy(prof, tk, 'node', T.rows[r][best].id, mk); continue;
    }
    let ps = -1; for (let sl = 0; sl < mk && sl < 2; sl++) if (!room.ports[i][sl]) { ps = sl; break; }
    if (ps >= 0) { if (prof.cr < PORT_COST[ps]) return; room.buyPort(prof, i, ps, BOT_PORTS[i][ps]); continue; }
    const bg = T.big.find(b => !P.b[b[0]] && b[4] <= mk);
    if (bg && prof.cr >= bg[3]) { buy(prof, tk, 'big', bg[0], mk); continue; }
    let opt = null, oc = 1e9;
    for (const x of T.inf) { const lv = P.i[x[0]] || 0; if (infCap(tk, x[0], lv)) continue; const c = infCost(lv); if (c < oc) { oc = c; opt = ['inf', x[0]]; } }
    room.ports[i].forEach((p, sl) => { if (p && sl < mk && p.lv < PORT_MAX_LV) { const c = portUpCost(p.lv); if (c < oc) { oc = c; opt = ['pup', sl]; } } });
    if (!opt || prof.cr - oc < (bg ? bg[3] * 0.5 : 0)) return;
    if (opt[0] === 'inf') buy(prof, tk, 'inf', opt[1], mk); else room.upPort(prof, i, opt[1]);
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
    this.mk = 0; this.cores = 0; this.ports = ROLES.map(() => [null, null]);
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.waves = []; this.events = [];
    this.phase = 'map'; this.phaseT = 3; this.mission = null; this.votes = new Map(); this.ready = new Set(); this.result = null; this.emptySince = Date.now();
    this.calcStats(); this.makeOptions(); this.resetShip();
  }
  id() { return this.idc++; }
  humans() { return this.seats.filter(s => s.human).length; }
  occ(i) { const s = this.seats[i]; return s.human ? s.human.prof : s.bot; }
  T(i) { return this.occ(i).t[TREE_OF[i]]; }
  calcStats() { this.ST = this.seats.map(s => treeStats(TREE_OF[s.idx], this.T(s.idx))); }
  S(i, k) { return this.ST[i][k] || 0; }
  inf(i, id) { return this.T(i).i[id] || 0; }
  big(i, id) { return !!this.T(i).b[id]; }
  bf(i, k) { return (this.seats[i].bf[k] || 0) > 0; }
  // ----- ship sections & ports -----
  geo() { return GEO[this.mk]; }
  secExists(k) { if (k < 6) return true; const r = secRole(k), sl = secSlot(k); return sl < this.mk && !!this.ports[r][sl]; }
  secMax(k) { const ph = this.S(REPAIR, 'portHp'); if (k < 6) return 3 + (this.big(k, 'b_armor') ? 1 : 0) + ph; const p = this.ports[secRole(k)][secSlot(k)]; return 3 + 0.4 * (p ? p.lv : 0) + ph; }
  secPos(k) { const g = this.geo(); return k < 6 ? g.st[k] : (g.po[secRole(k)][secSlot(k)] || g.st[secRole(k)]); }
  secWorld(k) { const s = this.ship, [lx, ly] = this.secPos(k), c = cos(s.a), sn = sin(s.a); return [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c]; }
  activePorts(role) { const o = []; for (let sl = 0; sl < 2; sl++) { const k = secIdx(role, sl); if (this.secExists(k) && !this.ship.sec[k].dn) o.push({ k, sl, id: this.ports[role][sl].id, lv: this.ports[role][sl].lv, f: 1 + 0.12 * this.ports[role][sl].lv }); } return o; }
  portEff(role, id) { let f = 0; for (const p of this.activePorts(role)) if (p.id === id) f += p.f; return f; }
  buyPort(prof, role, slot, id) {
    if (!(slot === 0 || slot === 1) || slot >= this.mk) return 'needs a ship upgrade';
    if (this.ports[role][slot]) return 'that port is already installed (port choices are permanent)';
    if (!TREES[TREE_OF[role]].ports.some(x => x[0] === id)) return 'bad port';
    if (prof.cr < PORT_COST[slot]) return 'not enough credits'; prof.cr -= PORT_COST[slot];
    this.ports[role][slot] = { id, lv: 0 }; const k = secIdx(role, slot); this.ship.sec[k] = { hp: this.secMax(k), dn: 0 }; this.ev('port', role, slot, id); return null;
  }
  upPort(prof, role, slot) {
    const p = this.ports[role][slot]; if (!p || slot >= this.mk) return 'no port installed there'; if (p.lv >= PORT_MAX_LV) return 'port fully upgraded';
    const c = portUpCost(p.lv); if (prof.cr < c) return 'not enough credits'; prof.cr -= c; p.lv++; const k = secIdx(role, slot); this.ship.sec[k].hp = this.secMax(k); return null;
  }
  convertCore() { if (this.mk < 2) return 'core conversion unlocks with the Mk III ship'; if (this.cores < 1) return 'no crew cores'; this.cores--; this.grant(CORE_RATE); this.ev('cv'); return null; }
  pipF(k) { return 1 + (this.ship.pip[k] - 2) * 0.15 * (1 + this.S(ENG, 'pipEff')); }
  ev(...a) { this.events.push(a); }
  grant(v) { // credits are equal for every crew member
    v = round(v); if (v <= 0) return; this.crewEarned += v;
    for (const s of this.seats) { s.bot.cr += v; s.bot.earned += v; }
    for (const c of this.clients) { c.prof.cr += v; c.prof.earned = max(c.prof.earned + v, this.crewEarned); c.dirty = 1; }
  }
  shieldMax() { return 4 + this.S(SHIELD, 'shHp') + 3 * this.portEff(SHIELD, 'capbank'); }
  shieldArc() { return min(SHIELD_ARC_MAX, SHIELD_ARC0 + this.S(SHIELD, 'shArc')); }
  resetShip() {
    this.calcStats();
    const hm = 40 + 12 * this.mk + this.S(PILOT, "hull"), sec = [];
    this.ship = { x: 0, y: 0, a: -PI / 2, vx: 0, vy: -80, spd: 80, thr: 0.7, hull: hm, hm, sec, en: 70, em: 100, sa: -PI / 2, shp: 3, shm: 3, shDown: 0, shHit: 9, fort: 0,
      tl: -80 * PI / 180, tr: 80 * PI / 180, beam: {}, pang: {}, drones: [], sdr: { a: 0, hp: 4, cd: 0 }, task: { i: -1, bc: 0, bw: 0.3 }, inv: 0, bubble: 0, aegis: 0, rally: 0, burn: 0, reroute: 0, dod: 0, strafe: 0, swarm: 0,
      nose: 0, noseN: 0, scat: 0, gl: 0, gr: 0, gp: {}, mineT: 3.5, dead: 0, pip: [2, 2, 2], roll: 0 };
    for (let k = 0; k < NSEC; k++) sec.push({ hp: 0, dn: 0 });
    for (let k = 0; k < NSEC; k++) if (this.secExists(k)) sec[k].hp = this.secMax(k);
    this.ship.shm = this.ship.shp = this.shieldMax();
    for (const s of this.seats) { s.cd = {}; s.cdm = {}; s.bf = {}; s.dead = 0; s.barr = 0; }
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
    const M = this.mission = Object.assign({}, m, { wave: 0, waveT: 1.5, got: 0, need: 0, lost: 0, time: 0, bossSpawned: 0, trickle: 8, waves: 0 });
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.waves = [];
    this.resetShip(); this.phase = 'mission';
    const L = M.level;
    M.fac = M.type === 'pirates' || M.type === 'hostages' || (random() < 0.3 && M.type !== 'flagship') ? 'pir' : 'dom';
    if (M.type === 'pirates') M.waves = min(5, 2 + floor(L / 3));
    if (M.type === 'flagship') M.waves = 2;
    if (M.type === 'defend') { M.waves = min(6, 3 + floor(L / 3)); this.allies.push({ id: this.id(), k: 'fs', x: 0, y: 0, a: 0, hp: 90 + 22 * L, mhp: 90 + 22 * L, r: 90 }); this.ship.y = 260; }
    if (M.type === 'escort') {
      const a = random() * 2 * PI; M.jx = cos(a) * 2300; M.jy = sin(a) * 2300;
      for (let k = 0; k < 3; k++) this.allies.push({ id: this.id(), k: 'fr', x: -cos(a) * 300 + (k - 1) * -sin(a) * 140, y: -sin(a) * 300 + (k - 1) * cos(a) * 140, a, hp: 34 + 5 * L, mhp: 34 + 5 * L, r: 34, spd: 48 });
    }
    if (M.type === 'hostages') {
      M.pods = 4; M.need = 3;
      for (let k = 0; k < 4; k++) { const a = k * PI / 2 + rnd(-0.5, 0.5), d = rnd(500, 1200); const p = { id: this.id(), k: 'pod', x: cos(a) * d, y: sin(a) * d, a: 0, hp: 8, mhp: 8, r: 16, resc: 0 }; this.allies.push(p); for (let g = 0; g < 1 + floor(L / 3); g++) this.addEnemy(L >= 3 ? 4 : 0, p.x + rnd(-150, 150), p.y + rnd(-150, 150), L, 'pir'); }
    }
    if (M.type === 'station') { M.trickle = 24; const a = random() * 2 * PI; this.addEnemy(9, cos(a) * 1400, sin(a) * 1400, L, M.fac, true); M.bossSpawned = 1; this.spawnWave(L, 0, M.fac); }
    if (M.mod === 'asteroids') for (let i = 0; i < 14; i++) { const a = random() * 2 * PI, d = rnd(450, 2600); this.addEnemy(10, cos(a) * d, sin(a) * d, L, 'dom', true); }
    this.ev('ms', M.name, M.type);
  }
  endMission(win) {
    const M = this.mission, dm = DIFFS[M.diff].m;
    let bonus = 0, cores = 0;
    if (win) {
      bonus = round((15 + 5 * M.level) * dm); cores = (M.kind === 'main' ? 1 : 0) + (M.diff >= 2 ? 1 : 0);
      if (M.kind === 'main') this.mainDone = max(this.mainDone, M.level); this.failStreak = 0;
      this.grant(bonus); this.cores += cores;
    } else if (M.kind === 'main') this.failStreak++;
    this.result = { win: win ? 1 : 0, bonus, cores, name: M.name, type: M.type };
    this.phase = 'result'; this.phaseT = 2.8; this.ev(win ? 'win' : 'lose');
    this.makeOptions();
  }
  // ----- enemies -----
  addEnemy(type, x, y, L, fac, instant) {
    const T = ETYPES[type], hpm = 1 + 0.2 * (L - 1) + 0.01 * (L - 1) * (L - 1);
    const e = { id: this.id(), type, x: clamp(x, -ARENA + 80, ARENA - 80), y: clamp(y, -ARENA + 80, ARENA - 80), vx: 0, vy: 0, a: random() * 2 * PI, hp: T.hp * hpm, mhp: T.hp * hpm, r: T.r, L, fac: fac || 'dom',
      cd: rnd(0.6, 2.2), warp: instant ? 0 : 0.8, orbit: random() < 0.5 ? 1 : -1, paint: 0, spot: 0, tgt: null, tgtT: 0, sh: 0, shm: 0, shT: 9 };
    if (T.sh) e.sh = e.shm = T.sh * (1 + 0.12 * (L - 1)) * (T.sz >= 3 && L < 8 ? 0.6 : 1);
    if (type === 10) { e.r = rnd(26, 46); e.vx = rnd(-25, 25); e.vy = rnd(-25, 25); e.spin = rnd(-1, 1); }
    if (T.mp) {
      e.cdm = T.sz >= 2 ? (L < 6 ? 2.2 : L < 10 ? 1.5 : L < 14 ? 1.2 : 1) : 1;
      const ph = T.php * (1 + 0.2 * (L - 1)) * ((T.sz >= 3 && L < 8) ? 0.6 : 1);
      e.ports = T.ports.map(p => ({ hp: ph * (p.w === 'dock' ? 1.5 : 1), mhp: ph * (p.w === 'dock' ? 1.5 : 1), pa: p.f, cd: rnd(0.5, 2.5), ch: 0, sp: rnd(2, 5) }));
    }
    this.enemies.push(e); return e;
  }
  spawnWave(L, w, fac, anchor) {
    const A = anchor || this.ship;
    let budget = min(26, 2 + ceil(L * 0.9) + floor(w * 1.5)), bigs = 0; const maxBig = min(4, 1 + floor(L / 4));
    const pool = [];
    const add = (t, wt) => { if (ETYPES[t].minL <= L || ETYPES[t].minL === 99) pool.push([t, wt]); };
    if (fac === 'pir') { add(4, 4); add(1, 2); add(0, 1); if (L >= 2) add(5, 1); if (L >= 3) { add(11, 1); add(6, 1.2); } if (L >= 6) add(15, 0.8); if (L >= 8) add(7, 0.5); if (L >= 10) add(16, 0.3); }
    else { add(0, max(0.4, 3 - L * 0.4)); add(1, 3); add(2, 3); add(3, 2); add(5, 1); add(11, 2); add(12, 1.5); add(6, 1.4); add(14, 1.2); add(15, 1); add(7, 0.8); add(16, 0.5); if (L >= 10) add(8, 0.3); if (L >= 14) add(17, 0.15); }
    const tot = pool.reduce((a, p) => a + p[1], 0);
    while (budget > 0) {
      let r = random() * tot, t = pool[0][0]; for (const p of pool) { r -= p[1]; if (r <= 0) { t = p[0]; break; } }
      const sz = ETYPES[t].sz;
      if (sz >= 1) { if (bigs >= maxBig) t = 1; else { bigs++; budget -= [0, 2, 4, 7][sz]; } }
      const a = random() * 2 * PI, d = rnd(950, 1300) + ETYPES[t].r;
      this.addEnemy(t, A.x + cos(a) * d, A.y + sin(a) * d, L, fac); budget--;
    }
  }
  bossType(L) { return L < 6 ? 7 : L < 10 ? 16 : L < 14 ? 8 : 17; }
  fireEB(x, y, ang, w, tg, L, extra = {}) {
    const W = WEAP[w], spd = W.spd + 4 * L;
    const mk = (a) => this.eb.push(Object.assign({ id: this.id(), x, y, vx: cos(a) * spd, vy: sin(a) * spd, t: W.t, r: W.r, life: W.life || 4, passed: 0, hv: W.heavy || W.t === 1 ? 1 : 0, home: W.home || 0, tg, spd, sd: W.sd }, extra));
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
    if (this.tickN % 15 === 0) this.calcStats();
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
        if (!this.humans()) { if (this.mk < 2 && this.cores >= MK_COST[this.mk + 1]) this.buyMk(); if (this.mk >= 2) while (this.cores > 0) this.convertCore(); }
        for (const s of this.seats) botSpend(this, s.bot, s.idx);
        this.calcStats(); for (const c of this.clients) c.dirty = 1;
      }
    } else if (this.phase === 'upgrade') {
      this.phaseT -= DT; this.idleCruise();
      const hum = this.humans(); if (hum && this.ready.size >= hum && this.phaseT > 0.4) this.phaseT = 0.4;
      if (this.phaseT <= 0) {
        if (this.pub && !hum && Date.now() - this.emptySince > 15 * 60e3 && this.mainDone > 4) this.resetCampaign();
        this.phase = 'map'; this.phaseT = hum ? 16 : 2; this.enemies = []; this.eb = []; this.allies = []; this.picks = []; this.waves = []; this.resetShip(); this.votes.clear();
      }
    }
    if (++this.tickN % SEND_EVERY === 0) this.broadcast();
  }
  resetCampaign() { this.mainDone = 0; this.failStreak = 0; this.mk = 0; this.cores = 0; this.ports = ROLES.map(() => [null, null]); for (const s of this.seats) s.bot = fixProf({ name: 'bot' }); this.crewEarned = 0; this.makeOptions(); }
  buyMk() { if (this.mk >= 2 || this.cores < MK_COST[this.mk + 1]) return false; this.cores -= MK_COST[this.mk + 1]; this.mk++; this.resetShip(); this.ev('mk', this.mk); for (const c of this.clients) c.dirty = 1; return true; }
  idleCruise() { const s = this.ship; s.a = wrap(s.a + 0.1 * DT); s.vx = cos(s.a) * 55; s.vy = sin(s.a) * 55; s.x += s.vx * DT; s.y += s.vy * DT; s.sa = wrap(s.sa + 0.4 * DT); }
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
      if (H === 0 || (M.type === 'defend' && M.waveT < -18)) {
        M.waveT -= DT;
        if (M.waveT <= 0 || M.type === 'defend' && M.waveT < -18) {
          if (M.wave < M.waves) { M.wave++; const anc = M.type === 'defend' ? this.allies.find(a => a.k === 'fs') : null; this.spawnWave(L, M.wave - 1, M.fac, anc); M.waveT = 1.5; this.ev('wave', M.wave); return; }
          if (M.type === 'flagship' && !M.bossSpawned) { M.bossSpawned = 1; const a = random() * 2 * PI; this.addEnemy(this.bossType(L), s.x + cos(a) * 1300, s.y + sin(a) * 1300, L, 'dom'); this.spawnWave(L, 0, 'dom'); this.ev('boss'); return; }
          if (H === 0) this.endMission(true);
        }
      } else if (M.type === 'defend') M.waveT -= DT;
    };
    if (M.type === 'pirates' || M.type === 'flagship' || M.type === 'defend') waveCheck();
    if (M.type === 'defend') { const fs_ = this.allies.find(a => a.k === 'fs'); if (!fs_ && this.phase === 'mission') return this.endMission(false); }
    if (M.type === 'station') {
      const st = this.enemies.find(e => e.type === 9);
      M.trickle -= DT; if (st && M.trickle <= 0 && H < 6) { M.trickle = 40; this.spawnWave(L, 0, M.fac, st); }
      if (!st && H === 0) this.endMission(true);
    }
    if (M.type === 'escort') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 14) { M.trickle = 14; const f = this.allies.find(a => a.k === 'fr'); this.spawnWave(L, floor(M.time / 35), M.fac, f || s); }
      const alive = this.allies.filter(a => a.k === 'fr').length;
      if (!alive) this.endMission(M.got >= 1);
    }
    if (M.type === 'hostages') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 10) { M.trickle = 16; this.spawnWave(L, 0, 'pir'); }
      if (M.lost > M.pods - M.need) return this.endMission(false);
      if (!this.allies.some(a => a.k === 'pod')) this.endMission(M.got >= M.need);
    }
  }
  // ----- ship -----
  inp(i) { return this.seats[i].cur; }
  up(i) { return !this.ship.sec[i].dn; }
  busy(i) { return this.seats[i].cur.as && this.up(i); }
  can(i) { return this.up(i) && !this.busy(i); }
  shieldUp() { const s = this.ship; return this.up(SHIELD) && s.shDown <= 0 && s.shp > 0; }
  secDamaged(k) { return this.secExists(k) && this.ship.sec[k].hp < this.secMax(k) - 1e-6; }
  repairPriority() {
    const s = this.ship, ord = [REPAIR, SHIELD, PILOT, ENG, GUNL, GUNR];
    for (const i of ord) if (s.sec[i].dn) return i;
    for (let k = 6; k < NSEC; k++) if (this.secExists(k) && s.sec[k].dn) return k;
    for (const i of ord) if (this.secDamaged(i)) return i;
    for (let k = 6; k < NSEC; k++) if (this.secDamaged(k)) return k;
    return s.hull < s.hm - 0.05 ? HULL_T : -1;
  }
  abilityOf(i, slot) {
    const tk = TREE_OF[i]; if (slot === 0) return [INNATE[tk], 1];
    const r = slot === 1 ? 1 : 3, P = this.T(i), idx = P.path[r]; if (idx == null) return null;
    const nd = TREES[tk].rows[r][idx]; return nd && nd.ab ? [nd.ab, nd.cdm || 1] : null;
  }
  buffDur(i, base) { return base + this.S(i, 'buff'); }
  crewM(i) { const b = this.seats[i].bf; return ((b.cry || 0) > 0 ? 1.25 : 1) * ((b.rally || 0) > 0 ? 1.3 : 1) * ((b.surge || 0) > 0 ? 1.4 : 1) * (1 + this.S(PILOT, 'crewRof')) * this.pipF(1); }
  nearestStation(x, y, skip) { let best = PILOT, bd = 1e18; for (let i = 0; i < 6; i++) { if (i === skip) continue; const [wx, wy] = this.secWorld(i), q = (wx - x) ** 2 + (wy - y) ** 2; if (q < bd) { bd = q; best = i; } } return best; }
  act(i, a) {
    const s = this.ship;
    if (a === 'q' || a === 'e' || a === 'r') return this.useAbility(i, 'qer'.indexOf(a));
    if (i === ENG && this.can(ENG) && a[0] === 'p') {
      const k = +a[1] - 1, P = s.pip;
      if (k === 3) { s.pip = [2, 2, 2]; this.ev('pip'); return; }
      if (k < 0 || k > 2 || P[k] >= 4) return;
      let j = -1; for (let q = 0; q < 3; q++) if (q !== k && P[q] > 0 && (j < 0 || P[q] > P[j])) j = q;
      if (j >= 0) { P[j]--; P[k]++; this.ev('pip'); }
    }
  }
  useAbility(i, slot) {
    const s = this.ship, seat = this.seats[i], A = this.abilityOf(i, slot), I = this.inp(i);
    if (!A || s.dead || !this.up(i)) return;
    const ab = A[0]; if ((seat.cd[ab] || 0) > 0) return;
    let cd = ABIL[ab].cd * A[1] * (1 - this.S(i, 'cdr'));
    const aimW = atan2(I.ay - s.y, I.ax - s.x), aimRel = wrap(aimW - s.a), dur = b => this.buffDur(i, b);
    const live = () => this.enemies.filter(e => !e.dead && e.warp <= 0 && e.type !== 10);
    switch (ab) {
      case 'roll': { s.inv = max(s.inv, 0.7 + this.S(i, 'rollInv')); const side = aimRel >= 0 ? 1 : -1; s.vx += cos(s.a + side * PI / 2) * 240; s.vy += sin(s.a + side * PI / 2) * 240; s.roll = 0.7 * side; break; }
      case 'rapid': seat.bf.rapid = 2.5; break;
      case 'reroute': { const tgt = aimRel >= 0 ? GUNR : GUNL, d = dur(5); this.seats[tgt].bf.reroute = d; if (this.S(ENG, 'split')) this.seats[tgt === GUNR ? GUNL : GUNR].bf.rhalf = d; s.reroute = d; this.ev('buff', 'reroute', tgt); break; }
      case 'fortify': s.fort = 4; break;
      case 'weld': { const t = s.task.i; if (t >= 0 && t < NSEC && this.secExists(t)) this.healSec(t, 1); else if (s.hull < s.hm) s.hull = min(s.hm, s.hull + 1); else return; break; }
      case 'volley': { const tg = live().filter(e => d2(e, s) < 750 * 750).sort((a, b) => d2(a, s) - d2(b, s)); if (!tg.length) return; for (let k = 0; k < 6; k++) { const e = tg[k % tg.length], a = s.a + (k - 3) * 0.25; this.pp.push({ id: this.id(), x: s.x, y: s.y, vx: cos(a) * 340, vy: sin(a) * 340, spd: 460, home: 5, tgt: e.id, dmg: 2 * (1 + this.S(PILOT, 'nDmg')), life: 3, k: 'dart', splash: 0 }); } break; }
      case 'cry': { const d = dur(5); for (const st of this.seats) st.bf.cry = d; break; }
      case 'flak': for (let k = 0; k < 18; k++) { const a = k / 18 * 2 * PI; this.addBolt(s.x + cos(a) * 30, s.y + sin(a) * 30, a, 560, 0.4, 0, 4, 0.5, 16); } break;
      case 'overcharge': seat.bf.over = 4; break;
      case 'paint': { const pt = { x: I.ax, y: I.ay }; const tg = live().sort((a, b) => d2(a, pt) - d2(b, pt))[0]; if (!tg) return; tg.paint = 6; this.ev('paint', tg.id); break; }
      case 'burner': s.burn = 2.5 + this.S(ENG, 'burn'); if (this.S(ENG, 'burn')) s.inv = max(s.inv, 0.6); break;
      case 'bomb': case 'seismic': { const big = ab === 'seismic'; let dx = I.ax - s.x, dy = I.ay - s.y, d = hypot(dx, dy) || 1; const r = min(d, 650); this.bombs.push({ id: this.id(), x: s.x, y: s.y, tx: s.x + dx / d * r, ty: s.y + dy / d * r, rad: (big ? 300 : 150) * (1 + this.S(ENG, 'bombRad')), dmg: (big ? 22 : 10) * (1 + this.S(ENG, 'bombDmg')), cl: !big && this.S(ENG, 'bombRad') > 0, spd: big ? 420 : 520 }); this.ev('bl'); break; }
      case 'bubble': s.bubble = 2; break;
      case 'lance': case 'nova': {
        if (!this.shieldUp()) return; const nova = ab === 'nova', half = nova ? PI : max(this.shieldArc() / 2, 22) * PI / 180;
        const dmg = (5 + 3 * s.shp) * (1 + this.S(SHIELD, 'lanceDmg')) * (nova ? 0.8 : 1);
        this.waves.push({ x: s.x, y: s.y, a: nova ? 0 : aimW, half, r: this.geo().sr, spd: 540, maxR: 820, dmg, hit: new Set() });
        s.shp = 0; s.shDown = SHIELD_DOWN; this.ev('lance', nova ? 1 : 0); this.ev('shb'); break; }
      case 'vent': if (!this.shieldUp() || s.shp < 1) return; s.shp -= 1; s.en = min(s.em, s.en + 35); break;
      case 'nano': { const t = s.task.i; if (t >= 0 && t < NSEC && this.secExists(t)) this.healSec(t, this.secMax(t) * 0.4); else if (s.hull < s.hm) s.hull = min(s.hm, s.hull + 1.5); else return; break; }
      case 'droneod': s.dod = 4; break;
      case 'stim': { const k = this.nearestStation(I.ax, I.ay, REPAIR), d = dur(5); this.seats[k].bf.stim = d; this.ev('buff', 'stim', k); break; }
      case 'flare': { let n = 0; for (const b of this.eb) if (!b.dead && b.t !== 0 && d2(b, s) < 360 * 360) { b.dead = 1; n++; this.ev('pd', round(b.x), round(b.y), b.t); } this.ev('flare', round(s.x), round(s.y)); break; }
      case 'strafe': s.strafe = 4; break;
      case 'rally': { const d = dur(5); for (const st of this.seats) st.bf.rally = d; s.hull = min(s.hm, s.hull + 1); break; }
      case 'barrage': seat.barr = 3; seat.barrT = 0; break;
      case 'deadeye': seat.dead = 5; break;
      case 'suppress': seat.bf.supp = dur(5); break;
      case 'warp': { const ox = s.x, oy = s.y, B = ARENA - 60; s.x = clamp(s.x + cos(aimW) * 380, -B, B); s.y = clamp(s.y + sin(aimW) * 380, -B, B); s.inv = max(s.inv, 1); this.ev('warp', round(ox), round(oy), round(s.x), round(s.y)); break; }
      case 'surge': { const d = dur(3); for (const st of this.seats) { for (const k in st.cd) st.cd[k] -= 4; st.bf.surge = d; } break; }
      case 'aegis': s.aegis = dur(4); break;
      case 'reboot': if (s.shDown <= 0 || !this.up(SHIELD)) return; s.shDown = 0; s.shp = s.shm * 0.6; this.ev('shu'); break;
      case 'restore': s.hull = min(s.hm, s.hull + 2); for (let k = 0; k < NSEC; k++) if (this.secExists(k)) this.healSec(k, 1); break;
      case 'swarm': s.swarm = 8; break;
      case 'medic': { const d = dur(4); for (const st of this.seats) st.bf.stim = d; break; }
      default: return;
    }
    seat.cd[ab] = cd; seat.cdm[ab] = cd; this.ev('ab', i, ab);
  }
  healSec(k, amt) { const s = this.ship, m = this.secMax(k), c = s.sec[k]; c.hp = min(m, c.hp + amt); if (c.hp >= m - 1e-6 && c.dn) { c.hp = m; c.dn = 0; this.ev('sr', k); } }
  simShip() {
    const s = this.ship, P = this.inp(PILOT), E = this.inp(ENG), Sh = this.inp(SHIELD), R = this.inp(REPAIR), mk = this.mk, g = this.geo();
    for (const seat of this.seats) { for (const a of seat.acts) this.act(seat.idx, a); for (const k in seat.cd) seat.cd[k] -= DT; for (const k in seat.bf) seat.bf[k] -= DT; }
    for (const k of ['inv', 'bubble', 'aegis', 'burn', 'reroute', 'dod', 'nose', 'gl', 'gr', 'strafe', 'swarm', 'fort']) s[k] -= DT;
    for (const k in s.gp) s.gp[k] -= DT;
    s.roll = (s.roll || 0) * 0.9; s.beam = {};
    const up = i => !s.sec[i].dn;
    // energy
    const aux = this.portEff(ENG, 'aux');
    s.em = 100 + this.S(ENG, 'emax') + 25 * aux;
    const regen = 3.2 * (1 + this.S(ENG, 'regen')) * (1 + 0.35 * aux) * (up(ENG) ? 1 : 0.6);
    s.en = min(s.em, s.en + regen * DT);
    // helm: pilot only. Cockpit destroyed => the ship keeps its heading, no steering at all
    if (this.can(PILOT)) {
      const turn = 1.7 * (1 - 0.1 * mk) * (1 + this.S(PILOT, 'turn')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * sqrt(this.pipF(0));
      const dx = P.ax - s.x, dy = P.ay - s.y; if (dx * dx + dy * dy > 900) s.a = wrap(s.a + clamp(wrap(atan2(dy, dx) - s.a), -turn * DT, turn * DT));
    }
    // speed: engineer only. Engines destroyed => slow stall to zero
    if (this.can(ENG)) s.thr = clamp(E.thr, 0.25, 1);
    const maxSp = 185 * (1 - 0.06 * mk) * (1 + this.S(ENG, 'speed')) * this.pipF(0) * (this.bf(ENG, 'stim') ? 1.25 : 1);
    if (up(ENG)) { const tgt = maxSp * s.thr * (s.burn > 0 ? 1.8 : 1) * (s.reroute > 0 ? 0.6 : 1); s.spd += clamp(tgt - s.spd, -170 * DT, 170 * DT); }
    else { const tgt = maxSp * this.S(ENG, 'limp') * s.thr; s.spd = s.spd > tgt ? max(tgt, s.spd - 22 * DT) : tgt; }
    const k = min(1, 2.4 * DT);
    s.vx += (cos(s.a) * s.spd - s.vx) * k; s.vy += (sin(s.a) * s.spd - s.vy) * k;
    s.x += s.vx * DT; s.y += s.vy * DT;
    const B = ARENA - 40;
    if (s.x < -B || s.x > B) { s.x = clamp(s.x, -B, B); s.vx = -s.vx * 0.5; s.a = wrap(PI - s.a); }
    if (s.y < -B || s.y > B) { s.y = clamp(s.y, -B, B); s.vy = -s.vy * 0.5; s.a = wrap(-s.a); }
    // nose laser + pilot ports
    if (this.can(PILOT) && P.f && s.nose <= 0) {
      const rate = 2.6 * (1 + this.S(PILOT, 'nRate')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * this.crewM(PILOT) * (s.strafe > 0 ? 3 : 1) * ((s.sec[GUNL].dn || s.sec[GUNR].dn) ? 1.4 : 1);
      s.nose = 1 / rate; s.noseN++;
      const dmg = 1.6 * (1 + this.S(PILOT, 'nDmg')), pier = this.S(PILOT, 'nPierce'), life = NOSE_LIFE * (1 + this.S(PILOT, 'nRange'));
      let a = s.a;
      if (this.big(PILOT, 'b_tc')) { let best = null, bd = 0.27; for (const e of this.enemies) { if (e.dead || e.warp > 0 || d2(e, s) > 7e5) continue; const q = abs(wrap(atan2(e.y - s.y, e.x - s.x) - s.a)); if (q < bd) { bd = q; best = e; } } if (best) a = atan2(best.y - s.y, best.x - s.x); }
      const nl = g.st[0][0] + 12;
      this.addBolt(s.x + cos(s.a) * nl, s.y + sin(s.a) * nl, a, BOLT_SPD, dmg, pier, 2, life);
      for (const p of this.activePorts(PILOT)) {
        const [px, py] = this.secWorld(p.k);
        if (p.id === 'twin') this.addBolt(px, py, a, BOLT_SPD, dmg * 0.8 * p.f, 0, 2, life);
        else if (p.id === 'rockets' && s.noseN % 4 === 0) this.addRocket(px, py, s.a, 4 * dmg * p.f, 0);
        else if (p.id === 'scatter' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.2; for (let q = -2; q <= 2; q++) this.addBolt(px, py, a + q * 0.09, BOLT_SPD * 0.9, dmg * 0.8 * p.f, 0, 2, life * 0.6); }
      }
    }
    // turrets
    for (const [gi, key, cdk, side] of [[GUNL, 'tl', 'gl', -1], [GUNR, 'tr', 'gr', 1]]) {
      if (!this.can(gi)) continue;
      const G = this.inp(gi), other = gi === GUNL ? GUNR : GUNL, seat = this.seats[gi], sb = seat.bf;
      const rr = sb.reroute > 0, rh = sb.rhalf > 0, boost = 1 + this.S(ENG, 'rrBoost'), stim = this.bf(gi, 'stim') ? 1.4 : 1;
      const center = side * 80 * PI / 180, half = s.sec[other].dn ? PI : min(PI, (110 + this.S(gi, 'arcG')) * PI / 180);
      let rel = wrap(atan2(G.ay - s.y, G.ax - s.x) - s.a);
      const off = wrap(rel - center); if (abs(off) > half) rel = center + clamp(off, -half, half);
      const slew = 6 * (1 + this.S(gi, 'slew')) * (rr ? 1.5 : rh ? 1.25 : 1) * stim;
      s[key] = wrap(s[key] + clamp(wrap(rel - s[key]), -slew * DT, slew * DT));
      const dmgM = 1.6 * (1 + this.S(gi, 'dmg')) * (rr ? 1 + 0.3 * boost : rh ? 1.15 : 1) * (sb.over > 0 ? 1.6 : 1);
      const [px, py] = this.secWorld(gi), wa = s.a + s[key], life = GUN_LIFE * (1 + this.S(gi, 'range'));
      const pd = 12 + this.S(gi, 'pd'), brk = 1 + this.S(gi, 'sBreak'), crit = this.S(gi, 'crit');
      if (G.f && s[cdk] <= 0) {
        let rate = 2.8 * (1 + this.S(gi, 'rof')) * this.crewM(gi) * (sb.rapid > 0 ? 2 : 1) * (rr ? 1.5 : rh ? 1.25 : 1) * stim * (s.sec[other].dn ? 1.25 : 1) * (sb.supp > 0 ? 1.6 : 1);
        if (s.en >= 0.5) s.en -= 0.5; else rate *= 0.5;
        s[cdk] = 1 / rate;
        let pier = this.S(gi, 'pierce') + (sb.supp > 0 ? 1 : 0), dm = dmgM * (random() < crit ? 2 : 1);
        if (seat.dead > 0) { dm *= 4; pier += 2; seat.dead--; }
        if (this.big(gi, 'b_twin')) for (const o of [-4, 4]) this.addBolt(px + cos(wa) * 14 - sin(wa) * o, py + sin(wa) * 14 + cos(wa) * o, wa, BOLT_SPD, dm, pier, 1, life, pd, brk);
        else this.addBolt(px + cos(wa) * 14, py + sin(wa) * 14, wa, BOLT_SPD, dm, pier, 1, life, pd, brk);
      }
      // the gunner's extra port turrets: each aims at the cursor from its own mount and fires in tandem
      const mounts = [[px, py, wa]];
      for (const p of this.activePorts(gi)) {
        const [qx, qy] = this.secWorld(p.k), ta = atan2(G.ay - qy, G.ax - qx), cur = s.pang[p.k] == null ? ta : s.pang[p.k];
        const na = s.pang[p.k] = wrap(cur + clamp(wrap(ta - cur), -4 * DT, 4 * DT)); mounts.push([qx, qy, na]);
        if (!G.f) continue;
        if (p.id === 'rockets' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.6; this.addRocket(qx, qy, na, 5 * dmgM * p.f, 1); }
        else if (p.id === 'scatter' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.1; for (let q = -2; q <= 2; q++) this.addBolt(qx, qy, na + q * 0.1, BOLT_SPD * 0.9, 0.8 * dmgM * p.f, 0, 1, life * 0.55, 0, brk); }
        else if (p.id === 'beam') this.fireBeam(p.k, qx, qy, na, 3 * dmgM * p.f * this.crewM(gi), brk);
      }
      if (seat.barr > 0) { seat.barrT -= DT; if (seat.barrT <= 0) { seat.barrT = 0.3; seat.barr--; for (const [mx, my, ma] of mounts) for (let q = -3; q <= 3; q++) this.addBolt(mx, my, ma + q * 0.08, BOLT_SPD, dmgM, 0, 1, life, 0, brk); } }
    }
    // shield: blue arc aimed in WORLD space by the shield player (ship turning does not move it)
    s.shm = this.shieldMax(); if (s.shp > s.shm) s.shp = s.shm;
    if (s.shDown > 0) { s.shDown -= DT; if (s.shDown <= 0) { s.shDown = 0; s.shp = s.shm; this.ev('shu'); } }
    s.shHit += DT;
    if (s.shDown <= 0 && s.shHit > 3) s.shp = min(s.shm, s.shp + (0.12 + this.S(SHIELD, 'shRegen') + 0.1 * this.portEff(SHIELD, 'capbank')) * this.pipF(2) * DT);
    if (this.can(SHIELD)) {
      const tgt = atan2(Sh.ay - s.y, Sh.ax - s.x), spin = 3 * (1 + this.S(SHIELD, 'shSpin')) * (this.bf(SHIELD, 'stim') ? 1.4 : 1) * sqrt(this.pipF(2));
      s.sa = wrap(s.sa + clamp(wrap(tgt - s.sa), -spin * DT, spin * DT));
    }
    // engineer port: mines
    for (const p of this.activePorts(ENG)) if (p.id === 'mines' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 3.5 / p.f; const [mx, my] = this.secWorld(p.k); this.mines.push({ id: this.id(), x: mx, y: my, life: 22, dmg: 5 * p.f }); }
    // repair task (calibration needle), self-patching, assisting
    const rq = (1 + this.S(REPAIR, 'rep')) * (this.bf(REPAIR, 'cry') ? 1.25 : 1) * (this.bf(REPAIR, 'rally') ? 1.3 : 1) * (this.bf(REPAIR, 'stim') ? 1.4 : 1);
    const T = s.task;
    if (this.can(REPAIR)) {
      const rt = R.rt, valid = (rt >= 0 && rt < NSEC && this.secDamaged(rt)) || (rt === HULL_T && s.hull < s.hm - 0.05);
      const tg = valid ? rt : this.repairPriority();
      if (tg !== T.i) { T.i = tg; T.bc = rnd(-0.55, 0.55); T.mark = tg >= 0 && tg < NSEC ? s.sec[tg].hp / this.secMax(tg) : 0; }
      T.bw = 0.3 * (1 + this.S(REPAIR, 'band'));
      if (tg >= 0 && R.f && this.needleIn(this.t - 0.2)) {
        if (tg === HULL_T) s.hull = min(s.hm, s.hull + 0.4 * rq * DT);
        else { const m = this.secMax(tg); this.healSec(tg, m / 6 * rq * DT); const frac = s.sec[tg].hp / m; if (frac - T.mark > 0.25) { T.mark = frac; T.bc = rnd(-0.55, 0.55); } }
      }
      const hreg = (0.03 + this.S(REPAIR, 'hullRegen')) * (1 + 2 * this.portEff(REPAIR, 'welder'));
      s.hull = min(s.hm, s.hull + hreg * DT);
    } else T.i = -1;
    for (let i = 0; i < 6; i++) {
      const c = this.inp(i), m = this.secMax(i);
      if (s.sec[i].dn && c.f) this.healSec(i, m / 22 * (1 + this.S(REPAIR, 'selfPatch')) * DT);
      else if (this.busy(i)) { const t = s.sec[REPAIR].dn ? REPAIR : this.repairPriority(); if (t >= 0 && t < NSEC && t !== i) this.healSec(t, this.secMax(t) / 20 * DT); }
    }
    if (this.big(REPAIR, 'b_auto')) for (let k = 0; k < NSEC; k++) if (this.secExists(k) && s.sec[k].dn) this.healSec(k, this.secMax(k) / 40 * DT);
    // drones: auto-deploy only while every ship section is at full health (Drone Swarm ignores that)
    let healthy = up(REPAIR); for (let q = 0; q < NSEC && healthy; q++) if (this.secDamaged(q)) healthy = false;
    const nD = min(6, (healthy ? 1 + this.S(REPAIR, 'drones') + (this.portEff(REPAIR, 'drone2') > 0 ? 1 : 0) : 0) + (s.swarm > 0 ? 3 : 0));
    const dl = (1 + this.S(REPAIR, 'dDmg')) * (this.portEff(REPAIR, 'drone2') || 1), dhp = 3 + this.S(REPAIR, 'dHp');
    const drate = 2 * (1 + this.S(REPAIR, 'dRate')) * (s.dod > 0 ? 3 : 1) * this.crewM(REPAIR);
    while (s.drones.length < 6) s.drones.push({ x: s.x, y: s.y, hp: dhp, on: 0, cd: 0, fc: 0, mc: 3 });
    s.drones.forEach((Dr, k) => {
      Dr.cd -= DT; Dr.fc -= DT; Dr.mc -= DT;
      const want = k < nD && Dr.cd <= 0;
      if (want && !Dr.on) { Dr.on = 1; Dr.hp = dhp; Dr.x = s.x; Dr.y = s.y; this.ev('launch'); }
      if (!want && Dr.on) { Dr.on = 0; this.ev('recall'); }
      if (!Dr.on) { Dr.x = s.x; Dr.y = s.y; return; }
      const oa = k * 1.05 + this.t * 0.5; let tx = R.ax + cos(oa) * 60 * (k > 0 ? 1 : 0), ty = R.ay + sin(oa) * 60 * (k > 0 ? 1 : 0); const ddx = tx - s.x, ddy = ty - s.y, dd = hypot(ddx, ddy);
      if (dd > 650) { tx = s.x + ddx / dd * 650; ty = s.y + ddy / dd * 650; }
      const vx = tx - Dr.x, vy = ty - Dr.y, vd = hypot(vx, vy) || 1, sp = min(320 * (s.dod > 0 ? 1.5 : 1), vd * 4);
      Dr.x += vx / vd * sp * DT; Dr.y += vy / vd * sp * DT;
      if (Dr.fc <= 0) {
        let best = null, bd = 420 * 420; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const q = d2(e, Dr); if (q < bd) { bd = q; best = e; } }
        if (best) { Dr.fc = 1 / drate; this.addBolt(Dr.x, Dr.y, atan2(best.y - Dr.y, best.x - Dr.x), 700, 0.7 * dl, 0, 3, 0.6, 12); if (this.S(REPAIR, 'dMsl') && Dr.mc <= 0) { Dr.mc = 3; this.pp.push({ id: this.id(), x: Dr.x, y: Dr.y, vx: 0, vy: 0, spd: 380, home: 4, tgt: best.id, dmg: 3 * dl, life: 3.5, k: 'dart', splash: 40 }); } }
      }
    });
    // shield drone port
    const SD = s.sdr, sdf = this.portEff(REPAIR, 'sdrone'); SD.cd -= DT; SD.on = sdf > 0 && SD.cd <= 0 && up(REPAIR); SD.a += 2 * DT; SD.mhp = 3 + 2 * sdf;
    if (SD.on) { const rr = g.sr + 24; SD.x = s.x + cos(SD.a) * rr; SD.y = s.y + sin(SD.a) * rr; }
  }
  needleIn(t) { const T = this.ship.task; return abs(sin(t * 1.7) - T.bc) < T.bw; }
  fireBeam(k, px, py, a, dps, brk) {
    const s = this.ship, L = 330, cx = cos(a), cy = sin(a); let hitD = L, hitE = null, hitP = -1;
    for (const e of this.enemies) {
      if (e.dead || e.warp > 0) continue;
      const ex = e.x - px, ey = e.y - py, t = ex * cx + ey * cy; if (t < -e.r || t > L + e.r) continue;
      const perp = abs(ex * cy - ey * cx); if (perp > e.r + 6) continue;
      if (ETYPES[e.type].mp) {
        let pk = -1, pd = 1e9; e.ports.forEach((p, q) => { if (p.hp <= 0) return; const [wx, wy] = this.portPos(e, q); const qx = wx - px, qy = wy - py, tt = qx * cx + qy * cy; if (tt > 0 && tt < pd && abs(qx * cy - qy * cx) < 14) { pd = tt; pk = q; } });
        const armour = max(0, t - e.r * 0.6);
        if (pk >= 0 && pd < hitD && pd <= armour + 30) { hitD = pd; hitE = e; hitP = pk; } else if (armour < hitD) { hitD = armour; hitE = e; hitP = -2; }
      } else { const tt = max(0, t - e.r * 0.5); if (tt < hitD) { hitD = tt; hitE = e; hitP = -1; } }
    }
    for (const b of this.eb) { if (b.dead) continue; const ex = b.x - px, ey = b.y - py, t = ex * cx + ey * cy; if (t > 0 && t < hitD && abs(ex * cy - ey * cx) < 9) { b.dead = 1; this.ev('pd', round(b.x), round(b.y), b.t); } }
    if (hitE && hitP === -2) this.damageEnemy(hitE, -2, dps * DT * brk);
    else if (hitE) this.damageEnemy(hitE, hitP, dps * DT * (hitE.paint > 0 ? 1.5 : 1) * brk);
    s.beam[k] = [round(px), round(py), round(a * 100) / 100, round(hitD)];
  }
  addBolt(x, y, a, spd, dmg, pierce, kind, life, pd = 0, brk = 1) {
    const b = { id: this.id(), x, y, vx: cos(a) * spd, vy: sin(a) * spd, dmg, pierce, kind, life, hit: [], pd, brk };
    this.bolts.push(b); this.ev('b', b.id, round(x), round(y), round(b.vx), round(b.vy), kind, life);
  }
  addRocket(x, y, a, dmg, home) { const s = this.ship; this.pp.push({ id: this.id(), x, y, vx: cos(a) * 300 + s.vx * 0.3, vy: sin(a) * 300 + s.vy * 0.3, spd: 380, home: home ? 1.1 : 0, tgt: null, dmg, life: 2.4, k: 'rk', splash: 70 }); this.ev('rk'); }
  // ----- world -----
  portPos(e, k) { const p = ETYPES[e.type].ports[k], c = cos(e.a), s_ = sin(e.a); return [e.x + p.x * c - p.y * s_, e.y + p.x * s_ + p.y * c]; }
  inHull(e, wx, wy) {
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
  // hit test against the physical ship (union of section discs); returns section index or -1
  shipHit(x, y, pad) {
    const g = this.geo(), s = this.ship; let best = -1, bd = 1e18;
    for (let k = 0; k < NSEC; k++) { if (!this.secExists(k)) continue; const [wx, wy] = this.secW[k], q = (wx - x) ** 2 + (wy - y) ** 2; if (q < bd) { bd = q; best = k; } }
    const lim = 25 + pad; if (bd < lim * lim) return best;
    if ((s.x - x) ** 2 + (s.y - y) ** 2 < (g.hr * 0.75 + pad) ** 2) return best;
    return -1;
  }
  simWorld() {
    const s = this.ship, L = this.mission ? this.mission.level : 1, dm = this.mission ? DIFFS[this.mission.diff].m : 1, g = this.geo();
    this.secW = []; for (let k = 0; k < NSEC; k++) this.secW.push(this.secExists(k) ? this.secWorld(k) : [s.x, s.y]);
    // enemies
    for (const e of this.enemies) {
      if (e.dead) continue; const T = ETYPES[e.type];
      if (e.warp > 0) { e.warp -= DT; continue; }
      e.paint -= DT; e.shT += DT;
      if (e.type === 10) { e.x += e.vx * DT; e.y += e.vy * DT; e.a += e.spin * DT; if (d2(e, s) < (e.r + g.hr) ** 2 && !s.dead) { this.hitShip(e.x, e.y, 1, 2, null); this.damageEnemy(e, -1, 99); } continue; }
      const tg = this.phase === 'mission' ? this.pickTarget(e) : null; if (!tg) { e.vx *= 0.98; e.vy *= 0.98; e.x += e.vx * DT; e.y += e.vy * DT; continue; }
      const dx = tg.x - e.x, dy = tg.y - e.y, d = hypot(dx, dy) || 1, ta = atan2(dy, dx), spd = T.spd * (1 + 0.015 * L);
      let vx, vy;
      if (e.type === 5) { vx = dx / d * spd; vy = dy / d * spd; if (d < e.r + (tg.r || g.hr) + 4) { if (tg === s) this.hitShip(e.x, e.y, 2, 2, null); else tg.hp -= 6; this.killEnemy(e, 0); continue; } }
      else if (T.spd === 0) { vx = 0; vy = 0; }
      else {
        const want = T.want; const rad = d > want ? 1 : d < want * 0.7 ? -0.8 : 0;
        vx = (dx / d * rad - dy / d * e.orbit * 0.8) * spd; vy = (dy / d * rad + dx / d * e.orbit * 0.8) * spd;
        if (random() < 0.004) e.orbit *= -1;
      }
      const tf = T.mp ? 0.4 : 3, desired = (e.type === 5 || !T.mp) && T.g && !T.g.turret ? ta : atan2(vy, vx);
      e.a = wrap(e.a + clamp(wrap((T.mp ? ta : desired) - e.a), -tf * DT, tf * DT));
      const k = min(1, 2 * DT); e.vx += (vx - e.vx) * k; e.vy += (vy - e.vy) * k;
      e.x = clamp(e.x + e.vx * DT, -ARENA, ARENA); e.y = clamp(e.y + e.vy * DT, -ARENA, ARENA);
      e.ramT = (e.ramT || 0) - DT;
      if (!T.mp && d2(e, s) < (e.r + g.hr) ** 2 && !s.dead && e.ramT <= 0) { e.ramT = 1.2; if (s.burn > 0 && this.S(ENG, 'ram')) this.damageEnemy(e, -1, 12); else { this.hitShip(e.x, e.y, 1, 1, null); this.damageEnemy(e, -1, 3); } }
      if (this.phase !== 'mission' || s.dead) continue;
      const rateM = 1 / (0.82 + 0.18 * dm) * (1 + 0.03 * L);
      if (T.g) {
        e.cd -= DT * rateM; const G = T.g, rel = abs(wrap(ta - e.a));
        if (e.cd <= 0 && d < G.rng && (G.turret || rel < G.arc)) {
          const W = WEAP[G.w]; e.cd = W.cd * rnd(0.85, 1.25) / (G.burst ? 0.6 : 1);
          const lead = d / W.spd, ax = tg.x + (tg.vx || 0) * lead * 0.6, ay = tg.y + (tg.vy || 0) * lead * 0.6, aa = atan2(ay - e.y, ax - e.x);
          for (let q = 0; q < G.n; q++) {
            const off = G.n > 1 ? (q - (G.n - 1) / 2) * 0.06 : 0; const px = e.x + cos(e.a) * e.r, py = e.y + sin(e.a) * e.r;
            this.fireEB(px, py, (G.turret ? aa : e.a + clamp(wrap(aa - e.a), -0.12, 0.12)) + off, G.w, tg, L);
          }
        }
      }
      if (T.mp) e.ports.forEach((p, k) => {
        if (p.hp <= 0) return; const PT = T.ports[k], [px, py] = this.portPos(e, k);
        if (PT.w === 'dock') { // shipping dock: keeps launching smaller ships until it is destroyed
          p.sp -= DT; if (p.sp <= 0) { p.sp = 9 + 2 * PT.cap / 3; const alive = this.enemies.reduce((n, q) => n + (!q.dead && q.par === e.id && q.dk === k ? 1 : 0), 0); if (alive < PT.cap + floor(L / 8) && d < 1900) { const kinds = L < 3 ? [1, 0] : L < 6 ? [1, 12, 13] : [1, 12, 13, 2, 11]; const c = this.addEnemy(pick(kinds), px, py, L, e.fac); c.par = e.id; c.dk = k; c.warp = 0.5; c.a = e.a + PT.f; this.ev('dock', round(px), round(py)); } }
          return;
        }
        const pa = atan2(tg.y - py, tg.x - px), pd = hypot(tg.x - px, tg.y - py);
        const rel = wrap(pa - e.a), cr = wrap(rel - PT.f), clampRel = PT.f + clamp(cr, -PT.arc, PT.arc);
        p.pa = wrap(p.pa + clamp(wrap(clampRel - p.pa), -1.8 * DT, 1.8 * DT));
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
        const T = ETYPES[e.type], rr = e.r + 4 + (T.mp ? 44 : 0); if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > rr * rr) continue;
        const pm = (e.paint > 0 ? 1.5 : 1) * b.brk;
        if (T.mp) {
          const inside = this.inHull(e, b.x, b.y);
          if (e.sh > 0) { if (inside || segD2(ox, oy, b.x, b.y, e.x, e.y) < (e.r * 0.8) ** 2) { this.damageEnemy(e, -2, b.dmg * pm); b.dead = 1; this.ev('x', b.id); break; } continue; }
          let hitP = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || hitP >= 0) return; const [wx, wy] = this.portPos(e, k); if (segD2(ox, oy, b.x, b.y, wx, wy) < 19 * 19) hitP = k; });
          if (hitP >= 0) { this.damageEnemy(e, hitP, b.dmg * pm); b.hit.push(e.id); if (b.pierce > 0) b.pierce--; else { b.dead = 1; this.ev('x', b.id); break; } }
          else if (inside) { let nk = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || nk >= 0) return; const [wx, wy] = this.portPos(e, k); if ((wx - b.x) ** 2 + (wy - b.y) ** 2 < 34 * 34) nk = k; });
            b.dead = 1; if (nk >= 0) this.damageEnemy(e, nk, b.dmg * pm); else this.ev('arm', round(b.x), round(b.y)); this.ev('x', b.id); break; }
        } else { this.damageEnemy(e, -1, b.dmg * pm); b.hit.push(e.id); if (b.pierce > 0) b.pierce--; else { b.dead = 1; this.ev('x', b.id); break; } }
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
        if (ETYPES[e.type].mp) {
          if (e.sh > 0) { if (!this.inHull(e, p.x, p.y)) continue; this.damageEnemy(e, -2, p.dmg); }
          else { let hk = -1, hd = 1e9; e.ports.forEach((q, k) => { if (q.hp <= 0) return; const [wx, wy] = this.portPos(e, k), dd = (wx - p.x) ** 2 + (wy - p.y) ** 2; if (dd < hd) { hd = dd; hk = k; } }); if (hk >= 0 && hd < 60 * 60) this.damageEnemy(e, hk, p.dmg); else if (!this.inHull(e, p.x, p.y)) continue; }
        } else this.damageEnemy(e, -1, p.dmg);
        if (p.splash) this.splash(p.x, p.y, p.splash, p.dmg * 0.5, e);
        p.dead = 1; this.ev('boom', round(p.x), round(p.y), 0); break;
      }
    }
    this.pp = this.pp.filter(p => !p.dead);
    // engineer bombs
    for (const b of this.bombs) {
      const dx = b.tx - b.x, dy = b.ty - b.y, d = hypot(dx, dy), sp = (b.spd || 520) * DT;
      if (d < 18) { b.dead = 1; this.splash(b.tx, b.ty, b.rad, b.dmg); this.ev('boom', round(b.tx), round(b.ty), 2, round(b.rad)); for (const q of this.eb) if (!q.dead && (q.x - b.tx) ** 2 + (q.y - b.ty) ** 2 < b.rad * b.rad) q.dead = 1;
        if (b.cl) for (let k = 0; k < 3; k++) { const a = k * 2.1 + random(); this.bombs.push({ id: this.id(), x: b.tx, y: b.ty, tx: b.tx + cos(a) * 130, ty: b.ty + sin(a) * 130, rad: b.rad * 0.5, dmg: b.dmg * 0.4 }); }
        continue; }
      b.x += dx / d * min(d, sp); b.y += dy / d * min(d, sp);
    }
    this.bombs = this.bombs.filter(b => !b.dead);
    // mines (engineer port)
    for (const m of this.mines) { m.life -= DT; if (m.life <= 0) { m.dead = 1; continue; } for (const e of this.enemies) if (!e.dead && e.warp <= 0 && d2(e, m) < (e.r + 30) ** 2) { m.dead = 1; this.splash(m.x, m.y, 90, m.dmg || 5); this.ev('boom', round(m.x), round(m.y), 1); break; } }
    this.mines = this.mines.filter(m => !m.dead);
    // shield lance / nova waves
    for (const w of this.waves) {
      const r0 = w.r; w.r += w.spd * DT; if (w.r > w.maxR) { w.dead = 1; continue; }
      for (const q of this.eb) if (!q.dead) { const d = hypot(q.x - w.x, q.y - w.y); if (d > r0 - 20 && d < w.r + 20 && abs(wrap(atan2(q.y - w.y, q.x - w.x) - w.a)) <= w.half) { q.dead = 1; this.ev('pd', round(q.x), round(q.y), q.t); } }
      for (const e of this.enemies) {
        if (e.dead || e.warp > 0 || w.hit.has(e.id) || e.type === 10) continue;
        const d = hypot(e.x - w.x, e.y - w.y); if (d - e.r > w.r + 10 || d + e.r < r0 - 10) continue;
        if (abs(wrap(atan2(e.y - w.y, e.x - w.x) - w.a)) > w.half + e.r / max(d, 1)) continue;
        w.hit.add(e.id);
        if (ETYPES[e.type].mp) { if (e.sh > 0) this.damageEnemy(e, -2, w.dmg * 2); else e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [wx, wy] = this.portPos(e, k); const dd = hypot(wx - w.x, wy - w.y); if (dd > r0 - 40 && dd < w.r + 40 && abs(wrap(atan2(wy - w.y, wx - w.x) - w.a)) <= w.half + 0.15) this.damageEnemy(e, k, w.dmg); }); }
        else this.damageEnemy(e, -1, w.dmg * (e.sh > 0 ? 2 : 1));
      }
    }
    this.waves = this.waves.filter(w => !w.dead);
    // enemy shots
    const sr = g.sr;
    for (const b of this.eb) {
      if (b.dead) continue; b.life -= DT; if (b.life <= 0) { b.dead = 1; if (b.t === 2) this.ev('boom', round(b.x), round(b.y), 0); continue; }
      if (b.home && b.tg && !b.tg.dead) { const a = atan2(b.tg.y - b.y, b.tg.x - b.x), ca = atan2(b.vy, b.vx), na = ca + clamp(wrap(a - ca), -b.home * DT, b.home * DT); b.vx = cos(na) * b.spd; b.vy = sin(na) * b.spd; }
      b.x += b.vx * DT; b.y += b.vy * DT;
      for (const Dr of s.drones) if (Dr.on && (Dr.x - b.x) ** 2 + (Dr.y - b.y) ** 2 < (14 + b.r) ** 2) { b.dead = 1; Dr.hp -= b.hv ? 2 : 1; this.ev('pd', round(b.x), round(b.y), b.t); if (Dr.hp <= 0) { Dr.on = 0; Dr.cd = 8; this.ev('boom', round(Dr.x), round(Dr.y), 0); } break; }
      if (b.dead) continue;
      const SD = s.sdr; if (SD.on && (SD.x - b.x) ** 2 + (SD.y - b.y) ** 2 < (26 + b.r) ** 2) { b.dead = 1; SD.hp -= 1; this.ev('pd', round(b.x), round(b.y), b.t); if (SD.hp <= 0) { SD.cd = 10; SD.hp = SD.mhp || 4; } continue; }
      if (!s.dead) {
        const dd = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
        if (dd < (sr + b.r) ** 2 && dd > (sr - 20) ** 2 && !b.passed) {
          if (this.shieldCovers(atan2(b.y - s.y, b.x - s.x))) { b.dead = 1; this.shieldHit(b); continue; }
          b.passed = 1;
        }
        const hs = this.shipHit(b.x, b.y, b.r);
        if (hs >= 0) { b.dead = 1; this.hitShip(b.x, b.y, b.hv ? 1.2 : 0.75, b.hv ? 2 : 1, b); continue; }
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
        if (d < 80) { a.dead = 1; M.got++; this.grant(8 * DIFFS[M.diff].m); this.ev('jump', round(a.x), round(a.y)); }
      }
      if (a.k === 'pod' && M && this.phase === 'mission' && !s.dead) {
        if (d2(a, s) < 110 * 110) { a.resc += DT; if (a.resc > 1.0) { a.dead = 1; M.got++; this.grant(6 * DIFFS[M.diff].m); this.ev('resc', round(a.x), round(a.y)); } } else a.resc = max(0, a.resc - DT);
      }
      if (a.k === 'fs') a.a += 0.1 * DT;
    }
    this.allies = this.allies.filter(a => !a.dead);
    // pickups: credit chips and cores
    const mag = 150 * (1 + 1.5 * (this.portEff(ENG, 'tractor') > 0 ? 1 : 0)) * (1 + this.S(REPAIR, 'magnet'));
    for (const p of this.picks) {
      p.life -= DT; if (p.life <= 0) { p.dead = 1; continue; }
      let col = null; if (!s.dead && d2(p, s) < mag * mag) col = s; else for (const Dr of s.drones) if (Dr.on && this.S(REPAIR, 'magnet') > 0 && d2(p, Dr) < 120 * 120) col = Dr;
      if (col) { const dx = col.x - p.x, dy = col.y - p.y, d = hypot(dx, dy) || 1; p.x += dx / d * 560 * DT; p.y += dy / d * 560 * DT; if (d < 30) { p.dead = 1; if (p.k === 'core') { this.cores++; this.ev('core'); } else this.grant(p.v); this.ev('pick', p.k === 'core' ? 1 : 0, p.v); } }
      else { p.x += p.vx * DT; p.y += p.vy * DT; p.vx *= 0.97; p.vy *= 0.97; }
    }
    this.picks = this.picks.filter(p => !p.dead);
    this.enemies = this.enemies.filter(e => !e.dead);
  }
  splash(x, y, rad, dmg, skip) { for (const e of this.enemies) { if (e.dead || e === skip || e.warp > 0) continue; const dd = (e.x - x) ** 2 + (e.y - y) ** 2; if (dd > (rad + e.r) ** 2) continue; if (ETYPES[e.type].mp) { if (e.sh > 0) this.damageEnemy(e, -2, dmg); else e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [wx, wy] = this.portPos(e, k); if ((wx - x) ** 2 + (wy - y) ** 2 < rad * rad) this.damageEnemy(e, k, dmg); }); } else this.damageEnemy(e, -1, dmg); } }
  // port >= 0: that gun port; -1: a small ship; -2: the hull of a capital ship (only matters while its shield is up)
  damageEnemy(e, port, dmg) {
    if (e.dead) return;
    if (e.sh > 0) { e.sh -= dmg; e.shT = 0; this.ev('esh', round(e.x), round(e.y), e.id); if (e.sh <= 0) { e.sh = 0; this.ev('shk', round(e.x), round(e.y), round(e.r)); } return; }
    if (port === -2) return;
    if (port >= 0) { const p = e.ports[port]; if (p.hp <= 0) return; p.hp -= dmg; this.ev('hit', round(e.x), round(e.y), e.id, port);
      if (p.hp <= 0) { p.hp = 0; const [wx, wy] = this.portPos(e, port), T = ETYPES[e.type]; this.ev('pk', e.id, port, round(wx), round(wy), T.ports[port].w === 'dock' ? 1 : 0); this.dropCredits(wx, wy, max(1, round(T.cr * 0.12))); if (e.ports.every(q => q.hp <= 0)) this.killEnemy(e, 1); }
      return; }
    if (ETYPES[e.type].mp) return;
    e.hp -= dmg; this.ev('hit', round(e.x), round(e.y), e.id, -1); if (e.hp <= 0) this.killEnemy(e, 1);
  }
  dropCredits(x, y, v) { this.picks.push({ id: this.id(), k: 'cr', x, y, vx: rnd(-80, 80), vy: rnd(-80, 80), v, life: 16 }); }
  killEnemy(e, byPlayer) {
    if (e.dead) return; e.dead = 1; const T = ETYPES[e.type], dm = this.mission ? DIFFS[this.mission.diff].m : 1;
    this.ev('boom', round(e.x), round(e.y), T.mp ? 3 : e.r > 18 ? 2 : 1, round(e.r));
    if (!byPlayer) return;
    this.score += T.cr;
    const tot = T.cr * dm * (e.spot ? 2 : 1), chips = clamp(round(tot / 4), 0, 10);
    for (let k = 0; k < chips; k++) this.dropCredits(e.x + rnd(-e.r, e.r) * 0.5, e.y + rnd(-e.r, e.r) * 0.5, max(1, round(tot / chips)));
    if (!chips && tot > 0 && random() < tot) this.dropCredits(e.x, e.y, 1);
    const cc = [0, 0.12, 0.35, 0.7][T.sz]; if ((T.mp && random() < cc * dm) || (!T.mp && e.type !== 10 && random() < 0.003 * dm)) this.picks.push({ id: this.id(), k: 'core', x: e.x, y: e.y, vx: rnd(-40, 40), vy: rnd(-40, 40), v: 1, life: 30 });
  }
  shieldCovers(ang) {
    const s = this.ship; if (!this.shieldUp()) return 0;
    if (s.bubble > 0) return 2;
    const half = this.shieldArc() / 2 * PI / 180, rear = this.portEff(SHIELD, 'rear') > 0;
    if (abs(wrap(ang - s.sa)) < half) return 1;
    if (rear && abs(wrap(ang - s.sa - PI)) < half * 0.6) return 1;
    return 0;
  }
  shieldHit(b) {
    const s = this.ship, dmg = (b.sd || 1) * (s.fort > 0 ? 0.5 : 1) * (s.bubble > 0 ? 0.5 : 1); s.shp -= dmg; s.shHit = 0;
    s.en = min(s.em, s.en + (b.hv ? 4 : 2) * (1 + this.S(SHIELD, 'absorb')) * this.pipF(2));
    this.ev('blk', round(b.x), round(b.y), b.t);
    const refl = this.S(SHIELD, 'reflect') + 0.25 * (this.portEff(SHIELD, 'reflect') > 0 ? 1 : 0);
    if (b.t === 0 && random() < refl) this.addBolt(b.x, b.y, atan2(-b.vy, -b.vx), 700, 1.6, 0, 1, 0.9);
    if (s.shp <= 0) { s.shp = 0; s.shDown = SHIELD_DOWN; this.ev('shb'); }
  }
  hitShip(x, y, hullDmg, stDmg, b) {
    const s = this.ship; if (s.dead || s.inv > 0) { if (s.inv > 0) this.ev('blk', round(x), round(y), 0); return; }
    if (random() < this.S(PILOT, 'graze')) { this.ev('graze', round(x), round(y)); return; }
    const L = this.mission ? this.mission.level : 1;
    s.hull -= hullDmg * (1 + 0.03 * (L - 1));
    let k = this.shipHit(x, y, 40); if (k < 0) k = this.nearestStation(x, y);
    const c = s.sec[k];
    if (s.aegis <= 0 && !c.dn) { c.hp -= stDmg; if (c.hp <= 0) { c.hp = this.S(REPAIR, 'emerg') * this.secMax(k); c.dn = 1; this.ev('sd', k); } }
    this.ev('sh', round(x), round(y), k);
    if (s.hull <= 0) { s.hull = 0; s.dead = 1; s.deadT = 2.2; this.ev('boom', round(s.x), round(s.y), 3, 80); }
  }
  threats() {
    const s = this.ship, out = [], sr = this.geo().sr;
    for (const b of this.eb) { if (b.dead || b.passed) continue; const rx = s.x - b.x, ry = s.y - b.y, sp = hypot(b.vx, b.vy) || 1, tti = (rx * b.vx + ry * b.vy) / (sp * sp); if (tti < 0 || tti > 2.6) continue; const cx = b.x + b.vx * tti - s.x, cy = b.y + b.vy * tti - s.y; if (cx * cx + cy * cy > (sr + 20) ** 2) continue; out.push({ b, tti, ang: wrap(atan2(b.y - s.y, b.x - s.x) - s.a), wang: atan2(b.y - s.y, b.x - s.x) }); }
    return out.sort((a, b) => a.tti - b.tti);
  }
  // ----- bots -----
  botCtl(i) { const st = this.seats[i]; return !st.human || st.human.inp.idle; }
  botThink() {
    const s = this.ship, M = this.mission; if (!M || s.dead) return;
    const live = this.enemies.filter(e => !e.dead && e.warp <= 0 && e.type !== 10), th = this.threats();
    const near = (p, r) => live.filter(e => d2(e, p) < r * r);
    const los = (e, x, y) => { const dx = x - s.x, dy = y - s.y, d = hypot(dx, dy); for (let t = 12; t < d - 22; t += 12) if (this.inHull(e, s.x + dx / d * t, s.y + dy / d * t)) return false; return true; };
    const aimPt = e => { if (!ETYPES[e.type].mp || e.sh > 0) return [e.x + e.vx * 0.25, e.y + e.vy * 0.25]; let best = null, bd = 1e18; e.ports.forEach((p, k) => { if (p.hp <= 0) return; const [x, y] = this.portPos(e, k), q = ((x - s.x) ** 2 + (y - s.y) ** 2) * (los(e, x, y) ? 1 : 9) * (ETYPES[e.type].ports[k].w === 'dock' ? 0.6 : 1); if (q < bd) { bd = q; best = [x, y]; } }); return best || [e.x, e.y]; };
    const nearest = (pred) => { let b = null, bd = 1e18; for (const e of live) { if (pred && !pred(e)) continue; const q = d2(e, s); if (q < bd) { bd = q; b = e; } } return b; };
    const B = i => { const st = this.seats[i]; st.bi.idle = 0; return st.bi; };
    const ctl = i => this.botCtl(i);
    const down = () => s.sec.reduce((n, c) => n + (c.dn ? 1 : 0), 0);
    const missiles = th.filter(t => t.b.t !== 0);
    const nr = nearest(), big = nearest(e => ETYPES[e.type].mp);
    // each bot uses whatever abilities its skill pyramid unlocked
    const useAbs = (i, cond) => { for (let slot = 0; slot < 3; slot++) { const A = this.abilityOf(i, slot); if (!A) continue; const f = cond[A[0]], st = this.seats[i]; if (f && (st.cd[A[0]] || 0) <= 0 && f()) st.bacts.push('qer'[slot]); } };
    for (let i = 0; i < 6; i++) if (ctl(i)) { const b = B(i); b.as = 0; b.f = s.sec[i].dn ? 1 : 0; }
    // pilot: objective-driven helm
    if (ctl(PILOT)) {
      const b = B(PILOT); let goal = null;
      if (M.type === 'hostages') { let bd = 1e18; for (const a of this.allies) if (a.k === 'pod') { const q = d2(a, s); if (q < bd) { bd = q; goal = a; } } }
      if (M.type === 'escort') { const f = this.allies.find(a => a.k === 'fr'); if (f && d2(f, s) > 450 * 450) goal = f; }
      if (M.type === 'defend') { const f = this.allies.find(a => a.k === 'fs'); if (f && d2(f, s) > 600 * 600) goal = f; }
      const tgt = nearest(e => !ETYPES[e.type].mp || M.type !== 'escort') || nr;
      if (!goal && tgt) {
        if (ETYPES[tgt.type].mp) {
          let pk = -1, pd = 1e18; if (tgt.sh <= 0) tgt.ports.forEach((p, k) => { if (p.hp <= 0) return; const [x, y] = this.portPos(tgt, k), q = (x - s.x) ** 2 + (y - s.y) ** 2; if (q < pd) { pd = q; pk = k; } });
          if (pk >= 0) { const [px, py] = this.portPos(tgt, pk), ox = px - tgt.x, oy = py - tgt.y, a = atan2(oy, ox) + 0.35 * tgt.orbit; goal = { x: px + cos(a) * 360, y: py + sin(a) * 360 }; }
          else { const a = atan2(s.y - tgt.y, s.x - tgt.x) + 0.3 * tgt.orbit; goal = { x: tgt.x + cos(a) * (tgt.r * 0.7 + 340), y: tgt.y + sin(a) * (tgt.r * 0.7 + 340) }; }
        } else { const [x, y] = aimPt(tgt); goal = { x, y }; }
      }
      if (!goal) { const pk = this.picks[0]; goal = pk || { x: 0, y: 0 }; }
      b.ax = goal.x; b.ay = goal.y;
      b.f = s.sec[PILOT].dn ? 1 : (tgt && abs(wrap(atan2(tgt.y - s.y, tgt.x - s.x) - s.a)) < 0.25 && d2(tgt, s) < 540 * 540 ? 1 : 0);
      useAbs(PILOT, { roll: () => th.length >= 3 && th[0].tti < 0.6, volley: () => near(s, 650).length >= 2, cry: () => near(s, 800).length >= 4, flare: () => missiles.length >= 2, strafe: () => tgt && d2(tgt, s) < 520 * 520, rally: () => near(s, 800).length >= 3 || s.hull < s.hm * 0.5 });
    }
    // gunners
    for (const [gi, side] of [[GUNL, -1], [GUNR, 1]]) {
      if (!ctl(gi) || s.sec[gi].dn) continue; const b = B(gi);
      const center = side * 80 * PI / 180, other = gi === GUNL ? GUNR : GUNL, half = s.sec[other].dn ? PI : min(PI, (110 + this.S(gi, 'arcG')) * PI / 180), rng = 540 * (1 + this.S(gi, 'range'));
      const missile = missiles.find(t => abs(wrap(t.ang - center)) < half);
      let tgt = null, bd = 1e18;
      for (const e of live) { const ang = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); if (abs(wrap(ang - center)) > half) continue; const q = d2(e, s) * (e.paint > 0 ? 0.5 : 1) * (ETYPES[e.type].mp ? 1.4 : 1); if (q < bd) { bd = q; tgt = e; } }
      if (missile && this.S(gi, 'pd') > 0) { b.ax = missile.b.x; b.ay = missile.b.y; b.f = 1; }
      else if (tgt) { const [x, y] = aimPt(tgt), d = sqrt(d2(tgt, s)), lead = d / BOLT_SPD; b.ax = x + (tgt.vx || 0) * lead; b.ay = y + (tgt.vy || 0) * lead; b.f = d < rng ? 1 : 0; }
      else { b.f = 0; if (s.sec[REPAIR].dn) b.as = 1; }
      const close = tgt && d2(tgt, s) < rng * rng;
      useAbs(gi, { rapid: () => close, flak: () => th.length >= 3 || near(s, 220).length >= 2, overcharge: () => close, paint: () => tgt && (ETYPES[tgt.type].mp || tgt.sh > 0), barrage: () => close && (ETYPES[tgt.type].mp || near(s, 500).length >= 3), deadeye: () => close && (ETYPES[tgt.type].mp || tgt.sh > 0), suppress: () => close });
    }
    // shield: swing the blue arc (world-space) to the most imminent threat
    if (ctl(SHIELD) && !s.sec[SHIELD].dn) {
      const b = B(SHIELD), t0 = th[0];
      if (t0) { b.ax = s.x + cos(t0.wang) * 300; b.ay = s.y + sin(t0.wang) * 300; }
      else if (nr) { b.ax = nr.x; b.ay = nr.y; }
      useAbs(SHIELD, { bubble: () => th.length >= 4, nova: () => near(s, 320).length >= 4 && s.shp >= s.shm * 0.8, lance: () => this.shieldUp() && s.shp >= s.shm * 0.7 && !th.length && nr && d2(nr, s) < 470 * 470 && (nr.sh > 0 || ETYPES[nr.type].mp), vent: () => s.en < 25 && s.shp > 2, fortify: () => th.length >= 3, reboot: () => s.shDown > 6 && th.length >= 2, aegis: () => (th.length >= 3 && s.hull < s.hm * 0.6) || down() >= 2 });
    }
    // engineer: throttle, power routing, buffs, bombs
    if (ctl(ENG) && !s.sec[ENG].dn) {
      const b = B(ENG), n = near(s, 800).length, seat = this.seats[ENG];
      const travel = M.type === 'hostages' || M.type === 'escort' || n === 0;
      b.thr = travel ? 1 : 0.7;
      const want = s.sec[SHIELD].dn || th.length >= 4 ? [1, 1, 4] : n >= 3 ? [1, 4, 1] : travel ? [4, 1, 1] : [2, 2, 2];
      if (this.t - (this.lastPip || 0) > 0.6) { for (let k = 0; k < 3; k++) if (s.pip[k] < want[k]) { seat.bacts.push('p' + (k + 1)); this.lastPip = this.t; break; } }
      const sideCount = sd => live.filter(e => { const a = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); return sd > 0 ? a > 0 : a < 0; }).length;
      const rs = sideCount(1) >= sideCount(-1) ? 1 : -1, ra = s.a + rs * PI / 2;
      const bigNear = nearest(e => ETYPES[e.type].mp && d2(e, s) < 620 * 620), cl = nr;
      if (cl) { b.ax = (bigNear || cl).x; b.ay = (bigNear || cl).y; } else { b.ax = s.x + cos(ra) * 200; b.ay = s.y + sin(ra) * 200; }
      const rrAim = () => { if (!cl) return; b.ax = s.x + cos(ra) * 200; b.ay = s.y + sin(ra) * 200; };
      for (let slot = 0; slot < 3; slot++) { const A = this.abilityOf(ENG, slot); if (!A || (seat.cd[A[0]] || 0) > 0) continue; const ab = A[0];
        if ((ab === 'bomb' && cl && n >= 2 && d2(cl, s) < 600 * 600) || (ab === 'seismic' && bigNear) || (ab === 'burner' && ((travel && n === 0 && M.type !== 'defend') || (th.length >= 3 && s.hull < s.hm * 0.5))) || (ab === 'surge' && n >= 3) || (ab === 'warp' && s.hull < s.hm * 0.35 && n >= 2)) { if (ab === 'warp' && cl) { b.ax = s.x - (cl.x - s.x); b.ay = s.y - (cl.y - s.y); } seat.bacts.push('qer'[slot]); }
        else if (ab === 'reroute' && n >= 2 && !s.sec[rs > 0 ? GUNR : GUNL].dn) { rrAim(); seat.bacts.push('qer'[slot]); } }
    }
    // repair: hit the calibration band, steer the drones, use kit abilities
    if (ctl(REPAIR) && !s.sec[REPAIR].dn) {
      const b = B(REPAIR); b.rt = -1;
      b.f = s.task.i >= 0 && this.needleIn(this.t - 0.15) && this.needleIn(this.t - 0.25) ? 1 : 0;
      if (nr) { b.ax = nr.x; b.ay = nr.y; } else if (this.picks.length) { b.ax = this.picks[0].x; b.ay = this.picks[0].y; }
      const gi = s.sec[GUNR].dn ? GUNL : GUNR, ga = s.a + (gi === GUNR ? PI / 3 : -PI / 3);
      const seat = this.seats[REPAIR];
      for (let slot = 0; slot < 3; slot++) { const A = this.abilityOf(REPAIR, slot); if (!A || (seat.cd[A[0]] || 0) > 0) continue; const ab = A[0];
        if ((ab === 'weld' && s.task.i >= 0) || (ab === 'nano' && s.task.i >= 0 && s.sec.some(c => c.dn)) || (ab === 'droneod' && s.drones.some(d => d.on) && near(s, 600).length >= 2) || (ab === 'restore' && (down() >= 2 || s.hull < s.hm * 0.5)) || (ab === 'swarm' && near(s, 700).length >= 3) || (ab === 'medic' && down() >= 1 && near(s, 700).length >= 2)) seat.bacts.push('qer'[slot]);
        else if (ab === 'stim' && near(s, 800).length >= 2) { b.ax = s.x + cos(ga) * 200; b.ay = s.y + sin(ga) * 200; seat.bacts.push('qer'[slot]); } }
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
    const o = { t: 's', ph: this.phase, pt: r1(max(0, this.phaseT)), T: r2(this.t), mk: this.mk, co: this.cores, md: this.mainDone, sc: this.score, ce: this.crewEarned, v: D.VERSION };
    o.sh = { x: round(s.x), y: round(s.y), a: r2(s.a), vx: round(s.vx), vy: round(s.vy), h: r1(s.hull), hm: s.hm,
      sc: s.sec.map((c, k) => this.secExists(k) ? r2(c.hp / this.secMax(k)) : -1), dn: s.sec.map(c => c.dn ? 1 : 0),
      en: round(s.en), em: s.em, sa: r2(s.sa), tl: r2(s.tl), tr: r2(s.tr), thr: r2(s.thr), spd: round(s.spd),
      burn: s.burn > 0 ? 1 : 0, dr: s.drones.map(d => d.on ? [round(d.x), round(d.y)] : 0), sd: s.sdr.on ? [round(s.sdr.x), round(s.sdr.y)] : 0,
      tk: [s.task.i, r2(s.task.bc), r2(s.task.bw), s.task.i >= 0 && s.task.i < NSEC ? r2(s.sec[s.task.i].hp / this.secMax(s.task.i)) : r2(s.hull / s.hm)],
      shp: r1(s.shp), shm: r1(s.shm), shd: r1(s.shDown), bub: s.bubble > 0 ? 1 : 0, aeg: s.aegis > 0 ? 1 : 0, fort: s.fort > 0 ? 1 : 0, inv: s.inv > 0 ? 1 : 0, roll: r2(s.roll || 0), dead: s.dead, pip: s.pip,
      bm: Object.keys(s.beam).map(k => [+k].concat(s.beam[k])), rr: s.reroute > 0 ? 1 : 0, rear: this.portEff(SHIELD, 'rear') > 0 ? 1 : 0, arc: this.shieldArc(), pa: Object.keys(s.pang).map(k => [+k, r2(s.pang[k])]) };
    o.e = this.enemies.map(e => [e.id, e.type, round(e.x), round(e.y), r2(e.a), ETYPES[e.type].mp ? 1 : (e.type === 10 ? round(e.r) : r2(max(0, e.hp / e.mhp))), e.warp > 0 ? 1 : 0, e.paint > 0 ? 1 : 0, e.ports ? e.ports.map(p => [r2(p.hp / p.mhp), r2(p.pa), p.ch > 0 ? 1 : 0]) : 0, e.shm ? r2(e.sh / e.shm) : -1]);
    o.eb = this.eb.map(b => [b.id, round(b.x), round(b.y), r2(atan2(b.vy, b.vx)), b.t, b.hv ? 1 : 0]);
    o.pp = this.pp.map(p => [p.id, round(p.x), round(p.y), r2(atan2(p.vy, p.vx)), p.k === 'rk' ? 0 : 1]);
    o.al = this.allies.map(a => [a.id, a.k, round(a.x), round(a.y), r2(a.a), r2(max(0, a.hp / a.mhp)), r2(a.resc || 0)]);
    o.pk = this.picks.map(p => [p.id, round(p.x), round(p.y), p.k === 'core' ? 1 : 0]);
    o.mn = this.mines.map(m => [round(m.x), round(m.y)]);
    o.bo = this.bombs.map(b => [round(b.x), round(b.y)]);
    o.wv = this.waves.map(w => [round(w.x), round(w.y), r2(w.a), r2(w.half), round(w.r)]);
    o.crew = this.seats.map(st => [st.human ? st.human.prof.name : st.botName, st.human ? 0 : 1, st.human ? st.human.pid : 0, st.cur.as && !s.sec[st.idx].dn ? 1 : 0, st.human && st.human.inp.idle ? 1 : 0,
      [0, 1, 2].map(k => { const A = this.abilityOf(st.idx, k); if (!A) return 0; const ab = A[0]; return [ab, r1(max(0, st.cd[ab] || 0)), r1(st.cdm[ab] || ABIL[ab].cd * A[1])]; }), Object.keys(st.bf).filter(k => st.bf[k] > 0),
      this.ports[st.idx].map((p, sl) => p && sl < this.mk ? [p.id, p.lv] : 0)]);
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
const ACTS = new Set(['q', 'e', 'r', 'p1', 'p2', 'p3', 'p4']);
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
    I.thr = clamp(n(m.thr) || 0.65, 0.25, 1); I.idle = m.idle ? 1 : 0; I.rt = Number.isInteger(m.rt) ? clamp(m.rt, -1, NSEC) : -1;
    if (Array.isArray(m.a)) for (const a of m.a.slice(0, 6)) if (ACTS.has(a) && c.acts.length < 12) c.acts.push(a);
  } else if (m.t === 'role') R.switchRole(c, m.role | 0);
  else if (m.t === 'buy') {
    if (R.phase === 'mission') return sendTo(c, { t: 'toast', m: 'Upgrades are bought between missions' });
    const seat = R.seatOf(c), tk = TREES[m.tree] ? m.tree : TREE_OF[seat ? seat.idx : 0], kind = String(m.kind); let err;
    if (kind === 'port') err = seat ? R.buyPort(c.prof, seat.idx, m.slot | 0, String(m.id)) : 'take a station first';
    else if (kind === 'pup') err = seat ? R.upPort(c.prof, seat.idx, m.slot | 0) : 'take a station first';
    else err = buy(c.prof, tk, kind, String(m.id), R.mk);
    if (err) sendTo(c, { t: 'toast', m: err }); c.dirty = 1; R.calcStats();
  } else if (m.t === 'mk') { if (R.phase !== 'mission') { if (!R.buyMk()) sendTo(c, { t: 'toast', m: 'Not enough crew cores' }); } }
  else if (m.t === 'core') { if (R.phase !== 'mission') { const err = R.convertCore(); if (err) sendTo(c, { t: 'toast', m: err }); } }
  else if (m.t === 'ready' && R.phase === 'upgrade') { if (m.v === 0) R.ready.delete(c.pid); else R.ready.add(c.pid); }
  else if (m.t === 'vote' && R.phase === 'map') { if (R.options.some(o => o.id === m.id)) R.votes.set(c.pid, m.id); }
  else if (m.t === 'name') { c.prof.name = String(m.name || '').replace(/[^\w \-\.!?]/g, '').trim().slice(0, 14) || c.prof.name; c.dirty = 1; }
  else if (m.t === 'ping') sendTo(c, { t: 'pong', ts: m.ts });
  else if (DEV && m.t === 'dev') devOp(R, c, m);
}
// test-only hooks (enabled with DEV_TOOLS=1): used by the screenshot script and tests to stage scenes
function devOp(R, c, m) {
  const s = R.ship;
  if (m.op === 'setmk') { R.mk = clamp(m.mk | 0, 0, 2); R.resetShip(); for (let r = 0; r < 6; r++) for (let sl = 0; sl < R.mk; sl++) if (!R.ports[r][sl]) R.ports[r][sl] = { id: TREES[TREE_OF[r]].ports[(r + sl) % 3][0], lv: sl + 1 }; c.dirty = 1; }
  else if (m.op === 'give') { c.prof.cr += m.cr | 0; R.cores += m.cores | 0; c.dirty = 1; }
  else if (m.op === 'phase') { R.phase = m.ph; R.phaseT = m.secs || 40; if (m.ph === 'upgrade') R.result = R.result || { win: 1, bonus: 30, cores: 1, name: 'Test', type: 'pirates' }; c.dirty = 1; }
  else if (m.op === 'spawn') { const a = +m.a || 0, d = +m.d || 700; const e = R.addEnemy(m.type | 0, s.x + cos(a) * d, s.y + sin(a) * d, m.L || 8, 'dom', true); e.a = a + PI; if (m.static) e.cd = 1e9; }
  else if (m.op === 'clear') { R.enemies = []; R.eb = []; }
  else if (m.op === 'mission') { R.startMission(Object.assign({}, R.options[m.i | 0 || 0], m.over || {})); }
  else if (m.op === 'ship') { Object.assign(s, m.v || {}); }
  else if (m.op === 'path') { const P = c.prof.t[m.tree]; P.path = (m.path || []).slice(0, 5); c.dirty = 1; R.calcStats(); }
  else if (m.op === 'hurt') { for (const k of m.k || []) { s.sec[k].dn = 1; s.sec[k].hp = 0; } }
  else if (m.op === 'shp') { s.shp = +m.v; s.shDown = 0; }
}
rooms.set('PUBLIC', new Room('PUBLIC', true));

function tickAll() { for (const r of rooms.values()) { try { r.step(); } catch (e) { console.error('room', r.code, e); } } }
function start() {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: 1, v: D.VERSION, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0), uptime: process.uptime() | 0 })); }
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
  server.listen(PORT, () => console.log('Team Space Ship v3 on :' + PORT));
}
if (require.main === module) start();
module.exports = { Room, buy, botSpend, rooms };
