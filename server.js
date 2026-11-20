'use strict';
// Spacebelts Optional v8: server-authoritative co-op. Node + ws.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./public/defs.js'), ST = require('./public/story.js');
const { portUps, PORT_UPS, MONEY_MULT, RR_CFG, BOMB_CFG, ARENA, EFIRE_WEAK_LV, EFIRE_WEAK, REPAIR_CFG, ROLES, TREE_OF, TREES, ABIL, INNATE, NODE_COST, infCost, PORT_COST, portUpCost, PORT_MAX_LV, ETYPES, WEAP, DIFFS, MTYPES, MK_COST, CORE_RATE, ION_STUN, ION_COST, ION_CD, NSEC, HULL_T, secRole, secSlot, secLocal, HULL_PER_METAL, ELITE, BOT_PORTS, BOT_PATH, PORT_SLOTS, isStation, HAZ, WELL, GEO, secIdx, pyrAllowed, treeStats, infCap, SHIELD_ARC0, SHIELD_ARC_MAX, SHIELD_DOWN } = D;
const PORT = +process.env.PORT || 8080;
const DEV = process.env.DEV_TOOLS === '1'; // test-only hooks (screenshots); never set in production
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data'); fs.mkdirSync(DATA, { recursive: true });

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg' };
let files = {};
function loadFiles() {
  const f2 = {};
  const walk = (dir, pre) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f), st = fs.statSync(p); if (st.isDirectory()) { walk(p, pre + f + '/'); continue; } if (!st.isFile()) continue;
      const b = fs.readFileSync(p), bin = /\.(webp|png|jpg|mp3)$/.test(f);   // v7: portraits live in public/img/*.webp (already compressed: no gzip)
      f2['/' + pre + f] = { raw: b, gz: bin ? null : zlib.gzipSync(b, { level: 9 }), bin, type: MIME[path.extname(f)] || 'application/octet-stream', etag: '"' + crypto.createHash('md5').update(b).digest('hex').slice(0, 12) + '"' };
    }
  };
  walk(PUB, '');
  f2['/'] = f2['/index.html']; files = f2;
}
loadFiles();

// ---------- constants & helpers ----------
const TICK = 30, DT = 1 / TICK, SEND_EVERY = 2;
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5;
const JOIN_ORDER = [PILOT, GUNL, GUNR, SHIELD, ENG, REPAIR];
const DRONE_CFG = { dps: 1.7, spd: 255, sep: 34, hold: 10 };   // v6: drone beam dps (was 2.6), top speed (was 340), minimum distance between two drones
const STV = D.STATION_TYPES, FIGHTERS = [1, 2, 4, 11, 12];   // v8: portless fighter types that fly in squadrons
function formOff(i, kind, S) { if (kind === 'tri') { const row = floor((Math.sqrt(8 * i + 1) - 1) / 2), col = i - row * (row + 1) / 2; return [-row * S * 0.9, (col - row / 2) * S]; } if (!i) return [0, 0]; const rank = ceil(i / 2), side = i % 2 ? 1 : -1; return [-rank * S * 0.85, side * rank * S * 0.8]; }
const STRAFE_SPD = 46;
// v9 engineer throttle: the engines spool toward the set throttle (lag), and throttle above 40% drains the reroute energy pool
const THR_FREE = 0.4, THR_DRAIN = 3.2, THR_RATE = 0.35;
const ROOM_GRACE = +process.env.ROOM_GRACE_MS || 45e3;   // v9: a ship with no humans left is removed after this grace period (reconnects inside it keep the run)
const RV_TIME = 30;   // v9 restart vote duration (s)
const newRun = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);   // v8: pilot strafe thrusters, px/s sideways
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
const blankInput = () => ({ ax: 0, ay: -300, f: 0, as: 0, thr: 0.7, rt: -1, idle: 0, mb: 0, ck: 0, sx: 0 });
function fixProf(p) { p.t = p.t || {}; for (const k in TREES) { const x = p.t[k] = p.t[k] || {}; x.path = Array.isArray(x.path) ? x.path : []; x.i = x.i || {}; x.b = x.b || {}; } p.cr = p.cr || 0; p.earned = p.earned || 0; return p; }
function planetName() { return pick(D.PLANET_A) + pick(D.PLANET_B) + pick(D.PLANET_C); }

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
    let ps = -1; for (let sl = 0; sl < mk && sl < 3; sl++) if (!room.ports[i][sl]) { ps = sl; break; }
    if (ps >= 0) { if (prof.cr < PORT_COST[ps]) return; room.buyPort(prof, i, ps, BOT_PORTS[i][ps]); continue; }
    const bg = T.big.find(b => !P.b[b[0]] && b[4] <= mk);
    if (bg && prof.cr >= bg[3]) { buy(prof, tk, 'big', bg[0], mk); continue; }
    let opt = null, oc = 1e9;
    for (const x of T.inf) { const lv = P.i[x[0]] || 0; if (infCap(tk, x[0], lv)) continue; const c = infCost(lv); if (c < oc) { oc = c; opt = ['inf', x[0]]; } }
    room.ports[i].forEach((p, sl) => { if (p && sl < mk) { const pu_ = p.u || (p.u = {}), defs = portUps(tk, p.id, sl), o = defs.filter(x => (pu_[x.o] || 0) < x.max).sort((a, b) => (pu_[a.o] || 0) - (pu_[b.o] || 0))[0]; if (o) { const c = portUpCost(p.lv); if (c < oc) { oc = c; opt = ['pup', sl, o.o]; } } } });
    if (!opt || prof.cr - oc < (bg ? bg[3] * 0.5 : 0)) return;
    if (opt[0] === 'inf') buy(prof, tk, 'inf', opt[1], mk); else room.upPort(prof, i, opt[1], opt[2]);
  }
}

// ---------- rooms ----------
const rooms = new Map();
const BOT_NAMES = ['ARC-7', 'VEGA', 'BOLT', 'NOVA', 'RIVET', 'HALO', 'ZIP', 'ORBIT', 'FLUX', 'K-9X', 'JAX', 'TESS'];
const MAIN_MOD = { 2: 'rad', 3: 'cold', 6: 'wells', 7: 'cold', 9: 'rad', 11: 'wells' };   // v8: hazards on some main missions
const MAIN_SEQ = ['pirates', 'hostages', 'escort', 'passengers', 'station', 'defend', 'flagship'];
const MAIN_SEQ2 = ['survival', 'pirates', 'bombrun', 'siege', 'hostages', 'flagship', 'passengers', 'defend', 'escort', 'station'];   // v6: main missions past level 10

class Room {
  constructor(code, isPublic) {
    this.code = code; this.pub = isPublic; this.clients = new Set(); this.help = 0; this.nameOff = floor(random() * BOT_NAMES.length);
    this.seats = ROLES.map((r, i) => ({ role: r, idx: i, human: null, cur: blankInput(), bi: blankInput(), bacts: [], acts: [], cd: {}, cdm: {}, bf: {}, botName: ST.CREW[i].name.split(' ')[0], bot: fixProf({ name: 'bot' }), hes: 0 }));
    this.mainDone = 0; this.failStreak = 0; this.crewEarned = 0; this.score = 0; this.t = 0; this.idc = 1; this.tickN = 0;
    this.mk = 0; this.cores = 0; this.hullPlus = 0; this.ports = ROLES.map(() => [null, null, null]);
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.waves = []; this.events = []; this.zones = []; this.wells = []; this.seenZ = {};
    this.seen = new Set(); this.phase = 'lobby'; this.phaseT = 3; this.runId = newRun(); this.rv = null; this.lobbyGo = 0; this.mission = null;   // v8: private ships open in the pre-game lobby; the always-on public ship skips it
     this.votes = new Map(); this.ready = new Set(); this.result = null; this.emptySince = Date.now();
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
  secMax(k) { const ph = this.S(REPAIR, 'portHp'); const bk = this.portEff(REPAIR, 'bulk') + this.pu(REPAIR, 'bulk', 'plate'); if (k < 6) return 3 + (this.big(k, 'b_armor') ? 1 : 0) + ph + bk; const p = this.ports[secRole(k)][secSlot(k)]; return 3 + (secSlot(k) === 2 ? ELITE.secHp : 0) + 0.8 * (p && p.u ? p.u.hp || 0 : 0) + ph + bk; }
  secPos(k) { return secLocal(this.geo(), k); }
  secWorld(k) { const s = this.ship, [lx, ly] = this.secPos(k), c = cos(s.a), sn = sin(s.a); return [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c]; }
  activePorts(role) { const o = []; for (let sl = 0; sl < 3; sl++) { const k = secIdx(role, sl); if (this.secExists(k) && !this.ship.sec[k].dn) o.push({ k, sl, id: this.ports[role][sl].id, lv: this.ports[role][sl].lv, u: this.ports[role][sl].u || {}, f: sl === 2 ? ELITE.eff : 1 }); } return o; }
  // v6: total effect of one upgrade option of an installed (working) port, e.g. pu(GUNR, 'sniper', 'dmg') = +0.5 at level 2 of +25%
  pu(role, id, opt) { let v = 0; const defs = PORT_UPS[TREE_OF[role] + '.' + id]; const d = defs && defs.find(x => x.o === opt); if (!d) return 0; for (const p of this.activePorts(role)) if (p.id === id) v += (p.u[opt] || 0) * d.per * (p.sl === 2 ? ELITE.per : 1); return v; }
  portEff(role, id) { let f = 0; for (const p of this.activePorts(role)) if (p.id === id) f += p.f; return f; }
  buyPort(prof, role, slot, id) {
    if (!(slot === 0 || slot === 1 || slot === 2) || slot >= this.mk) return 'needs a ship upgrade';
    if (this.ports[role][slot]) return 'that port is already installed (port choices are permanent)';
    if (!TREES[TREE_OF[role]].ports.some(x => x[0] === id)) return 'bad port';
    if (!PORT_SLOTS[TREE_OF[role]][slot].includes(id)) return 'that port is not offered for this slot (each slot has its own choices)';
    if (prof.cr < PORT_COST[slot]) return 'not enough credits'; prof.cr -= PORT_COST[slot];
    this.ports[role][slot] = { id, lv: 0, u: {} }; const k = secIdx(role, slot); this.ship.sec[k] = { hp: this.secMax(k), dn: 0 }; this.ev('port', role, slot, id); return null;
  }
  upPort(prof, role, slot, opt) {
    const p = this.ports[role][slot]; if (!p || slot >= this.mk) return 'no port installed there';
    const defs = portUps(TREE_OF[role], p.id, slot); const d = defs && defs.find(x => x.o === opt); if (!d) return 'unknown port upgrade';
    p.u = p.u || {}; if ((p.u[opt] || 0) >= d.max + (slot === 2 && opt !== 'dbl' ? ELITE.maxLv : 0)) return d.n + ' is fully upgraded';
    const c = portUpCost(p.lv); if (prof.cr < c) return 'not enough credits'; prof.cr -= c; p.u[opt] = (p.u[opt] || 0) + 1; p.lv++; const k = secIdx(role, slot); if (opt === 'hp') this.ship.sec[k].hp = this.secMax(k); return null;
  }
  convertCore() { if (this.mk < 3) return 'selling Morph Metal unlocks with the Mk IV ship'; if (this.cores < 1) return 'no Morph Metal'; this.cores--; this.grant(CORE_RATE); this.ev('cv'); return null; }
  // v7: after Mk IV the spare Morph Metal can also be turned into permanent hull HP (+HULL_PER_METAL max hull each)
  hullCore() { if (this.mk < 3) return 'hull plating unlocks with the Mk IV ship'; if (this.cores < 1) return 'no Morph Metal'; this.cores--; this.hullPlus += HULL_PER_METAL; const s = this.ship; s.hm += HULL_PER_METAL; s.hull += HULL_PER_METAL; this.ev('hc'); return null; }
  sendDrones(x, y) { const s = this.ship, d = hypot(x - s.x, y - s.y), L = 1800; if (d > L) { x = s.x + (x - s.x) / d * L; y = s.y + (y - s.y) / d * L; } const [bx, by] = this.bnd(); s.dg = { x: clamp(x, -bx + 30, bx - 30), y: clamp(y, -by + 30, by - 30), t: DRONE_CFG.hold }; this.ev('dg', round(s.dg.x), round(s.dg.y)); }
  // v5 power rerouting: slots pip[0..3] = engines, weapons, shield recharge, repair. Off while the engineer's station is down or power is depleted.
  rrLv(k) { const s = this.ship; return (s.lock > 0 || !this.up(ENG)) ? 0 : s.pip[k]; }
  pipF(k) { const l = this.rrLv(k), pe = this.pe(); return 1 + [RR_CFG.eng, RR_CFG.wpn, RR_CFG.shd, RR_CFG.rep][k] * l * pe; }
  pe() { return 1 + this.S(ENG, 'pipEff') + 0.2 * this.portEff(ENG, 'surge') + this.pu(ENG, 'surge', 'str'); }   // v8: rerouting strength multiplier (Conduits + Surge Coupler)
  drainM() { return max(0.4, 1 - this.pu(ENG, 'aux', 'eff') - 0.08 * this.portEff(ENG, 'surge') - this.pu(ENG, 'surge', 'eff') - 0.12 * this.portEff(ENG, 'coolant') - this.pu(ENG, 'coolant', 'eff')); }
  thrDrain() { const s = this.ship; if (!s || s.sec[ENG].dn || s.thr <= THR_FREE) return 0; return THR_DRAIN * Math.pow((s.thr - THR_FREE) / (1 - THR_FREE), 1.15) * max(0.3, 1 - 0.3 * this.portEff(ENG, 'coolant') - this.pu(ENG, 'coolant', 'thr')); }   // v9: energy/s taken by throttle above 40%
  strafeM() { return 1 + this.S(PILOT, 'strafe') + 0.4 * this.portEff(PILOT, 'gyro') + this.pu(PILOT, 'gyro', 'strafe'); }   // v9 Strafe Thrusters upgrade (no cap) + Gyro port   // v8: energy drain multiplier (Efficient Routing + Surge Coupler)
  shDr() { return min(0.6, RR_CFG.shDr * this.rrLv(2) * this.pe() + this.pu(SHIELD, 'ablate', 'shock')); }
  emerg() { return this.emerg() + 0.2 * this.portEff(REPAIR, 'foam') + this.pu(REPAIR, 'foam', 'restart'); }
  ionCost() { return ION_COST * max(0.3, 1 - 0.25 * this.portEff(SHIELD, 'ioncap') - this.pu(SHIELD, 'ioncap', 'cost')); }
  ionCdM() { return max(0.3, 1 - 0.3 * this.portEff(SHIELD, 'ioncap') - this.pu(SHIELD, 'ioncap', 'cd')); }
  rrUsed() { const P = this.ship.pip; return P[0] + P[1] + P[2] + P[3]; }
  ev(...a) { this.events.push(a); }
  grant(v) { // credits are equal for every crew member
    v = round(v * MONEY_MULT); if (v <= 0) return; this.crewEarned += v;
    for (const s of this.seats) { s.bot.cr += v; s.bot.earned += v; }
    for (const c of this.clients) { c.prof.cr += v; c.prof.earned = max(c.prof.earned + v, this.crewEarned); c.dirty = 1; }
  }
  shieldMax() { return (4 + this.S(SHIELD, 'shHp') + 3 * this.portEff(SHIELD, 'capbank') + this.pu(SHIELD, 'capbank', 'cap') + this.pu(SHIELD, 'rear', 'guard') + this.pu(SHIELD, 'arclens', 'focus') + 2 * this.portEff(SHIELD, 'harden') + this.pu(SHIELD, 'harden', 'cap') + this.pu(SHIELD, 'coil', 'cap')) * (1 + RR_CFG.shHp * this.rrLv(2) * this.pe()); }
  shieldArc() { return min(SHIELD_ARC_MAX, (SHIELD_ARC0 + this.S(SHIELD, 'shArc')) * (1 + 0.25 * this.portEff(SHIELD, 'arclens') + this.pu(SHIELD, 'arclens', 'width'))); }
  resetShip() {
    this.calcStats();
    const hm = 40 + 12 * this.mk + this.S(PILOT, "hull") + this.hullPlus, sec = [];
    this.ship = { x: 0, y: 0, a: -PI / 2, vx: 0, vy: -80, spd: 80, thr: 0.7, hull: hm, hm, sec, en: 100, em: 100, lock: 0, sa: -PI / 2, shp: 3, shm: 3, shDown: 0, shHit: 9, fort: 0,
      tl: -80 * PI / 180, tr: 80 * PI / 180, beam: {}, pang: {}, dg: null, drones: [], sdr: { a: 0, hp: 4, cd: 0 }, task: { i: -1, mult: 0 }, inv: 0, bubble: 0, aegis: 0, rally: 0, burn: 0, droneOff: 0, reroute: 0, dod: 0, strafe: 0, swarm: 0,
      stun: 0, ionCd: 0, nose: 0, noseN: 0, scat: 0, gl: 0, gr: 0, gp: {}, mineT: 3.5, dead: 0, pip: [0, 0, 0, 0], roll: 0, lat: 0, hmN: 0, flT: 0 };
    for (let k = 0; k < NSEC; k++) sec.push({ hp: 0, dn: 0 });
    for (let k = 0; k < NSEC; k++) if (this.secExists(k)) sec[k].hp = this.secMax(k);
    this.ship.shm = this.ship.shp = this.shieldMax();
    for (const s of this.seats) { s.cd = {}; s.cdm = {}; s.bf = {}; s.dead = 0; s.barr = 0; }
  }
  // ----- overworld -----
  mkPlanet() { return { name: planetName(), seed: floor(random() * 1e6), kind: pick(D.PLANET_K) }; }
  makeOptions() {
    const n = this.mainDone + 1, opts = [];
    const mt = n > 12 ? MAIN_SEQ2[(n - 13) % MAIN_SEQ2.length] : ST.SEQ12[n - 1];
    opts.push({ id: 'm' + n, kind: 'main', level: n, diff: 1, type: mt, planet: this.mkPlanet(), ch: n <= 12 ? n : 0, mod: MAIN_MOD[n] || 'none' });
    const okT = lv => Object.keys(MTYPES).filter(t => (t !== 'flagship' || n >= 3) && !MTYPES[t].adv && (!MTYPES[t].minL || lv >= MTYPES[t].minL)), allT = lv => Object.keys(MTYPES).filter(t => !MTYPES[t].story && (!MTYPES[t].minL || lv >= MTYPES[t].minL));
    for (let d = 0; d < 4; d++) { const lv_ = max(1, max(1, n - 1) + DIFFS[d].lv); opts.push({ id: 's' + this.id(), kind: 'side', level: lv_, diff: d, type: pick(lv_ >= 10 ? allT(lv_) : okT(lv_)), planet: this.mkPlanet(), mod: pick(['none', 'none', 'none', 'asteroids', 'nebula', 'rad', 'cold', 'wells']) }); }
    for (const o of opts) { o.name = o.planet.name; if (o.ch) o.title = ST.CHAPTERS[o.ch].title; }
    this.options = opts; this.votes.clear();
  }
  startMission(m) {
    const M = this.mission = Object.assign({}, m, { wave: 0, waveT: 1.5, got: 0, need: 0, lost: 0, time: 0, bossSpawned: 0, trickle: 8, waves: 0 });
    this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.waves = []; this.zones = []; this.wells = [];
    this.resetShip(); this.phase = 'mission';
    const L = M.level;
    M.pre = M.ch && !this.seen.has(M.ch) ? 1 : 0; if (M.ch) this.seen.add(M.ch); M.cn = 0; M.used = 0; M.vT = rnd(26, 34); M.rT = 55; M.catT = 70; M.cmP = 0; M.boss2 = 0; M.boss3 = 0;
    if (M.ch >= 12 || M.type === 'finale') { M.type = 'finale'; M.trickle = 28; const bo = this.addEnemy(19, 0, -1700, L, 'dom', true); bo.boss = 1; bo.cmd = 99; bo.a = PI / 2; M.bossSpawned = 1; this.ev('cmd', 99, 0, bo.id); }
    M.fac = M.type === 'pirates' || M.type === 'hostages' || (random() < 0.3 && M.type !== 'flagship') ? 'pir' : 'dom';
    M.ext = L >= 10 ? 1 : 0;   // v6: missions past level 10 come in extended, harder forms
    if (M.type === 'pirates') M.waves = M.ext ? min(8, 3 + floor(L / 3)) : min(5, 2 + floor(L / 3));
    if (M.type === 'flagship') M.waves = M.ext ? 3 : 2;
    if (M.type === 'defend') { M.waves = M.ext ? min(8, 4 + floor(L / 3)) : min(6, 3 + floor(L / 3)); this.allies.push({ id: this.id(), k: 'fs', x: 0, y: 0, a: 0, hp: 170 + 40 * L, mhp: 170 + 40 * L, r: 90, ta: 0, gc: [0, 0.3, 0.6, 0.9], gi: 0, v: floor(random() * 4) }); this.ship.y = 260; }
    if (M.type === 'defend2') {   // v8 Twin Outposts: two friendly stations in different areas of the map; waves hit both, losing either fails the mission
      M.waves = M.ext ? min(8, 4 + floor(L / 3)) : min(6, 3 + floor(L / 3)); M.fac = random() < 0.5 ? 'pir' : 'dom'; const a0 = random() * 2 * PI, v0 = floor(random() * 4);
      for (let k = 0; k < 2; k++) { const a = a0 + k * PI; this.allies.push({ id: this.id(), k: 'fs', x: cos(a) * 1750, y: sin(a) * 1750, a: 0, hp: 150 + 35 * L, mhp: 150 + 35 * L, r: 90, ta: 0, gc: [0, 0.3, 0.6, 0.9], gi: 0, v: (v0 + 1 + 2 * k) % 4 }); }
      this.ship.x = 0; this.ship.y = 0; M.trickle = 30;
    }
    if (M.type === 'escort') {
      const a = random() * 2 * PI; M.jx = cos(a) * 3100; M.jy = sin(a) * 3100;
      const nF = M.ext ? 5 : 3; for (let k = 0; k < nF; k++) this.allies.push({ id: this.id(), k: 'fr', x: -cos(a) * 300 + (k - (nF - 1) / 2) * -sin(a) * 140, y: -sin(a) * 300 + (k - (nF - 1) / 2) * cos(a) * 140, a, hp: 34 + 5 * L, mhp: 34 + 5 * L, r: 34, spd: 48 });
    }
    if (M.type === 'hostages') {
      M.pods = M.ext ? 6 : 4; M.need = M.ext ? 5 : 3;
      for (let k = 0; k < M.pods; k++) { const a = k * 2 * PI / M.pods + rnd(-0.4, 0.4), d = rnd(650, 1700); const p = { id: this.id(), k: 'pod', x: cos(a) * d, y: sin(a) * d, a: 0, hp: 8, mhp: 8, r: 16, resc: 0 }; this.allies.push(p); for (let g = 0; g < 1 + floor(L / 3); g++) this.addEnemy(L >= 3 ? 4 : 0, p.x + rnd(-150, 150), p.y + rnd(-150, 150), L, 'pir'); }
    }
    if (M.type === 'passengers') {   // v5: long, narrow asteroid corridor; fly to the far end, pick up the passengers, bring them back
      M.bx = M.ext ? 6000 : 4000; M.by = M.ext ? 760 : 640; M.sx = -(M.bx - 400); M.px = M.bx - 400; M.pax = 0; M.trickle = 7; M.fac = 'pir';
      const sh = this.ship; sh.x = M.sx; sh.y = 0; sh.a = 0; sh.sa = 0; sh.vx = 90; sh.vy = 0; sh.spd = 90;
      this.allies.push({ id: this.id(), k: 'pax', x: M.px, y: 0, a: PI, hp: 1e6, mhp: 1e6, r: 46 });
      const rocks = []; let tries = 0;
      const nR = M.ext ? 240 : 150; while (rocks.length < nR && tries++ < 6000) { const x = rnd(-(M.bx - 650), M.bx - 650), y = rnd(-M.by + 40, M.by - 40); if (abs(x - M.px) < 330 || abs(x - M.sx) < 300 || rocks.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < 105 * 105)) continue; rocks.push([x, y]); }
      for (const [x, y] of rocks) { const e = this.addEnemy(10, x, y, L, 'dom', true); e.vx = rnd(-9, 9); e.vy = rnd(-9, 9); }
    }
    if (M.type === 'survival') { M.dur = min(240, 100 + 8 * (L - 9)); M.fac = 'dom'; M.trickle = 3; }
    if (M.type === 'bombrun') { M.waves = min(6, 3 + floor((L - 8) / 2)); M.fac = 'kam'; }
    if (M.type === 'siege') { M.trickle = 24; M.fac = 'dom'; for (let k = 0; k < 2; k++) { const a = k * PI + random() * 1.2; this.addEnemy(k ? STV[(STV.indexOf(this.enemies[0].type) + 1 + floor(random() * 3)) % 5] : pick(STV), cos(a) * 2300, sin(a) * 2300, L, M.fac, true); } M.bossSpawned = 1; this.spawnWave(L, 0, M.fac); }
    if (M.type === 'station') { M.trickle = 24; const a = random() * 2 * PI; this.addEnemy(pick(STV), cos(a) * 1900, sin(a) * 1900, L, M.fac, true); M.bossSpawned = 1; this.spawnWave(L, 0, M.fac); }
    if (M.type === 'wellstation') {   // v8 Gravity Trap: an enemy station ringed by gravity wells
      M.trickle = 26; M.fac = 'dom'; const a = random() * 2 * PI, sx = cos(a) * 1600, sy = sin(a) * 1600, st = this.addEnemy(pick(STV), sx, sy, L, M.fac, true); M.bossSpawned = 1;
      const ring = (n, R, off) => { for (let k = 0; k < n; k++) { const b = off + k * 2 * PI / n + rnd(-0.08, 0.08); this.tryWell(sx + cos(b) * R, sy + sin(b) * R); } };
      ring(9, 860, rnd(0, 6.28)); ring(12, 1520, rnd(0, 6.28)); this.spawnWave(L, 0, M.fac);
    }
    if (M.mod === 'wells' && M.type !== 'passengers' && M.type !== 'finale' && M.type !== 'wellstation') { const n = 3 + (L >= 6 ? 1 : 0) + floor(random() * 2); for (let i = 0, g = 0; i < n && g < 80; g++) { const b = random() * 2 * PI, d = rnd(900, 3300); if (this.tryWell(cos(b) * d, sin(b) * d, 480)) i++; } }
    if ((M.mod === 'rad' || M.mod === 'cold') && M.type !== 'passengers' && M.type !== 'finale') this.placeZones(M.mod);
    if (M.mod === 'asteroids') for (let i = 0; i < 14; i++) { const a = random() * 2 * PI, d = rnd(450, 3500); this.addEnemy(10, cos(a) * d, sin(a) * d, L, 'dom', true); }
    this.ev('ms', M.name, M.type, L);
  }
  endMission(win) {
    const M = this.mission, dm = DIFFS[M.diff].m;
    let bonus = 0, cores = 0;
    if (win) {
      bonus = round((15 + 5 * M.level) * dm); cores = (M.kind === 'main' ? 1 : 0) + (M.diff >= 2 ? 1 : 0) + (M.type === 'finale' ? 3 : 0);
      if (M.kind === 'main') this.mainDone = max(this.mainDone, M.level); this.failStreak = 0;
      this.grant(bonus); this.cores += cores;
    } else if (M.kind === 'main') this.failStreak++;
    this.result = { win: win ? 1 : 0, bonus, cores, name: M.name, type: M.type, ch: M.ch || 0 };
    this.phase = 'result'; this.phaseT = 2.8; this.ev(win ? 'win' : 'lose');
    this.makeOptions();
  }
  // ----- enemies -----
  addEnemy(type, x, y, L, fac, instant, bs) {
    const T = ETYPES[type], hpm = 1 + 0.2 * (L - 1) + 0.01 * (L - 1) * (L - 1);
    // v8: ships grow with the mission level (stations, rocks and the boss keep their own size)
    const fixed = isStation(type) || type === 10 || type === 5 || type === 18 || type === 19, sc = (T.sc || 1) * (fixed ? 1 : min([1.3, 1.5, 1.55, 1.6][T.sz], 1 + [0.012, 0.022, 0.028, 0.03][T.sz] * (L - 1)));
    const e = { id: this.id(), type, x: clamp(x, -this.bnd()[0] + 80, this.bnd()[0] - 80), y: clamp(y, -this.bnd()[1] + 80, this.bnd()[1] - 80), vx: 0, vy: 0, a: random() * 2 * PI, hp: T.hp * hpm, mhp: T.hp * hpm, r: T.r * sc, sc, pk: Math.sqrt(sc), L, fac: fac || 'dom',
      cd: rnd(0.6, 2.2), warp: instant ? 0 : 0.8, orbit: random() < 0.5 ? 1 : -1, paint: 0, spot: 0, tgt: null, tgtT: 0, sh: 0, shm: 0, shT: 9, bossShip: bs ? 1 : 0 };
    if (T.sh) e.sh = e.shm = T.sh * (1 + 0.12 * (L - 1)) * (T.sz >= 3 && L < 8 ? 0.6 : 1);
    { const M_ = this.mission; if (M_ && M_.kind === 'main' && M_.ch && T.mp && (isStation(type) || e.bossShip)) { const ro = ST.CHAPTERS[M_.ch].roster; if (M_.used < ro.length) { e.cmd = ro[M_.used++]; this.ev('cmd', e.cmd, 0, e.id); } } }
    if (type === 10) { e.r = rnd(26, 46); e.vx = rnd(-25, 25); e.vy = rnd(-25, 25); e.spin = rnd(-1, 1); }
    if (T.mp) {
      e.cdm = T.sz >= 2 ? (L < 6 ? 2.2 : L < 10 ? 1.5 : L < 14 ? 1.2 : 1) : 1;
      const ph = T.php * (1 + 0.2 * (L - 1)) * ((T.sz >= 3 && L < 8) ? 0.6 : 1);
      e.ports = T.ports.map(p => ({ hp: ph * (p.w === 'dock' ? 1.5 : 1), mhp: ph * (p.w === 'dock' ? 1.5 : 1), pa: p.f, cd: rnd(0.5, 2.5), ch: 0, sp: rnd(2, 5) }));
    }
    this.enemies.push(e); return e;
  }
  // v5: enemies only ever appear at a dock of a hostile ship or at the edge of the map (never mid-field)
  spawnPoint(anchor, o = {}) {
    const [bx, by] = this.bnd(), s = this.ship, docks = [];
    for (const e of this.enemies) if (!e.dead && e.ports) e.ports.forEach((p, k) => { if (p.hp > 0 && ETYPES[e.type].ports[k].w === 'dock') docks.push(this.portPos(e, k)); });
    if (docks.length && random() < 0.65 && !o.end) { const d = pick(docks); return { x: d[0], y: d[1], edge: 0 }; }
    const narrow = bx > by * 2.5; let best = null, bq = 1e18;
    for (let i = 0; i < 10; i++) {
      let x, y, side = floor(random() * 4);
      if (narrow) { x = (o.end || (random() < 0.5 ? 1 : -1)) * (bx - 100); y = rnd(-by + 100, by - 100); }
      else if (side < 2) { x = (side ? 1 : -1) * (bx - 100); y = rnd(-by + 100, by - 100); } else { y = (side === 2 ? 1 : -1) * (by - 100); x = rnd(-bx + 100, bx - 100); }
      const q = (x - anchor.x) ** 2 + (y - anchor.y) ** 2, far = (x - s.x) ** 2 + (y - s.y) ** 2 > (o.minShip || 1100) ** 2;
      if (far && q < bq) { bq = q; best = { x, y, edge: 1 }; }
    }
    if (!best) { const a = random() * 2 * PI; best = { x: clamp(cos(a) * 1e5, -bx + 100, bx - 100), y: clamp(sin(a) * 1e5, -by + 100, by - 100), edge: 1 }; }
    return best;
  }
  spawnWave(L, w, fac, anchor, o = {}) {
    const A = anchor || this.ship;
    let budget = o.budget || min(26, 2 + ceil(L * 0.9) + floor(w * 1.5)), bigs = 0; const maxBig = min(4, 1 + floor(L / 4));
    let sp = this.spawnPoint(A, o), left = 0;
    const pool = [];
    const add = (t, wt) => { if (ETYPES[t].minL <= L || ETYPES[t].minL === 99) pool.push([t, wt * (ETYPES[t].sz >= 1 ? 1 + 0.08 * L : ETYPES[t].sz === 0 && L > 4 ? max(0.55, 1 - 0.025 * L) : 1)]); };   // v8: bigger classes get likelier with level
    if (fac === 'pir') { add(4, 4); add(1, 2); add(0, 1); if (L >= 2) add(5, 1); if (L >= 3) { add(11, 1); add(6, 1.2); } if (L >= 6) add(15, 0.8); if (L >= 6) add(18, 1.0); if (L >= 8) add(7, 0.5); if (L >= 10) add(16, 0.3); }
    else if (fac === 'kam') { add(18, 6); add(1, 1.5); add(2, 1); add(4, 0.8); }
    else { add(0, max(0.4, 3 - L * 0.4)); add(1, 3); add(2, 3); add(3, 2); add(5, 1); add(11, 2); add(12, 0.35); add(6, 1.4); add(14, 1.2); add(15, 1); add(7, 0.8); add(16, 0.5); add(18, 0.9); if (L >= 10) add(8, 0.3); if (L >= 14) add(17, 0.15); }
    const tot = pool.reduce((a, p) => a + p[1], 0);
    while (budget > 0) {
      let r = random() * tot, t = pool[0][0]; for (const p of pool) { r -= p[1]; if (r <= 0) { t = p[0]; break; } }
      const sz = ETYPES[t].sz;
      if (FIGHTERS.includes(t) && budget >= 3 && random() < 0.75) { const n = min(budget, 3 + floor(random() * 4)); if (--left < 0) { if (random() < 0.5 || !sp) sp = this.spawnPoint(A, o); left = floor(rnd(1, 3)); } this.spawnSquad(t, sp, L, fac, n); budget -= n; continue; }
      if (sz >= 1) { if (bigs >= maxBig) t = 1; else { bigs++; budget -= [0, 2, 4, 7][sz]; } }
      if (--left < 0) { if (random() < 0.5 || !sp) sp = this.spawnPoint(A, o); left = floor(rnd(1, 4)); }
      const e = this.addEnemy(t, sp.x + rnd(-110, 110), sp.y + rnd(-110, 110), L, fac); if (sp.edge) e.rush = 1; budget--;
    }
  }
  // v8: portless fighters fly in squadrons of 3-6 in V (3-6 ships) or triangle (6 ships) formation
  spawnSquad(t, sp, L, fac, n) {
    const kind = n === 6 ? 'tri' : 'v', sid = this.id(), s = this.ship, face = atan2(s.y - sp.y, s.x - sp.x), S = 64;
    for (let i = 0; i < n; i++) { const [ox, oy] = formOff(i, kind, S), x = sp.x + ox * cos(face) - oy * sin(face), y = sp.y + ox * sin(face) + oy * cos(face); const e = this.addEnemy(t, x, y, L, fac); e.a = face; e.sq = sid; e.sqi = i; e.sqk = kind; if (sp.edge) e.rush = 1; }
    return sid;
  }
  squadInfo(e) { const m = this.enemies.filter(q => q.sq === e.sq && !q.dead).sort((a, b) => a.sqi - b.sqi); return { lead: m[0], rank: m.indexOf(e), n: m.length }; }
  bossType(L) { return L < 6 ? 7 : L < 10 ? 16 : L < 14 ? 8 : 17; }
  fireEB(x, y, ang, w, tg, L, extra = {}) {
    const W = WEAP[w], spd = W.spd + 4 * L;
    const mk = (a) => this.eb.push(Object.assign({ id: this.id(), x, y, vx: cos(a) * spd, vy: sin(a) * spd, t: W.t, r: W.r, life: W.life || 4, passed: 0, hv: W.heavy || W.t === 1 ? 1 : 0, home: W.home || 0, tg, spd, sd: W.sd, dm: L <= EFIRE_WEAK_LV ? EFIRE_WEAK : 1 }, extra));
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
    if (this.phase === 'lobby') {   // v8 pre-game lobby: pick characters, then Start
      this.idleCruise();
      if (this.lobbyGo > 0 && this.humans()) { this.lobbyGo -= DT; if (this.lobbyGo <= 0) { this.lobbyGo = 0; this.phase = 'intro'; this.phaseT = 80; this.ready.clear(); this.ev('intro'); } } else this.lobbyGo = 0;
    } else if (this.phase === 'intro') {   // v8 intro cutscene (played on every client); moves on when every human skipped/finished it
      this.phaseT -= DT; this.idleCruise(); const hum = this.humans();
      if (!hum || this.ready.size >= hum || this.phaseT <= 0) { this.phase = 'map'; this.phaseT = hum ? 16 : 2; this.votes.clear(); this.ready.clear(); }
    } else if (this.phase === 'map') {
      const hum = this.humans();   // v9: no timer. Launches only once every human has voted (bots never block)
      if (!hum || this.votes.size >= hum) { if (this.phaseT > 1.2) this.phaseT = 1.2; this.phaseT -= DT; }
      if (this.phaseT <= 0) this.startMission(this.chooseMission());
      this.idleCruise();
    } else if (this.phase === 'mission') {
      if (this.tickN % 3 === 0) this.botThink();
      if (!this.ship.dead) { this.simShip(); this.zoneTick(); }
      this.simWorld(); this.missionLogic();
    } else if (this.phase === 'result') {
      this.phaseT -= DT; this.simWorld();
      if (this.phaseT <= 0) {
        this.phase = 'upgrade'; this.ready.clear(); this.phaseT = this.humans() ? 45 : 1.5;
        if (!this.humans()) { if (this.mk < 3 && this.cores >= MK_COST[this.mk + 1]) this.buyMk(); if (this.mk >= 3) while (this.cores > 0) { if (this.hullPlus < 24) this.hullCore(); else this.convertCore(); } }
        for (const s of this.seats) botSpend(this, s.bot, s.idx);
        this.calcStats(); for (const c of this.clients) c.dirty = 1;
      }
    } else if (this.phase === 'upgrade') {
      this.idleCruise();   // v9: no timer. Moves on only when every human pressed Ready (bots are always ready)
      const hum = this.humans(); if (!hum || this.ready.size >= hum) { if (this.phaseT > 0.4) this.phaseT = 0.4; this.phaseT -= DT; }
      if (this.phaseT <= 0) {
        if (this.pub && !hum && Date.now() - this.emptySince > 15 * 60e3 && this.mainDone > 4) this.resetCampaign();
        this.phase = 'map'; this.phaseT = hum ? 16 : 2; this.enemies = []; this.eb = []; this.allies = []; this.picks = []; this.waves = []; this.resetShip(); this.votes.clear();
      }
    }
    if (this.rv) { this.rv.t -= DT; if (this.tickN % 10 === 0 || this.rv.t <= 0) this.rvCheck(); }
    if (++this.tickN % SEND_EVERY === 0) this.broadcast();
  }
  // v9 restart vote: any human starts it, the others vote; a majority of the humans aboard sends everyone back to the lobby for a fresh run
  restartVote(c) {
    if (this.phase === 'lobby') return 'You are already in the lobby';
    if (this.humans() <= 1) { this.rv = null; this.restartGame(); return null; }
    if (this.rv) return this.rvVote(c, 1);
    this.rv = { by: c.prof.name, pid: c.pid, yes: new Set([c.pid]), no: new Set(), t: RV_TIME }; this.ev('rv', c.prof.name); this.rvCheck(); return null;
  }
  rvVote(c, v) { const rv = this.rv; if (!rv) return 'No restart vote is running'; rv.yes.delete(c.pid); rv.no.delete(c.pid); (v ? rv.yes : rv.no).add(c.pid); this.rvCheck(); return null; }
  rvNeed() { return floor(this.humans() / 2) + 1; }
  rvCheck() {
    const rv = this.rv; if (!rv) return; const ids = new Set([...this.clients].map(c => c.pid));
    for (const S of [rv.yes, rv.no]) for (const p of [...S]) if (!ids.has(p)) S.delete(p);
    const hum = this.humans(), need = this.rvNeed();
    if (hum && rv.yes.size >= need) { this.rv = null; this.ev('rvr', 1); this.restartGame(); }
    else if (!hum || hum - rv.no.size < need || rv.t <= 0) { this.rv = null; this.ev('rvr', 0); }
  }
  // v8 Restart Game: a fresh run (ship, ports, Morph Metal, bots and every human's upgrades/credits); private ships go back to the lobby
  restartGame() {
    this.resetCampaign(); this.seenZ = {}; this.score = 0; this.t = 0; this.enemies = []; this.eb = []; this.bolts = []; this.pp = []; this.bombs = []; this.mines = []; this.picks = []; this.allies = []; this.waves = []; this.zones = []; this.wells = [];
    this.mission = null; this.result = null; this.votes.clear(); this.ready.clear();
    this.runId = newRun(); this.rv = null;
    for (const c of this.clients) { c.prof.t = {}; c.prof.cr = 0; c.prof.earned = 0; fixProf(c.prof); c.prof.run = this.runId; c.dirty = 1; }
    this.calcStats(); this.makeOptions(); this.resetShip(); this.lobbyGo = 0;
    this.phase = 'lobby'; this.phaseT = 3;   // v9: public ships too: everyone goes back to the character lobby
    this.ev('restart');
  }
  resetCampaign() { this.mainDone = 0; this.failStreak = 0; this.mk = 0; this.cores = 0; this.hullPlus = 0; this.ports = ROLES.map(() => [null, null, null]); for (const s of this.seats) s.bot = fixProf({ name: 'bot' }); this.crewEarned = 0; this.seen = new Set(); this.seenZ = {}; this.makeOptions(); }
  buyMk() { if (this.mk >= 3 || this.cores < MK_COST[this.mk + 1]) return false; this.cores -= MK_COST[this.mk + 1]; this.mk++; this.resetShip(); this.ev('mk', this.mk); for (const c of this.clients) c.dirty = 1; return true; }
  idleCruise() { const s = this.ship; s.a = wrap(s.a + 0.1 * DT); s.vx = cos(s.a) * 55; s.vy = sin(s.a) * 55; s.x += s.vx * DT; s.y += s.vy * DT; s.sa = wrap(s.sa + 0.4 * DT); }
  chooseMission() {   // v9: one vote each; a tie goes to the human pilot's pick (bot pilot: the old tiebreak)
    const tally = new Map(); let pv = null;
    for (const c of this.clients) {
      const v = this.votes.get(c.pid); if (!v) continue; const seat = this.seatOf(c); if (seat && seat.idx === PILOT) pv = v;
      const t = tally.get(v) || { w: 0, others: 0 }; t.w++; if (!(seat && seat.idx === PILOT)) t.others++; tally.set(v, t);
    }
    let top = 0; for (const t of tally.values()) top = max(top, t.w);
    const tied = [...tally].filter(([, t]) => t.w === top).map(([v]) => v);
    let best = null;
    if (tied.length === 1) best = tied[0]; else if (tied.length > 1) { if (pv && tied.includes(pv)) best = pv; else { let bt = null; for (const v of tied) { const t = tally.get(v); if (!bt || t.others > bt.others) { best = v; bt = t; } } } }
    let m = this.options.find(o => o.id === best);
    if (!m) m = this.failStreak >= 2 ? this.options[1] : this.options[0];
    return m;
  }
  bnd() { const M = this.mission; return M && M.bx ? [M.bx, M.by] : [ARENA, ARENA]; }
  hostiles() { let n = 0; for (const e of this.enemies) if (e.type !== 10 && !e.dead) n++; return n; }
  missionLogic() {
    const M = this.mission, s = this.ship; if (!M) return; M.time += DT;
    if (s.dead) { s.deadT -= DT; if (s.deadT <= 0) this.endMission(false); return; }
    const L = M.level, H = this.hostiles();
    if (M.kind === 'main') this.storyTick(M, H);
    const waveCheck = () => {
      const dfn = M.type === 'defend' || M.type === 'defend2';
      if (H === 0 || (dfn && M.waveT < -18)) {
        M.waveT -= DT;
        if (M.waveT <= 0 || dfn && M.waveT < -18) {
          if (M.wave < M.waves) { M.wave++; const fss = this.allies.filter(a => a.k === 'fs'), anc = dfn ? fss[(M.wave - 1) % max(1, fss.length)] : null; this.spawnWave(L, M.wave - 1, M.fac, anc, M.type === 'defend2' ? { budget: min(30, round((2 + ceil(L * 0.9) + floor((M.wave - 1) * 1.5)) * 1.3)) } : {}); M.waveT = 1.5; this.ev('wave', M.wave); return; }
          if (M.type === 'flagship' && !M.bossSpawned) { M.bossSpawned = 1; { const sp = this.spawnPoint(s), bo = this.addEnemy(this.bossType(L), sp.x, sp.y, L, 'dom', false, 1); bo.rush = 1; } this.spawnWave(L, 0, 'dom'); this.ev('boss'); return; }
          if (H === 0) this.endMission(true);
        }
      } else if (dfn) M.waveT -= DT;
    };
    if (M.type === 'finale') {
      const bo = this.enemies.find(e => e.type === 19 && !e.dead);
      if (!bo) return this.endMission(true);
      M.trickle -= DT; if (M.trickle <= 0 && H < 9) { M.trickle = M.boss2 ? 20 : 28; this.spawnWave(L, 0, M.boss3 ? 'kam' : 'dom', bo, { budget: 3 + M.boss2 * 2 }); }
      const fr = bo.ports.filter(p => p.hp <= 0).length / bo.ports.length;
      if (!M.boss2 && fr >= 0.45) { M.boss2 = 1; bo.sh = bo.shm * 0.4; bo.cdm *= 0.75; this.ev('boss', 2); this.spawnWave(L, 0, 'kam', bo, { budget: 6 }); }
      if (!M.boss3 && fr >= 0.8) { M.boss3 = 1; bo.cdm *= 0.7; this.ev('boss', 3); this.spawnWave(L, 0, 'kam', bo, { budget: 8 }); }
      M.stl = 1;
    }
    if (M.type === 'pirates' || M.type === 'flagship' || M.type === 'defend' || M.type === 'defend2' || M.type === 'bombrun') waveCheck();
    if (M.type === 'defend2') { M.stl = this.allies.filter(a => a.k === 'fs').length; if (M.stl < 2 && this.phase === 'mission') return this.endMission(false); }
    if (M.type === 'survival') { M.trickle -= DT; if (M.trickle <= 0 && H < 24) { M.trickle = max(5, 11 - M.time / 40); this.spawnWave(L, floor(M.time / 18), pick(['dom', 'pir', 'dom']), null, { budget: min(22, 3 + ceil(L * 0.55) + floor(M.time / 22)) }); } if (M.time >= M.dur) this.endMission(true); }
    if (M.type === 'siege') { const sts = this.enemies.filter(e => isStation(e.type) && !e.dead); M.trickle -= DT; if (sts.length && M.trickle <= 0 && H < 8) { M.trickle = 32; this.spawnWave(L, 0, M.fac, pick(sts)); } if (!sts.length && H === 0) this.endMission(true); M.stl = sts.length; }
    if (M.type === 'defend') { const fs_ = this.allies.find(a => a.k === 'fs'); if (!fs_ && this.phase === 'mission') return this.endMission(false); }
    if (M.type === 'station' || M.type === 'wellstation') {
      const st = this.enemies.find(e => isStation(e.type));
      M.trickle -= DT; if (st && M.trickle <= 0 && H < 6) { M.trickle = 40; this.spawnWave(L, 0, M.fac, st); }
      if (!st && H === 0) this.endMission(true);
    }
    if (M.type === 'escort') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 14) { M.trickle = 14; const f = this.allies.find(a => a.k === 'fr'); this.spawnWave(L, floor(M.time / 35), M.fac, f || s); }
      const alive = this.allies.filter(a => a.k === 'fr').length;
      if (!alive) this.endMission(M.got >= 1);
    }
    if (M.type === 'passengers') {
      const px = this.allies.find(a => a.k === 'pax');
      if (!M.pax && px && d2(px, s) < 150 * 150) { M.pax = 1; px.dead = 1; this.grant(6 * DIFFS[M.diff].m); this.ev('pax', round(px.x), round(px.y)); this.spawnWave(L, 0, 'pir', s, { budget: min(7, 2 + floor(L / 3)), end: 1 }); M.trickle = 16; }
      M.trickle -= DT; if (M.trickle <= 0 && H < 4) { M.trickle = 20; this.spawnWave(L, 0, 'pir', s, { budget: min(6, 1 + ceil(L / 3)), end: M.pax ? -1 : 1 }); }
      if (M.pax && s.x < M.sx + 420) this.endMission(true);
    }
    if (M.type === 'hostages') {
      M.trickle -= DT; if (M.trickle <= 0 && H < 10) { M.trickle = 16; this.spawnWave(L, 0, 'pir'); }
      if (M.lost > M.pods - M.need) return this.endMission(false);
      if (!this.allies.some(a => a.k === 'pod')) this.endMission(M.got >= M.need);
    }
  }
  // v7 story: commander ships, villain taunts and reinforcements, Mireth (cat) help. The client owns all dialogue text; the server only sends small event ids.
  storyTick(M, H) {
    const s = this.ship, L = M.level, C = M.ch ? ST.CHAPTERS[M.ch] : null, seed = () => floor(random() * 1000);
    if (C && C.cs && !M.csDone && M.time >= C.cs.t && M.type !== 'finale') { M.csDone = 1; const sp = this.spawnPoint(s), e = this.addEnemy(C.cs.type, sp.x, sp.y, L, 'dom'); e.rush = 1; e.cmd = C.cs.cmd; M.used++; this.ev('cmd', e.cmd, 0, e.id); }
    if (M.ch >= 2 && M.type !== 'finale') { M.vT -= DT; if (M.vT <= 0) { M.vT = rnd(30, 44); this.ev('comm', 'v', seed(), 0); } }
    if (M.ch >= 3 && M.type !== 'finale' && M.type !== 'passengers' && M.type !== 'survival') { M.rT -= DT; if ((M.rc || 0) < 2 && M.rT <= 0 && H < 12) { M.rT = 80; M.rc = (M.rc || 0) + 1; this.spawnWave(L, 0, 'dom', null, { budget: 3 + floor(L / 3) }); this.ev('comm', 'v', seed(), 1); } }
    if (M.ch >= 2 && !M.catDone) { M.catT -= DT; if (M.catT <= 0 && !s.dead) { M.catDone = 1; let gift = 0; if (s.hull < s.hm * 0.85) { s.hull = min(s.hm, s.hull + 6); gift = 1; for (let k = 0; k < 5; k++) this.dropCredits(s.x + rnd(-120, 120), s.y + rnd(-120, 120), 3 + M.ch); } this.ev('comm', 'c', seed(), gift); } }
  }
  // ----- ship -----
  inp(i) { return this.seats[i].cur; }
  up(i) { return !this.ship.sec[i].dn; }
  busy(i) { return false; }
  can(i) { return this.up(i) && !this.busy(i); }
  shieldUp() { const s = this.ship; return this.up(SHIELD) && s.shDown <= 0 && s.shp > 0; }
  secDamaged(k) { return this.secExists(k) && this.ship.sec[k].hp < this.secMax(k) - 1e-6; }
  repairPriority() {
    const s = this.ship, ord = [SHIELD, PILOT, ENG, GUNL, GUNR, REPAIR];
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
    if (i === REPAIR && a === 'dr') { if (this.up(REPAIR)) { s.droneOff = s.droneOff ? 0 : 1; this.ev('dr', s.droneOff); } return; }
    if (i === ENG && this.up(ENG)) {   // v5: u1-u4 add a slot to an option, d1-d4 remove one, z clears (max 10 in total)
      const P = s.pip, k = +a[1] - 1;
      if (a === 'z') { s.pip = [0, 0, 0, 0]; this.ev('pip'); return; }
      if (a[0] === 'u' && k >= 0 && k < 4 && this.rrUsed() < RR_CFG.max && P[k] < RR_CFG.max) { P[k]++; this.ev('pip'); }
      else if (a[0] === 'd' && k >= 0 && k < 4 && P[k] > 0) { P[k]--; this.ev('pip'); }
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
      case 'bomb': case 'seismic': { const big = ab === 'seismic'; let dx = I.ax - s.x, dy = I.ay - s.y, d = hypot(dx, dy) || 1; const r = min(d, 650), nb = 1 + (big ? 0 : round(this.S(ENG, 'bombN')));
        for (let q = 0; q < nb; q++) { const aa = atan2(dy, dx) + (q - (nb - 1) / 2) * 0.22, rr_ = r * (1 - 0.06 * q);
          this.bombs.push({ id: this.id(), x: s.x, y: s.y, tx: s.x + cos(aa) * rr_, ty: s.y + sin(aa) * rr_, rad: (big ? 300 : BOMB_CFG.rad) * (1 + this.S(ENG, 'bombRad')), dmg: (big ? 22 : BOMB_CFG.dmg) * (1 + this.S(ENG, 'bombDmg')), cl: !big && this.S(ENG, 'bombRad') > 0, spd: big ? 420 : 520 }); }
        cd *= 1 - min(0.5, this.S(ENG, 'bombCd')); this.ev('bl'); break; }
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
      case 'warp': { const ox = s.x, oy = s.y, [BX_, BY_] = this.bnd(); s.x = clamp(s.x + cos(aimW) * 380, -BX_ + 60, BX_ - 60); s.y = clamp(s.y + sin(aimW) * 380, -BY_ + 60, BY_ - 60); s.inv = max(s.inv, 1); this.ev('warp', round(ox), round(oy), round(s.x), round(s.y)); break; }
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
    for (const k of ['inv', 'bubble', 'aegis', 'burn', 'reroute', 'dod', 'nose', 'gl', 'gr', 'strafe', 'swarm', 'fort', 'ionCd']) s[k] -= DT;
    if (s.stun > 0) s.stun -= DT; const stn = s.stun > 0;
    for (const k in s.gp) s.gp[k] -= DT;
    s.roll = (s.roll || 0) * 0.9; s.beam = {};
    const up = i => !s.sec[i].dn;
    // energy (v5): only the Engineer's rerouting uses it. Each filled slot drains it, more slots drain faster per slot. Depleted = 20 s lockout: rerouting off, 25% engine thrust.
    const aux = this.portEff(ENG, 'aux');
    s.em = 100 + this.S(ENG, 'emax') + 25 * aux + this.pu(ENG, 'aux', 'cap');
    const regen = RR_CFG.base * min(RR_CFG.regenCap, 1 + this.S(ENG, 'regen') + 0.35 * aux) * (1 + this.pu(ENG, 'aux', 'regen')) * (up(ENG) ? 1 : 0.6);
    if (s.lock > 0) { s.lock -= DT; s.en = min(s.em, s.en + s.em / RR_CFG.lock * DT); if (s.lock <= 0) { s.lock = 0; s.en = s.em; this.ev('pwr', 1); } }
    else {
      const drain = (up(ENG) ? RR_CFG.base * RR_CFG.drain[this.rrUsed()] * this.drainM() : 0) + this.thrDrain();
      s.en = min(s.em, s.en + (regen - drain) * DT);
      if (s.en <= 0) { s.en = 0; s.lock = RR_CFG.lock; this.ev('pwr', 0); }
    }
    // v8 Flare Dispenser port: shoots down enemy missiles that come close
    if (this.portEff(ENG, 'flare') > 0) { s.flT -= DT; if (s.flT <= 0) { const rg = 230 * (1 + this.pu(ENG, 'flare', 'range')); let n = 0; for (const b of this.eb) if (!b.dead && b.t === 1 && d2(b, s) < rg * rg) { b.dead = 1; n++; this.ev('pd', round(b.x), round(b.y), b.t); } if (n) { this.ev('flare', round(s.x), round(s.y)); s.flT = 5 * (1 - this.pu(ENG, 'flare', 'rate')); } else s.flT = 0.2; } }
    // v9 EMP Projector port: periodically stuns every enemy close to the ship
    if (this.portEff(ENG, 'emp') > 0) { s.empT = (s.empT == null ? 4 : s.empT) - DT; if (s.empT <= 0) { const rg = 300 * (1 + this.pu(ENG, 'emp', 'range')) * (this.portEff(ENG, 'emp') > 1 ? 1.1 : 1), dur = 1.6 * (1 + this.pu(ENG, 'emp', 'dur')); let n = 0; for (const e of this.enemies) if (!e.dead && !(e.imm > 0) && d2(e, s) < rg * rg) { e.stun = max(e.stun || 0, e.boss ? dur * 0.4 : dur); n++; } if (n) { this.ev('emp', round(s.x), round(s.y), round(rg)); s.empT = 14 * (1 - this.pu(ENG, 'emp', 'rate')); } else s.empT = 0.5; } }
    // helm: pilot only. Cockpit destroyed => the ship keeps its heading, no steering at all
    if (this.can(PILOT) && !stn) {
      const turn = 1.7 * (1 - 0.1 * mk) * (1 + this.S(PILOT, 'turn')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * (1 + 0.25 * this.portEff(PILOT, 'gyro') + this.pu(PILOT, 'gyro', 'turn'));
      const dx = P.ax - s.x, dy = P.ay - s.y; if (dx * dx + dy * dy > 900) s.a = wrap(s.a + clamp(wrap(atan2(dy, dx) - s.a), -turn * DT, turn * DT));
    }
    // speed: engineer only. Engines destroyed => slow stall to zero
    if (this.can(ENG)) { const want = clamp(E.thr, 0.25, 1), rr = THR_RATE * (1 + this.portEff(ENG, 'flywheel') + this.pu(ENG, 'flywheel', 'resp')); s.thr += clamp(want - s.thr, -rr * DT, rr * DT); }   // v9: engines spool slowly toward the set throttle
    const zk = this.zoneAt(s.x, s.y), cold = zk === 'cold' ? HAZ.cold.slow : 1, bst = this.portEff(ENG, 'boost');
    const maxSp = 185 * (1 - 0.06 * mk) * (1 + this.S(ENG, 'speed') + 0.12 * bst + this.pu(ENG, 'boost', 'speed') + 0.04 * this.portEff(ENG, 'flywheel') + this.pu(ENG, 'flywheel', 'speed')) * this.pipF(0) * (this.bf(ENG, 'stim') ? 1.25 : 1) * cold;
    if (up(ENG)) { const cap = s.lock > 0 || stn ? RR_CFG.lockThr : 1, ac = 170 * 0.6 * (1 + 0.6 * this.portEff(ENG, 'flywheel')) * (1 + RR_CFG.acc * this.rrLv(0) * this.pe() + 0.25 * bst + this.pu(ENG, 'boost', 'burn')) * (cold < 1 ? 1.6 : 1) * DT; const tgt = maxSp * min(s.thr, cap) * (s.burn > 0 && s.lock <= 0 ? 1.8 : 1); s.spd += clamp(tgt - s.spd, -ac, ac); }
    else { const tgt = maxSp * this.S(ENG, 'limp') * s.thr; s.spd = s.spd > tgt ? max(tgt, s.spd - 22 * DT) : tgt; }
    const k = min(1, 2.4 * DT);
    s.vx += (cos(s.a) * s.spd - s.vx) * k; s.vy += (sin(s.a) * s.spd - s.vy) * k;
    s.x += s.vx * DT; s.y += s.vy * DT;
    // v8 strafe thrusters (pilot Z / X): a weak, slow sideways shift. Not a port and cannot be destroyed, but dead while the engines are down (also weak while stunned / power-starved)
    { const want = this.can(PILOT) && up(ENG) && !stn ? clamp(P.sx || 0, -1, 1) * STRAFE_SPD * this.strafeM() * (s.lock > 0 ? 0.4 : 1) * (cold < 1 ? 0.6 : 1) : 0; s.lat += (want - s.lat) * min(1, 3 * DT); if (abs(s.lat) < 0.5 && !want) s.lat = 0; if (s.lat) { s.x += -sin(s.a) * s.lat * DT; s.y += cos(s.a) * s.lat * DT; } }
    const [BX, BY] = this.bnd(), BXm = BX - 40, BYm = BY - 40;
    if (s.x < -BXm || s.x > BXm) { s.x = clamp(s.x, -BXm, BXm); s.vx = -s.vx * 0.5; s.a = wrap(PI - s.a); }
    if (s.y < -BYm || s.y > BYm) { s.y = clamp(s.y, -BYm, BYm); s.vy = -s.vy * 0.5; s.a = wrap(-s.a); }
    // nose laser + pilot ports
    if (this.can(PILOT) && P.f && s.nose <= 0 && !stn) {
      const rate = 2.6 * (1 + this.S(PILOT, 'nRate')) * (this.bf(PILOT, 'stim') ? 1.4 : 1) * this.crewM(PILOT) * (s.strafe > 0 ? 3 : 1) * ((s.sec[GUNL].dn || s.sec[GUNR].dn) ? 1.4 : 1);
      s.nose = 1 / rate; s.noseN++;
      const dmg = 1.6 * (1 + this.S(PILOT, 'nDmg')), pier = this.S(PILOT, 'nPierce'), life = NOSE_LIFE * (1 + this.S(PILOT, 'nRange'));
      let a = s.a;
      if (this.big(PILOT, 'b_tc')) { let best = null, bd = 0.27; for (const e of this.enemies) { if (e.dead || e.warp > 0 || d2(e, s) > 7e5) continue; const q = abs(wrap(atan2(e.y - s.y, e.x - s.x) - s.a)); if (q < bd) { bd = q; best = e; } } if (best) a = atan2(best.y - s.y, best.x - s.x); }
      const nl = g.st[0][0] + 12;
      this.addBolt(s.x + cos(s.a) * nl, s.y + sin(s.a) * nl, a, BOLT_SPD, dmg, pier, 2, life);
      for (const p of this.activePorts(PILOT)) {
        const [px, py] = this.secWorld(p.k);
        if (p.id === 'twin') { const nb = 1 + round(this.pu(PILOT, 'twin', 'barrels')), pr = round(this.pu(PILOT, 'twin', 'pierce')); for (let q = 0; q < nb; q++) this.addBolt(px, py, a + (q - (nb - 1) / 2) * 0.07, BOLT_SPD, dmg * 0.8 * (1 + this.pu(PILOT, 'twin', 'dmg')), pr, 2, life); }
        else if (p.id === 'rockets' && s.noseN % max(2, 4 - round(this.pu(PILOT, 'rockets', 'loader'))) === 0) { const sk = round(this.pu(PILOT, 'rockets', 'seeker')); this.addRocket(px, py, s.a, 4 * dmg * (1 + this.pu(PILOT, 'rockets', 'dmg')), sk ? 0.6 + 0.7 * sk : 0, 70, 1); }
        else if (p.id === 'scatter' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.2 * (1 - this.pu(PILOT, 'scatter', 'cycle')); const n = 5 + round(this.pu(PILOT, 'scatter', 'fan')), sp = (0.36 + 0.04 * (n - 5)) / (n - 1); for (let q = 0; q < n; q++) this.addBolt(px, py, a + (q - (n - 1) / 2) * sp, BOLT_SPD * 0.9, dmg * 0.8 * (1 + this.pu(PILOT, 'scatter', 'dmg')), 0, 2, life * 0.6 * (1 + this.pu(PILOT, 'scatter', 'range'))); }
      }
    }
    // v8 pilot ports with their own cadence: Homing Missiles (45 degrees off the nose, alternating), Pulse Array, Lance Cannon
    if (this.can(PILOT) && P.f && !stn) {
      const dmgP = 1.6 * (1 + this.S(PILOT, 'nDmg')), life = NOSE_LIFE * (1 + this.S(PILOT, 'nRange')), rm = this.crewM(PILOT) * (this.bf(PILOT, 'stim') ? 1.3 : 1) * (s.strafe > 0 ? 2 : 1);
      for (const p of this.activePorts(PILOT)) {
        const [px, py] = this.secWorld(p.k), PU = o => this.pu(PILOT, p.id, o);
        if (p.id === 'hmsl' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 0.85 * (1 - PU('reload')) / rm; s.hmN++; const side = s.hmN % 2 ? 1 : -1; this.addMissile(px, py, s.a + side * PI / 4, 3.4 * dmgP * (1 + PU('dmg')), 5.2 * (1 + PU('turn')), 2.5 * (1 + PU('range')), side); }
        else if (p.id === 'pulse' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 0.17 * (1 - PU('rate')) / rm; this.addBolt(px, py, s.a + rnd(-0.03, 0.03), 1000, 0.5 * dmgP * (1 + PU('dmg')) * p.f, 0, 2, life * 1.2 * (1 + PU('range'))); }
        else if (p.id === 'needle' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 0.09 * (1 - PU('rate')) / rm; const sp = 0.09 * max(0.3, 1 - PU('spread')); this.addBolt(px, py, s.a + rnd(-sp, sp), 1250, 0.32 * dmgP * (1 + PU('dmg')) * p.f, 0, 2, life * 0.8 * (1 + PU('spread'))); }
        else if (p.id === 'swarm' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 2.6 * (1 - PU('reload')) / rm; const n = 3 + round(PU('count')); for (let q = 0; q < n; q++) { const side = q % 2 ? 1 : -1; this.addMissile(px, py, s.a + side * (0.45 + 0.2 * q), 1.5 * dmgP * (1 + PU('dmg')) * p.f, 4.2, 2.0, side); } }
        else if (p.id === 'lance' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.5 * (1 - PU('rate')) / rm; const B = this.addBolt(px, py, s.a, 1150, 3.6 * dmgP * (1 + PU('dmg')) * p.f, 2 + round(PU('pierce')), 7, life * 1.5); }
      }
    }
    // turrets
    for (const [gi, key, cdk, side] of [[GUNL, 'tl', 'gl', -1], [GUNR, 'tr', 'gr', 1]]) {
      if (!this.can(gi) || stn) continue;
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
      const gk = gi === GUNL ? 3 : 1;   // v6: port gunner bolts are orange (kind 3), starboard gunner bolts bright red (kind 1)
      const rate = 2.8 * (1 + this.S(gi, 'rof')) * this.crewM(gi) * (sb.rapid > 0 ? 2 : 1) * (rr ? 1.5 : rh ? 1.25 : 1) * stim * (s.sec[other].dn ? 1.25 : 1) * (sb.supp > 0 ? 1.6 : 1) ;
      let firedNow = null;
      if (G.f && s[cdk] <= 0) {
        s[cdk] = 1 / rate;
        let pier = this.S(gi, 'pierce') + (sb.supp > 0 ? 1 : 0), dm = dmgM * (random() < crit ? 2 : 1);
        if (seat.dead > 0) { dm *= 4; pier += 2; seat.dead--; }
        if (this.big(gi, 'b_twin')) for (const o of [-4, 4]) this.addBolt(px + cos(wa) * 14 - sin(wa) * o, py + sin(wa) * 14 + cos(wa) * o, wa, BOLT_SPD, dm, pier, gk, life, pd, brk);
        else this.addBolt(px + cos(wa) * 14, py + sin(wa) * 14, wa, BOLT_SPD, dm, pier, gk, life, pd, brk);
        firedNow = { dm, pier };
      }
      // the gunner's extra port turrets: each aims at the cursor from its own mount and fires in tandem
      const mounts = [[px, py, wa]];
      for (const p of this.activePorts(gi)) {
        const [qx0, qy0] = this.secWorld(p.k), ta = atan2(G.ay - qy0, G.ax - qx0), cur = s.pang[p.k] == null ? ta : s.pang[p.k];
        const na = s.pang[p.k] = wrap(cur + clamp(wrap(ta - cur), -4 * DT, 4 * DT)); mounts.push([qx0, qy0, na]);
        if (!G.f) continue;
        const PU = o => this.pu(gi, p.id, o), rm = this.crewM(gi) * (sb.rapid > 0 ? 2 : 1) * stim * (sb.supp > 0 ? 1.6 : 1);
        // v9 Port 3 Double Barrel: the port fires every round twice, from two barrels side by side
        const g0 = s.gp[p.k] || 0, nbar = p.sl === 2 && p.u.dbl ? 2 : 1;
        for (let bi = 0; bi < nbar; bi++) {
          if (bi) s.gp[p.k] = g0; const bo = nbar > 1 ? (bi ? 7 : -7) : 0, qx = qx0 - sin(na) * bo, qy = qy0 + cos(na) * bo;
          if (p.id === 'rockets' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.6 * (1 - PU('reload')) / rm; this.addRocket(qx, qy, na, 5 * dmgM * (1 + PU('dmg')), 1, 70 * (1 + PU('blast'))); }
          else if (p.id === 'scatter' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 1.1 * (1 - PU('cycle')) / rm; const n = 5 + round(PU('fan')), sp = (0.4 + 0.04 * (n - 5)) / (n - 1); for (let q = 0; q < n; q++) this.addBolt(qx, qy, na + (q - (n - 1) / 2) * sp, BOLT_SPD * 0.9, 0.8 * dmgM * (1 + PU('dmg')), 0, gk, life * 0.55 * (1 + PU('range')), 0, brk); }
          else if (p.id === 'flak' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 0.75 * (1 - PU('reload')) / rm; this.addFlak(qx, qy, na + rnd(-0.04, 0.04), 2.2 * dmgM * (1 + PU('dmg')), 85 * (1 + PU('blast')), 0.62 * (1 + this.S(gi, 'range') * 0.5) * (1 + PU('range'))); }
          else if (p.id === 'beam') this.fireBeam(p.k, qx, qy, na, 3 * dmgM * (1 + PU('dmg')) * this.crewM(gi), brk * (1 + PU('cutter')), 330 * (1 + PU('range')));
          else if (p.id === 'sniper' && (s.gp[p.k] || 0) <= 0) { // v6 Sniper Turret: slow, very fast bright rail shot, high damage, pierces
            s.gp[p.k] = 2.6 * (1 - PU('reload')) / rm; const sd = dmgM * 3.4 * (1 + PU('dmg')) * (random() < PU('crit') ? 2 : 1);
            this.addBolt(qx + cos(na) * 16, qy + sin(na) * 16, na, 1900, sd, 1 + round(PU('pierce')), 5, 0.85 * (1 + this.S(gi, 'range') * 0.5), 0, brk * 1.4); this.ev('snp', round(qx), round(qy)); }
          else if (p.id === 'laser' && (s.gp[p.k] || 0) <= 0) { // v6 extra Laser Cannon: same shot as the starting cannon
            s.gp[p.k] = 1 / (rate * (1 + PU('rof'))); const nb = 1 + round(PU('twin')), lf = life * (1 + PU('range'));
            for (let q = 0; q < nb; q++) { const o = (q - (nb - 1) / 2) * 8; this.addBolt(qx + cos(na) * 12 - sin(na) * o, qy + sin(na) * 12 + cos(na) * o, na, BOLT_SPD, dmgM * (1 + PU('dmg')) * (random() < crit ? 2 : 1), this.S(gi, 'pierce'), gk, lf, pd, brk); } }
        }
      }
      if (seat.barr > 0) { seat.barrT -= DT; if (seat.barrT <= 0) { seat.barrT = 0.3; seat.barr--; for (const [mx, my, ma] of mounts) for (let q = -3; q <= 3; q++) this.addBolt(mx, my, ma + q * 0.08, BOLT_SPD, dmgM, 0, gk, life, 0, brk); } }
    }
    // shield: blue arc aimed in WORLD space by the shield player (ship turning does not move it)
    s.shm = this.shieldMax(); if (s.shp > s.shm) s.shp = s.shm;
    if (s.shDown > 0) { s.shDown -= DT * this.pipF(2) / max(0.3, 1 - this.pu(SHIELD, 'capbank', 'reset') - 0.25 * min(1, this.portEff(SHIELD, 'harden')) - this.pu(SHIELD, 'harden', 'reset')); if (s.shDown <= 0) { s.shDown = 0; s.shp = s.shm; this.ev('shu'); } }
    s.shHit += DT;
    if (s.shDown <= 0 && s.shHit > 3) s.shp = min(s.shm, s.shp + (0.12 + this.S(SHIELD, 'shRegen') + 0.1 * this.portEff(SHIELD, 'capbank') + this.pu(SHIELD, 'capbank', 'regen') + 0.25 * this.portEff(SHIELD, 'coil') + this.pu(SHIELD, 'coil', 'regen')) * this.pipF(2) * DT);
    // v9 Shield Pulse port: every 9 s a pulse wipes out enemy shots close to the ship
    if (this.portEff(SHIELD, 'pulsar') > 0 && s.shDown <= 0) { s.puT = (s.puT == null ? 3 : s.puT) - DT; if (s.puT <= 0) { const rg = 220 * (1 + this.pu(SHIELD, 'pulsar', 'range')) * (this.portEff(SHIELD, 'pulsar') > 1 ? 1.15 : 1); let n = 0; for (const b of this.eb) if (!b.dead && d2(b, s) < rg * rg) { b.dead = 1; n++; } if (n) { this.ev('spulse', round(s.x), round(s.y), round(rg)); s.puT = 9 * (1 - this.pu(SHIELD, 'pulsar', 'rate')); } else s.puT = 0.25; } }
    if (this.can(SHIELD) && Sh.f && !stn && s.ionCd <= 0 && s.shDown <= 0 && s.shp > this.ionCost() + 0.5) { // v7: the Shield player's ion bolt (click): costs shield strength
      s.ionCd = ION_CD * this.ionCdM(); s.shp -= this.ionCost(); s.shHit = 0; const ia = s.sa, sx = s.x + cos(ia) * (g.sr + 6), sy = s.y + sin(ia) * (g.sr + 6);
      const B = this.addBolt(sx, sy, ia, WEAP.pion.spd, 0, 0, 6, WEAP.pion.life); if (B) B.ion = 1; this.ev('ionf', round(sx), round(sy), round(ia * 100) / 100);
    }
    if (this.can(SHIELD)) {
      const tgt = atan2(Sh.ay - s.y, Sh.ax - s.x), spin = 3 * (1 + this.S(SHIELD, 'shSpin')) * (this.bf(SHIELD, 'stim') ? 1.4 : 1) * 1;
      s.sa = wrap(s.sa + clamp(wrap(tgt - s.sa), -spin * DT, spin * DT));
    }
    // engineer port: mines
    for (const p of this.activePorts(ENG)) if (p.id === 'mines' && (s.gp[p.k] || 0) <= 0) { s.gp[p.k] = 3.5 * (1 - this.pu(ENG, 'mines', 'rate')); const [mx, my] = this.secWorld(p.k); this.mines.push({ id: this.id(), x: mx, y: my, life: 22 * (1 + this.pu(ENG, 'mines', 'life')), dmg: 5 * (1 + this.pu(ENG, 'mines', 'dmg')) }); }
    // ---- repair (v4) ----
    // The repair player clicks a damaged section (R.rt) to start it; it then heals automatically. A per-section minigame (client side, reported as R.mb 0..1) adds
    // up to +100%, and DISABLING the drone adds +50%. The repair player can never repair the Repair Bay while it is destroyed (and can do nothing at all then).
    // Everybody else can only help with the Repair Bay itself: rapid clicks (ck) and bot helpers.
    const rq = this.pipF(3) * (1 + this.S(REPAIR, 'rep')) * (this.bf(REPAIR, 'cry') ? 1.25 : 1) * (this.bf(REPAIR, 'rally') ? 1.3 : 1) * (this.bf(REPAIR, 'stim') ? 1.4 : 1) * (1 + 0.25 * this.portEff(REPAIR, 'nanites') + this.pu(REPAIR, 'nanites', 'speed'));
    const T = s.task;
    if (this.can(REPAIR)) {
      const rt = R.rt, valid = (rt >= 0 && rt < NSEC && this.secDamaged(rt)) || (rt === HULL_T && s.hull < s.hm - 0.05);
      const tg = valid ? rt : -1;
      if (tg !== T.i) { T.i = tg; T.t0 = this.t; }
      const mult = rq * (1 + REPAIR_CFG.mgMax * clamp(R.mb || 0, 0, 1) * (1 + this.S(REPAIR, 'band') * 0.5)) * (s.droneOff ? REPAIR_CFG.drone : 1);
      T.mult = mult;
      if (tg >= 0) {
        if (tg === HULL_T) s.hull = min(s.hm, s.hull + s.hm / (REPAIR_CFG.base * 4) * mult * DT);
        else this.healSec(tg, this.secMax(tg) / REPAIR_CFG.base * mult * DT);
      }
      const hreg = (0.03 + this.S(REPAIR, 'hullRegen')) * (1 + 2 * (this.portEff(REPAIR, 'welder') > 0 ? 1 : 0)) * (1 + this.pu(REPAIR, 'welder', 'hull') + this.pu(REPAIR, 'nanites', 'hull')) + 0.12 * this.portEff(REPAIR, 'hregen') * (1 + this.pu(REPAIR, 'hregen', 'hull'));
      { const mend = this.pu(REPAIR, 'welder', 'mend') + this.pu(REPAIR, 'foam', 'heal') + this.pu(REPAIR, 'hregen', 'mend') + this.pu(REPAIR, 'bulk', 'mend'); if (mend > 0) for (let k = 0; k < NSEC; k++) if (this.secExists(k) && !s.sec[k].dn && this.secDamaged(k)) this.healSec(k, mend * DT); }
      s.hull = min(s.hm, s.hull + hreg * DT);
    } else { T.i = -1; T.mult = 0; }
    // helping the Repair Bay when it is destroyed: normal rate needs every other seat active (about 5 clicks/s each); one helper is slow
    if (s.sec[REPAIR].dn) {
      let cps = 0;
      for (let i = 0; i < 6; i++) {
        if (i === REPAIR) continue; const st = this.seats[i], h = st.human;
        if (h && !h.inp.idle) { cps += h.inp.ck; h.inp.ck = 0; }
        else cps += REPAIR_CFG.botCps * DT;
      }
      this.healSec(REPAIR, this.secMax(REPAIR) / REPAIR_CFG.clickDiv * cps * (1 + this.S(REPAIR, 'selfPatch')) * (1 + 0.5 * this.S(REPAIR, 'rep')));
      this.help += (cps / DT / 25 - this.help) * 0.1;
    } else { this.help = 0; for (let i = 0; i < 6; i++) { const h = this.seats[i].human; if (h) h.inp.ck = 0; } }
    if (this.big(REPAIR, 'b_auto')) for (let k = 0; k < NSEC; k++) if (this.secExists(k) && s.sec[k].dn) this.healSec(k, this.secMax(k) / 40 * DT);
    // drones: out whenever the repair bay works and the repair player has not disabled them (they may fly while the ship is damaged)
    const nD = min(6, (!s.droneOff && up(REPAIR) ? 1 + this.S(REPAIR, 'drones') + (this.portEff(REPAIR, 'drone2') > 0 ? 1 : 0) : 0) + (s.swarm > 0 && up(REPAIR) ? 3 : 0));
    // v5: drones are self-controlled little starships. They orbit the ship, dash to the nearest enemy and burn it with a short-range laser beam, and they pick up credits and items.
    const dl = (1 + this.S(REPAIR, 'dDmg')) * (1 + this.pu(REPAIR, 'drone2', 'dmg')), dhp = 5 + this.S(REPAIR, 'dHp') + round(this.pu(REPAIR, 'drone2', 'plating'));
    // v6: lower starting damage (was 2.6/s) and a bit slower flight (was 340 px/s)
    const dps = DRONE_CFG.dps * dl * (1 + this.S(REPAIR, 'dRate')) * (s.dod > 0 ? 2 : 1) * this.crewM(REPAIR), BEAM = 190, passM = this.mission && this.mission.type === 'passengers';
    const dspd = DRONE_CFG.spd * (1 + this.pu(REPAIR, 'drone2', 'thrust')) * (s.dod > 0 ? 1.5 : 1);
    while (s.drones.length < 6) s.drones.push({ x: s.x, y: s.y, hp: dhp, mhp: dhp, on: 0, cd: 0, fc: 0, mc: 3, a: 0, fi: 0 });
    // v6: the repair player can click anywhere to send the drones to that spot (they hold it, fire from there and grab loot around it); otherwise they fly on their own
    const dg = s.dg; if (dg) { dg.t -= DT; if (dg.t <= 0 || !nD) s.dg = null; }
    const live = s.drones.filter(d => d.on).length;
    let slot = 0;
    s.drones.forEach((Dr, k) => {
      Dr.cd -= DT; Dr.mc -= DT; Dr.fi = 0;
      const want = k < nD && Dr.cd <= 0;
      if (want && !Dr.on) { Dr.on = 1; Dr.hp = Dr.mhp = dhp; Dr.x = s.x + cos(k * 1.3) * 14; Dr.y = s.y + sin(k * 1.3) * 14; this.ev('launch'); }
      if (!want && Dr.on) { Dr.on = 0; this.ev('recall'); }
      if (!Dr.on) { Dr.x = s.x; Dr.y = s.y; return; }
      Dr.mhp = dhp;
      const D0 = s.dg, my = slot++;
      let tg = null, bd = 620 * 620;
      if (D0) { bd = (BEAM + 70) ** 2; for (const e of this.enemies) { if (e.dead || e.warp > 0) continue; if (e.type === 10 && !passM) continue; const q = d2(e, Dr); if (q < bd) { bd = q; tg = e; } } }
      else for (const e of this.enemies) { if (e.dead || e.warp > 0) continue; if (e.type === 10 && !(passM && d2(e, s) < 330 * 330)) continue; const q = d2(e, Dr) + d2(e, s) * 0.3; if (q < bd && d2(e, s) < 700 * 700) { bd = q; tg = e; } }
      let pk = null; if (D0) { let pd = 190 * 190; for (const p of this.picks) { if (p.dead) continue; const q = d2(p, D0); if (q < pd) { pd = q; pk = p; } } }
      else if (!tg || d2(tg, Dr) > 260 * 260) { let pd = 520 * 520; for (const p of this.picks) { if (p.dead) continue; const q = d2(p, Dr); if (q < pd && d2(p, s) < 800 * 800) { pd = q; pk = p; } } }
      const oa = k * 1.05 + this.t * 0.6, hx = s.x + cos(oa) * (95 + 24 * k), hy = s.y + sin(oa) * (95 + 24 * k);
      let gx = hx, gy = hy, face = Dr.a;
      if (D0) { const n = max(1, live), ang = my / n * 2 * PI + 0.6, rad = n > 1 ? max(34, n * 17) : 0; gx = D0.x + cos(ang) * rad; gy = D0.y + sin(ang) * rad; if (pk) { gx = pk.x; gy = pk.y; } }
      else if (pk && !tg) { gx = pk.x; gy = pk.y; }
      else if (tg) { const ex = tg.x - Dr.x, ey = tg.y - Dr.y, ed = hypot(ex, ey) || 1, stand = (tg.r || 20) * (ETYPES[tg.type].mp ? 0.7 : 0.4) + 120, lat = (my - (live - 1) / 2) * 52; gx = tg.x - ex / ed * stand - ey / ed * lat; gy = tg.y - ey / ed * stand + ex / ed * lat; }
      // separation steering: drones push away from each other so they never stack and you can always count them
      let rx = 0, ry = 0; for (const O of s.drones) { if (O === Dr || !O.on) continue; const ox = Dr.x - O.x, oy = Dr.y - O.y, od = hypot(ox, oy) || 0.01; if (od < DRONE_CFG.sep * 2.2) { const f = (DRONE_CFG.sep * 2.2 - od) / (DRONE_CFG.sep * 2.2); rx += (od < 0.5 ? cos(k * 2.4) : ox / od) * f; ry += (od < 0.5 ? sin(k * 2.4) : oy / od) * f; } }
      const vx = gx - Dr.x, vy = gy - Dr.y, vd = hypot(vx, vy) || 1, sp = min(dspd, vd * 4);
      Dr.x += (vx / vd * sp + rx * dspd * 0.9) * DT; Dr.y += (vy / vd * sp + ry * dspd * 0.9) * DT;
      if (this.wells.length && this.wellPull(Dr)) { Dr.on = 0; Dr.cd = 7; this.ev('recall'); return; }
      face = tg ? atan2(tg.y - Dr.y, tg.x - Dr.x) : (vd > 12 ? atan2(vy, vx) : s.a); Dr.a = wrap(Dr.a + clamp(wrap(face - Dr.a), -7 * DT, 7 * DT));
      if (tg && d2(tg, Dr) < (BEAM + (tg.r || 0) * 0.6) ** 2 && abs(wrap(face - Dr.a)) < 0.4) { Dr.fi = 1; this.fireBeam(100 + k, Dr.x, Dr.y, Dr.a, dps, 1, BEAM + (tg.r || 0) * 0.6); if (this.S(REPAIR, 'dMsl') && Dr.mc <= 0) { Dr.mc = 3; this.pp.push({ id: this.id(), x: Dr.x, y: Dr.y, vx: 0, vy: 0, spd: 380, home: 4, tgt: tg.id, dmg: 3 * dl, life: 3.5, k: 'dart', splash: 40 }); } }
    });
    // hard separation: no two drones may ever overlap
    for (let it = 0; it < 3; it++) for (let i = 0; i < 6; i++) { const A = s.drones[i]; if (!A.on) continue; for (let j = i + 1; j < 6; j++) { const B = s.drones[j]; if (!B.on) continue; const ox = B.x - A.x, oy = B.y - A.y, od = hypot(ox, oy); if (od < DRONE_CFG.sep) { const ux = od < 0.01 ? cos(i * 1.7 + j) : ox / od, uy = od < 0.01 ? sin(i * 1.7 + j) : oy / od, push = (DRONE_CFG.sep - od) / 2; A.x -= ux * push; A.y -= uy * push; B.x += ux * push; B.y += uy * push; } } }
    // shield drone port
    const SD = s.sdr, sdf = this.portEff(REPAIR, 'sdrone'); SD.cd -= DT; SD.on = sdf > 0 && SD.cd <= 0 && up(REPAIR); SD.a += 2 * DT; SD.mhp = 5 + this.pu(REPAIR, 'sdrone', 'armor');
    if (SD.on) { const rr = g.sr + 24; SD.x = s.x + cos(SD.a) * rr; SD.y = s.y + sin(SD.a) * rr; }
  }
  fireBeam(k, px, py, a, dps, brk, L = 330) {
    const s = this.ship, cx = cos(a), cy = sin(a); let hitD = L, hitE = null, hitP = -1;
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
    this.bolts.push(b); this.ev('b', b.id, round(x), round(y), round(b.vx), round(b.vy), kind, life); return b;
  }
  addRocket(x, y, a, dmg, home, splash = 70, pil = 0) { const s = this.ship; this.pp.push({ id: this.id(), x, y, vx: cos(a) * 300 + s.vx * 0.3, vy: sin(a) * 300 + s.vy * 0.3, spd: 380, home: home >= 1.05 ? home : home ? 1.1 : 0, tgt: null, dmg, life: 2.4, k: 'rk', splash, pil }); this.ev('rk'); }
  // v8 hazards: zones (circles) and gravity wells
  zoneAt(x, y) { for (const z of this.zones) if ((x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return z.k; return ''; }
  zoneTick() {
    const s = this.ship; if (s.dead) return; const zk = this.zoneAt(s.x, s.y); s.zk = zk;
    if (zk && !this.seenZ[zk]) { this.seenZ[zk] = 1; this.ev('zone', zk); }   // the pilot explains each hazard only the first time of the whole run
    if (!this.seenZ.well && this.wells.some(w => (w.x - s.x) ** 2 + (w.y - s.y) ** 2 < (WELL.R + 160) ** 2)) { this.seenZ.well = 1; this.ev('zone', 'well'); }
    if (zk === 'rad') { s.hull -= HAZ.rad.dps * DT; if (s.hull <= 0) { s.hull = 0; s.dead = 1; s.deadT = 2.2; this.ev('boom', round(s.x), round(s.y), 3, 80); } }
  }
  wellOk(x, y, minSep) {
    const [bx, by] = this.bnd(); if (abs(x) > bx - 200 || abs(y) > by - 200) return false;
    const s = this.ship; if ((x - s.x) ** 2 + (y - s.y) ** 2 < (WELL.R + 430) ** 2) return false;
    for (const e of this.enemies) if (!e.dead && isStation(e.type) && (x - e.x) ** 2 + (y - e.y) ** 2 < (WELL.R + e.r + 100) ** 2) return false;   // a well's area never overlaps a station
    for (const a of this.allies) if (a.k === 'fs' || a.k === 'fr' ? (x - a.x) ** 2 + (y - a.y) ** 2 < (WELL.R + (a.r || 90) + 100) ** 2 : false) return false;
    for (const w of this.wells) if ((x - w.x) ** 2 + (y - w.y) ** 2 < (minSep || 400) ** 2) return false;
    return true;
  }
  tryWell(x, y, minSep) { if (!this.wellOk(x, y, minSep)) return false; this.wells.push({ x: round(x), y: round(y), R: WELL.R }); return true; }
  placeZones(kind) {
    const n = 2 + (random() < 0.5 ? 1 : 0), pods = this.allies.filter(a => a.k === 'pod'), [bx, by] = this.bnd();
    for (let i = 0; i < n; i++) {
      const r = rnd(380, 540); let x = 0, y = 0, ok = false;
      for (let t = 0; t < 40 && !ok; t++) {
        if (pods.length && i < 2 && t < 6) { const p = pods[(i + t) % pods.length]; x = p.x + rnd(-80, 80); y = p.y + rnd(-80, 80); } else { const a = random() * 2 * PI, d = rnd(800, 3100); x = cos(a) * d; y = sin(a) * d; }
        ok = abs(x) < bx - r * 0.4 && abs(y) < by - r * 0.4 && hypot(x, y) > r + 400 && !this.zones.some(z => hypot(z.x - x, z.y - y) < z.r + r);
      }
      if (ok) this.zones.push({ k: kind, x: round(x), y: round(y), r: round(r) });
    }
  }
  // pulls any physical projectile / mine / bomb / drone toward the nearest well it is inside of; returns true when it falls into the core
  wellPull(o, mul = 1) {
    for (const w of this.wells) { const dx = w.x - o.x, dy = w.y - o.y, d = hypot(dx, dy); if (d >= w.R) continue; if (d < WELL.core) { this.ev('wsw', round(o.x), round(o.y)); return true; } const pv = (40 + WELL.pull * (1 - d / w.R) ** 1.2) * mul * DT, m = min(pv, d); o.x += dx / d * m; o.y += dy / d * m; }
    return false;
  }
  // v8: Homing Missiles launched 45 degrees off the nose. They fly to a point BEHIND the target first (arc around), then home in on it
  addMissile(x, y, a, dmg, turn, life, side) { const s = this.ship; this.pp.push({ id: this.id(), x, y, vx: cos(a) * 560 + s.vx * 0.3, vy: sin(a) * 560 + s.vy * 0.3, spd: 640, home: turn, tgt: null, dmg, life, k: 'hm', splash: 48, side, ph: 0, a0: a }); this.ev('rk'); }
  addFlak(x, y, a, dmg, splash, life) { const s = this.ship; this.pp.push({ id: this.id(), x, y, vx: cos(a) * 720 + s.vx * 0.2, vy: sin(a) * 720 + s.vy * 0.2, spd: 720, home: 0, tgt: null, dmg, life, k: 'fk', splash, prox: 34 }); }
  // ----- world -----
  portPos(e, k) { const p = ETYPES[e.type].ports[k], c = cos(e.a), s_ = sin(e.a), sc = e.sc || 1; return [e.x + (p.x * c - p.y * s_) * sc, e.y + (p.x * s_ + p.y * c) * sc]; }
  inHull(e, wx, wy) {
    const H = ETYPES[e.type].hull, dx = wx - e.x, dy = wy - e.y, c = cos(-e.a), s_ = sin(-e.a), isc = 1 / (e.sc || 1), lx = (dx * c - dy * s_) * isc, ly = (dx * s_ + dy * c) * isc;
    if (H.k === 'ell') return (lx / H.a) ** 2 + (ly / H.b) ** 2 < 1;
    if (H.k === 'circ') return lx * lx + ly * ly < H.r * H.r;
    const P = H.p; let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1]; if (((yi > ly) !== (yj > ly)) && lx < (xj - xi) * (ly - yi) / (yj - yi) + xi) inside = !inside; } return inside;
  }
  losClear(e, px, py, a) { for (let d = 10; d <= 200; d += 10) if (this.inHull(e, px + cos(a) * d, py + sin(a) * d)) return false; return true; }
  pickTarget(e) {
    e.tgtT -= DT; if (e.tgt && e.tgtT > 0 && !e.tgt.dead) return e.tgt;
    e.tgtT = 2; let t = this.ship.dead ? null : this.ship;
    if (this.allies.length && random() < (this.mission && (this.mission.type === 'defend' || this.mission.type === 'defend2') ? 0.55 : 0.4)) { const a = this.allies.filter(a => a.k !== 'pod' && a.k !== 'pax'); if (a.length) t = pick(a); }
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
      e.paint -= DT; e.shT += DT; if (e.stun > 0) e.stun -= DT; if (e.imm > 0) e.imm -= DT; const stunned = e.stun > 0;
      if (e.type === 10) { e.x += e.vx * DT; e.y += e.vy * DT; e.a += e.spin * DT; { const [RBX, RBY] = this.bnd(); if (abs(e.x) > RBX - e.r) { e.vx = -e.vx; e.x = clamp(e.x, -RBX + e.r, RBX - e.r); } if (abs(e.y) > RBY - e.r) { e.vy = -e.vy; e.y = clamp(e.y, -RBY + e.r, RBY - e.r); } } if (d2(e, s) < (e.r + g.hr) ** 2 && !s.dead) { this.hitShip(e.x, e.y, 1, 2, null); this.damageEnemy(e, -1, 99); } continue; }
      let sqd = null; if (e.sq !== undefined) { sqd = this.squadInfo(e); if (sqd.lead && sqd.lead !== e) { if (sqd.lead.tgt && !sqd.lead.tgt.dead) { e.tgt = sqd.lead.tgt; e.tgtT = 1; } if (sqd.lead.rush) e.rush = 1; } }
      const tg = this.phase === 'mission' ? this.pickTarget(e) : null; if (!tg) { e.vx *= 0.98; e.vy *= 0.98; e.x += e.vx * DT; e.y += e.vy * DT; continue; }
      const dx = tg.x - e.x, dy = tg.y - e.y, d = hypot(dx, dy) || 1, ta = atan2(dy, dx), spd = T.spd * (1 + 0.015 * L) * (e.rush && d > 1300 ? (T.spd < 80 ? 6 : 2.4) : 1);
      let vx, vy;
      if (e.type === 18) { // v6 kamikaze bomb ship: closes in, flashes red for ~1.1 s (arming), then dashes straight at its target and detonates on contact
        if (e.kz === undefined) { e.kz = 0; e.kt = 0; }
        if (e.kz === 0) { vx = dx / d * spd; vy = dy / d * spd; if (d < 640) { e.kz = 1; e.kt = 1.15; this.ev('kz', e.id, 1); } }
        else if (e.kz === 1) { vx = dx / d * spd * 0.15; vy = dy / d * spd * 0.15; e.kt -= DT; if (e.kt <= 0) { e.kz = 2; this.ev('kz', e.id, 2); } }
        else { vx = dx / d * spd * 3.4; vy = dy / d * spd * 3.4; }
        if (e.kz === 2) {
          if (tg === s && !s.dead) { const ang = atan2(e.y - s.y, e.x - s.x);
            if (d < g.sr * 0.85 + e.r && this.shieldCovers(ang)) { s.shp -= 4 * (1 - this.shDr()); s.shHit = 0; this.ev('blk', round(e.x), round(e.y), 1); if (s.shp <= 0) { s.shp = 0; s.shDown = SHIELD_DOWN; this.ev('shb'); } this.ev('kx', round(e.x), round(e.y), 0); this.killEnemy(e, 0); continue; }
            if (d < g.hr + e.r + 4) { this.kamiBlast(e); continue; } }
          else if (tg !== s && d < e.r + (tg.r || 40) + 4) { tg.hp -= 14; this.ev('kx', round(e.x), round(e.y), 1); this.killEnemy(e, 0); continue; }
        }
      }
      else if (e.type === 5) { vx = dx / d * spd; vy = dy / d * spd; if (d < e.r + (tg.r || g.hr) + 4) { if (tg === s) this.hitShip(e.x, e.y, 2, 2, null); else tg.hp -= 6; this.killEnemy(e, 0); continue; } }
      else if (T.spd === 0) { vx = 0; vy = 0; }
      else if (sqd && sqd.lead && sqd.lead !== e && sqd.lead.warp <= 0) {   // v8 squadron wingman: hold the formation slot behind the leader
        const ld = sqd.lead, [ox, oy] = formOff(sqd.rank, e.sqk, 64 * e.sc), c_ = cos(ld.a), s_ = sin(ld.a), sx = ld.x + ox * c_ - oy * s_, sy = ld.y + ox * s_ + oy * c_;
        vx = ld.vx + (sx - e.x) * 2.4; vy = ld.vy + (sy - e.y) * 2.4; const vm = hypot(vx, vy), lim = max(spd * 1.7, hypot(ld.vx, ld.vy) * 1.3); if (vm > lim) { vx *= lim / vm; vy *= lim / vm; }
      }
      else {
        const want = T.want; const rad = d > want ? 1 : d < want * 0.7 ? -0.8 : 0;
        vx = (dx / d * rad - dy / d * e.orbit * 0.8) * spd; vy = (dy / d * rad + dx / d * e.orbit * 0.8) * spd;
        if (random() < 0.004) e.orbit *= -1;
      }
      if (stunned) { vx *= 0.25; vy *= 0.25; }
      const tf = T.mp ? 0.4 : 3, desired = e.type === 18 ? ta : (e.type === 5 || !T.mp) && T.g && !T.g.turret ? ta : atan2(vy, vx);
      if (!stunned) e.a = wrap(e.a + clamp(wrap((T.mp ? ta : desired) - e.a), -tf * DT, tf * DT));
      const k = min(1, 2 * DT); e.vx += (vx - e.vx) * k; e.vy += (vy - e.vy) * k;
      const [EBX, EBY] = this.bnd(); e.x = clamp(e.x + e.vx * DT, -EBX, EBX); e.y = clamp(e.y + e.vy * DT, -EBY, EBY);
      e.ramT = (e.ramT || 0) - DT;
      if (!T.mp && d2(e, s) < (e.r + g.hr) ** 2 && !s.dead && e.ramT <= 0) { e.ramT = 1.2; if (s.burn > 0 && this.S(ENG, 'ram')) this.damageEnemy(e, -1, 12); else { this.hitShip(e.x, e.y, 1, 1, null); this.damageEnemy(e, -1, 3); } }
      if (this.phase !== 'mission' || s.dead || stunned) continue;
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
        const T = ETYPES[e.type], rr = e.r + 4 + (T.mp ? 44 : 0) + (b.ion ? 20 : 0); if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > rr * rr) continue;
        const pm = (e.paint > 0 ? 1.5 : 1) * b.brk;
        if (b.ion) { if (!T.mp ? segD2(ox, oy, b.x, b.y, e.x, e.y) < (e.r + 8) ** 2 : this.inHull(e, b.x, b.y) || segD2(ox, oy, b.x, b.y, e.x, e.y) < (e.r * 0.8) ** 2) { this.ionEnemy(e, b); b.dead = 1; this.ev('x', b.id); break; } continue; }
        if (T.mp) {
          const inside = this.inHull(e, b.x, b.y);
          if (e.sh > 0) { if (inside || segD2(ox, oy, b.x, b.y, e.x, e.y) < (e.r * 0.8) ** 2) { this.damageEnemy(e, -2, b.dmg * pm); b.dead = 1; this.ev('x', b.id); break; } continue; }
          let hitP = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || hitP >= 0) return; const [wx, wy] = this.portPos(e, k); if (segD2(ox, oy, b.x, b.y, wx, wy) < (19 * e.pk) ** 2) hitP = k; });
          if (hitP >= 0) { this.damageEnemy(e, hitP, b.dmg * pm); b.hit.push(e.id); if (b.pierce > 0) b.pierce--; else { b.dead = 1; this.ev('x', b.id); break; } }
          else if (inside) { let nk = -1; e.ports.forEach((p, k) => { if (p.hp <= 0 || nk >= 0) return; const [wx, wy] = this.portPos(e, k); if ((wx - b.x) ** 2 + (wy - b.y) ** 2 < (34 * e.pk) ** 2) nk = k; });
            b.dead = 1; if (nk >= 0) this.damageEnemy(e, nk, b.dmg * pm); else this.ev('arm', round(b.x), round(b.y)); this.ev('x', b.id); break; }
        } else { this.damageEnemy(e, -1, b.dmg * pm); b.hit.push(e.id); if (b.pierce > 0) b.pierce--; else { b.dead = 1; this.ev('x', b.id); break; } }
      }
    }
    this.bolts = this.bolts.filter(b => !b.dead);
    // homing player projectiles
    for (const p of this.pp) {
      p.life -= DT; if (p.life <= 0) { p.dead = 1; if (p.splash) this.splash(p.x, p.y, p.splash, p.k === 'fk' ? p.dmg : p.dmg * 0.5); if (p.k === 'fk') this.ev('boom', round(p.x), round(p.y), 0, p.splash); continue; }
      if (this.wells.length && this.wellPull(p)) { p.dead = 1; continue; }
      if (p.k === 'hm') {   // v8 Homing Missile: arcs round to a point behind the target, then closes in
        let t = p.tgt ? this.enemies.find(e => e.id === p.tgt && !e.dead) : null; const ca = atan2(p.vy, p.vx);
        if (!t) { let bs = 1e18; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const d = hypot(e.x - p.x, e.y - p.y); if (d > 1700) continue; const q = d * (1 + 1.5 * abs(wrap(atan2(e.y - p.y, e.x - p.x) - ca))); if (q < bs) { bs = q; t = e; } } if (t) p.tgt = t.id; }
        if (t) { let ax = t.x, ay = t.y; if (!p.ph) { const bd = (t.r || 30) + 150, bx = t.x - cos(t.a) * bd, by = t.y - sin(t.a) * bd, dB = hypot(bx - p.x, by - p.y), dT = hypot(t.x - p.x, t.y - p.y); if (dB < 140 || (dT < 240 && dB > dT)) p.ph = 1; else { ax = bx; ay = by; } } const a = atan2(ay - p.y, ax - p.x), na = ca + clamp(wrap(a - ca), -p.home * DT, p.home * DT); p.vx = cos(na) * p.spd; p.vy = sin(na) * p.spd; }
        else { const sp = hypot(p.vx, p.vy) || 1; if (sp < p.spd) { p.vx *= 1.04; p.vy *= 1.04; } }
      } else if (p.home) {
        let t = p.tgt ? this.enemies.find(e => e.id === p.tgt && !e.dead) : null;
        if (!t) { let bd = 500 * 500; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const q = d2(e, p); if (q < bd) { bd = q; t = e; } } if (t) p.tgt = t.id; }
        if (t) { const a = atan2(t.y - p.y, t.x - p.x), ca = atan2(p.vy, p.vx), na = ca + clamp(wrap(a - ca), -p.home * DT, p.home * DT); p.vx = cos(na) * p.spd; p.vy = sin(na) * p.spd; }
      } else { const sp = hypot(p.vx, p.vy) || 1; if (sp < p.spd) { p.vx *= 1.04; p.vy *= 1.04; } }
      p.x += p.vx * DT; p.y += p.vy * DT;
      if (p.k === 'fk') { for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (e.r + 8 + p.prox) ** 2) continue; p.dead = 1; this.splash(p.x, p.y, p.splash, p.dmg); this.ev('boom', round(p.x), round(p.y), 0, p.splash); break; } if (p.dead) continue; }
      for (const e of this.enemies) {
        if (p.k === 'fk') break;
        if (e.dead || e.warp > 0 || (e.x - p.x) ** 2 + (e.y - p.y) ** 2 > (e.r + 6) ** 2) continue;
        if (ETYPES[e.type].mp) {
          if (e.sh > 0) { if (!this.inHull(e, p.x, p.y)) continue; this.damageEnemy(e, -2, p.dmg); }
          else { let hk = -1, hd = 1e9; e.ports.forEach((q, k) => { if (q.hp <= 0) return; const [wx, wy] = this.portPos(e, k), dd = (wx - p.x) ** 2 + (wy - p.y) ** 2; if (dd < hd) { hd = dd; hk = k; } }); if (hk >= 0 && hd < (60 * e.pk) ** 2) this.damageEnemy(e, hk, p.dmg); else if (!this.inHull(e, p.x, p.y)) continue; }
        } else this.damageEnemy(e, -1, p.dmg);
        if (p.splash) this.splash(p.x, p.y, p.splash, p.dmg * 0.5, e);
        p.dead = 1; this.ev('boom', round(p.x), round(p.y), 0); break;
      }
    }
    this.pp = this.pp.filter(p => !p.dead);
    // engineer bombs
    for (const b of this.bombs) {
      if (this.wells.length && this.wellPull(b)) { b.dead = 1; continue; }
      const dx = b.tx - b.x, dy = b.ty - b.y, d = hypot(dx, dy), sp = (b.spd || 520) * DT;
      if (d < 18) { b.dead = 1; this.splash(b.tx, b.ty, b.rad, b.dmg); this.ev('boom', round(b.tx), round(b.ty), 2, round(b.rad)); for (const q of this.eb) if (!q.dead && (q.x - b.tx) ** 2 + (q.y - b.ty) ** 2 < b.rad * b.rad) q.dead = 1;
        if (b.cl) for (let k = 0; k < 3; k++) { const a = k * 2.1 + random(); this.bombs.push({ id: this.id(), x: b.tx, y: b.ty, tx: b.tx + cos(a) * 130, ty: b.ty + sin(a) * 130, rad: b.rad * 0.5, dmg: b.dmg * 0.4 }); }
        continue; }
      b.x += dx / d * min(d, sp); b.y += dy / d * min(d, sp);
    }
    this.bombs = this.bombs.filter(b => !b.dead);
    // mines (engineer port)
    for (const m of this.mines) { m.life -= DT; if (m.life <= 0) { m.dead = 1; continue; } if (this.wells.length && this.wellPull(m)) { m.dead = 1; continue; } for (const e of this.enemies) if (!e.dead && e.warp <= 0 && d2(e, m) < (e.r + 30) ** 2) { m.dead = 1; this.splash(m.x, m.y, 90, m.dmg || 5); this.ev('boom', round(m.x), round(m.y), 1); break; } }
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
      if (b.t === 1 && this.wells.length && this.wellPull(b)) { b.dead = 1; continue; }
      for (const Dr of s.drones) if (Dr.on && (Dr.x - b.x) ** 2 + (Dr.y - b.y) ** 2 < (14 + b.r) ** 2) { b.dead = 1; Dr.hp -= b.hv ? 2 : 1; this.ev('pd', round(b.x), round(b.y), b.t); if (Dr.hp <= 0) { Dr.on = 0; Dr.cd = 8; this.ev('boom', round(Dr.x), round(Dr.y), 0); } break; }
      if (b.dead) continue;
      const SD = s.sdr; if (SD.on && (SD.x - b.x) ** 2 + (SD.y - b.y) ** 2 < (26 + b.r) ** 2) { b.dead = 1; SD.hp -= 1; this.ev('pd', round(b.x), round(b.y), b.t); if (SD.hp <= 0) { SD.cd = 10 * (1 - this.pu(REPAIR, 'sdrone', 'respawn')); SD.hp = SD.mhp || 4; } continue; }
      if (!s.dead) {
        const dd = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
        if (dd < (sr + b.r) ** 2 && dd > (sr - 20) ** 2 && !b.passed) {
          if (this.shieldCovers(atan2(b.y - s.y, b.x - s.x))) { b.dead = 1; this.shieldHit(b); continue; }
          b.passed = 1;
        }
        const hs = this.shipHit(b.x, b.y, b.r);
        if (hs >= 0) { b.dead = 1; this.hitShip(b.x, b.y, (b.hv ? 1.2 : 0.75) * (b.dm || 1), (b.hv ? 2 : 1) * (b.dm || 1), b); continue; }
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
      if (a.k === 'fs') {
        a.a += 0.1 * DT;   // v5: the station defends itself with four gun turrets
        let tg = null, bd = 800 * 800; for (const e of this.enemies) { if (e.dead || e.warp > 0 || e.type === 10) continue; const q = d2(e, a); if (q < bd) { bd = q; tg = e; } }
        if (tg && this.phase === 'mission') {
          const ta = atan2(tg.y - a.y, tg.x - a.x); a.ta = wrap(a.ta + clamp(wrap(ta - a.ta), -4 * DT, 4 * DT));
          for (let q = 0; q < 4; q++) { a.gc[q] -= DT; if (a.gc[q] <= 0 && abs(wrap(ta - a.ta)) < 0.3) { a.gc[q] = 1.1 + 0.1 * q; const ma = a.a + q * PI / 2, mx = a.x + cos(ma) * 84, my = a.y + sin(ma) * 84, aa = atan2(tg.y - my, tg.x - mx); this.addBolt(mx + cos(aa) * 12, my + sin(aa) * 12, aa, BOLT_SPD, 1.4 * (1 + 0.06 * (M ? M.level : 1)), 0, 1, GUN_LIFE * 0.85); a.gi = 0.12; } }
        } a.gi = max(0, (a.gi || 0) - DT);
      }
    }
    this.allies = this.allies.filter(a => !a.dead);
    // pickups: credit chips and cores
    const mag = 150 * (1 + 1.5 * (this.portEff(ENG, 'tractor') > 0 ? 1 + this.pu(ENG, 'tractor', 'range') : 0)) * (1 + this.S(REPAIR, 'magnet')) * (1 + 0.6 * this.portEff(REPAIR, 'magdr') + this.pu(REPAIR, 'magdr', 'range')) * (1 + 0.3 * this.portEff(REPAIR, 'scrap') + this.pu(REPAIR, 'scrap', 'range'));
    const salv = 1 + this.pu(ENG, 'tractor', 'salvage') + this.pu(REPAIR, 'magdr', 'salvage') + 0.12 * this.portEff(REPAIR, 'scrap') + this.pu(REPAIR, 'scrap', 'salvage');
    for (const p of this.picks) {
      p.life -= DT; if (p.life <= 0) { p.dead = 1; continue; }
      let col = null; if (!s.dead && d2(p, s) < mag * mag) col = s; else for (const Dr of s.drones) if (Dr.on && d2(p, Dr) < (70 * (1 + this.S(REPAIR, 'magnet'))) ** 2) col = Dr;
      if (col) { const dx = col.x - p.x, dy = col.y - p.y, d = hypot(dx, dy) || 1; p.x += dx / d * 560 * DT; p.y += dy / d * 560 * DT; if (d < 30) { p.dead = 1; if (p.k === 'core') { this.cores++; this.ev('core'); } else this.grant(p.v * salv); this.ev('pick', p.k === 'core' ? 1 : 0, p.v); } }
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
  // v7 ION: the target is stunned for ION_STUN seconds (no fire, no steering, 25% thrust) and its shield is rapidly drained. Capital ships stun for half as long; the final boss for 1 s with a 6 s immunity afterwards.
  ionEnemy(e, b) {
    if (e.dead) return; const T = ETYPES[e.type];
    if (e.sh > 0) { this.damageEnemy(e, -2, max(12, e.shm * 0.5)); }
    if (e.imm > 0) { this.ev('ion', round(b.x), round(b.y), e.id, 0); return; }
    const dur = e.boss ? 1 : T.sz >= 2 ? ION_STUN * 0.5 : ION_STUN; e.stun = max(e.stun || 0, dur); if (e.boss) e.imm = 6; this.ev('ion', round(b.x), round(b.y), e.id, 1);
  }
  // v6 kamikaze detonation: heavy hull damage, the section it hits takes a big hit and every port/section inside the blast is damaged too
  kamiBlast(e) {
    const s = this.ship, L = this.mission ? this.mission.level : 1; this.ev('kx', round(e.x), round(e.y), 1);
    this.hitShip(e.x, e.y, 3.2, 3, null);
    if (!s.dead && s.inv <= 0 && s.aegis <= 0) for (let k = 0; k < NSEC; k++) { if (!this.secExists(k)) continue; const [wx, wy] = this.secW[k]; if ((wx - e.x) ** 2 + (wy - e.y) ** 2 > 105 * 105) continue; const c = s.sec[k]; if (c.dn) continue; c.hp -= 1.6 * (1 + 0.02 * (L - 1)); if (c.hp <= 0) { c.hp = this.emerg() * this.secMax(k); c.dn = 1; this.ev('sd', k); } }
    this.killEnemy(e, 0);
  }
  killEnemy(e, byPlayer) {
    if (e.dead) return; e.dead = 1; const T = ETYPES[e.type], dm = this.mission ? DIFFS[this.mission.diff].m : 1;
    if (e.cmd) this.ev('cmd', e.cmd, 2, e.id);
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
    if (rear && abs(wrap(ang - s.sa - PI)) < half * 0.6 * (1 + this.pu(SHIELD, 'rear', 'width'))) return 1;
    return 0;
  }
  shieldHit(b) {
    const s = this.ship, dmg = (b.sd || 1) * (s.fort > 0 ? 0.5 : 1) * (s.bubble > 0 ? 0.5 : 1) * (1 - this.shDr()); s.shp -= dmg; s.shHit = 0;
    s.en = min(s.em, s.en + (b.hv ? 4 : 2) * (1 + this.S(SHIELD, 'absorb')));
    this.ev('blk', round(b.x), round(b.y), b.t); if (b.t === 3) this.ev('ionb', round(b.x), round(b.y));
    const refl = this.S(SHIELD, 'reflect') + (this.portEff(SHIELD, 'reflect') > 0 ? 0.25 + this.pu(SHIELD, 'reflect', 'chance') : 0);
    if (b.t === 0 && random() < refl) this.addBolt(b.x, b.y, atan2(-b.vy, -b.vx), 700, 1.6 * (1 + this.pu(SHIELD, 'reflect', 'rdmg')), 0, 1, 0.9);
    if (s.shp <= 0) { s.shp = 0; s.shDown = SHIELD_DOWN; this.ev('shb'); }
  }
  hitShip(x, y, hullDmg, stDmg, b) {
    const s = this.ship; if (s.dead || s.inv > 0) { if (s.inv > 0) this.ev('blk', round(x), round(y), 0); return; }
    if (random() < this.S(PILOT, 'graze')) { this.ev('graze', round(x), round(y)); return; }
    const L = this.mission ? this.mission.level : 1;
    if (b && b.t === 3) { s.stun = ION_STUN; this.ev('ion', round(x), round(y), 0, 2); hullDmg *= 0.6; }
    s.hull -= hullDmg * (1 + 0.03 * (L - 1)) * max(0.4, 1 - 0.15 * this.portEff(SHIELD, 'ablate') - this.pu(SHIELD, 'ablate', 'soak'));
    let k = this.shipHit(x, y, 40); if (k < 0) k = this.nearestStation(x, y);
    const c = s.sec[k];
    if (s.aegis <= 0 && !c.dn) { c.hp -= stDmg; if (c.hp <= 0) { c.hp = this.emerg() * this.secMax(k); c.dn = 1; this.ev('sd', k); } }
    this.ev('sh', round(x), round(y), k);
    if (s.hull <= 0) { s.hull = 0; s.dead = 1; s.deadT = 2.2; this.ev('boom', round(s.x), round(s.y), 3, 80); }
  }
  threats() {
    const s = this.ship, out = [], sr = this.geo().sr;
    for (const b of this.eb) { if (b.dead || b.passed) continue; const rx = s.x - b.x, ry = s.y - b.y, sp = hypot(b.vx, b.vy) || 1, tti = (rx * b.vx + ry * b.vy) / (sp * sp); if (tti < 0 || tti > 2.6) continue; const cx = b.x + b.vx * tti - s.x, cy = b.y + b.vy * tti - s.y; if (cx * cx + cy * cy > (sr + 20) ** 2) continue; out.push({ b, tti, ang: wrap(atan2(b.y - s.y, b.x - s.x) - s.a), wang: atan2(b.y - s.y, b.x - s.x) }); }
    for (const e of this.enemies) { if (e.dead || e.type !== 18 || !e.kz) continue; const d = hypot(e.x - s.x, e.y - s.y); if (d > 900) continue; out.push({ b: { t: 0, x: e.x, y: e.y, vx: 0, vy: 0, kz: 1 }, tti: d / 500, ang: wrap(atan2(e.y - s.y, e.x - s.x) - s.a), wang: atan2(e.y - s.y, e.x - s.x) }); }
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
    for (let i = 0; i < 6; i++) if (ctl(i)) { const b = B(i); b.as = 0; b.f = 0; b.mb = 0; b.rt = -1; }
    // pilot: objective-driven helm
    if (ctl(PILOT)) {
      const b = B(PILOT); let goal = null;
      if (M.type === 'hostages') { let bd = 1e18; for (const a of this.allies) if (a.k === 'pod') { const q = d2(a, s); if (q < bd) { bd = q; goal = a; } } }
      if (M.type === 'escort') { const f = this.allies.find(a => a.k === 'fr'); if (f && d2(f, s) > 450 * 450) goal = f; }
      if (M.type === 'defend') { const f = this.allies.find(a => a.k === 'fs'); if (f && d2(f, s) > 600 * 600) goal = f; }
      if (M.type === 'passengers') {   // fly the corridor: far end first, then home; steer around the rocks ahead
        const px = M.pax ? M.sx : M.px; goal = { x: px, y: 0 };
        let ox = 0, oy = 0; for (const e of this.enemies) { if (e.dead || e.type !== 10) continue; const dx = e.x - s.x, dy = e.y - s.y, d = hypot(dx, dy); if (d > 520 || d < 1) continue; const fwd = (dx * cos(s.a) + dy * sin(s.a)) / d; if (fwd < 0.15) continue; const w = (1 - d / 520) * (e.r + 55) / 60; ox -= dx / d * w; oy -= dy / d * w; }
        const gd = hypot(goal.x - s.x, goal.y - s.y) || 1; goal = { x: s.x + (goal.x - s.x) / gd * 400 + ox * 420, y: s.y + (goal.y - s.y) / gd * 400 + oy * 420 };
      }
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
      for (const z of this.zones) if (z.k === 'rad') { const dz = hypot(s.x - z.x, s.y - z.y), gin = hypot(goal.x - z.x, goal.y - z.y) < z.r; if (dz < z.r + 140 && !(gin && s.hull > s.hm * 0.4)) { b.ax = s.x + (s.x - z.x) / (dz || 1) * 500; b.ay = s.y + (s.y - z.y) / (dz || 1) * 500; } }
      b.f = s.sec[PILOT].dn ? 1 : (tgt && abs(wrap(atan2(tgt.y - s.y, tgt.x - s.x) - s.a)) < 0.25 && d2(tgt, s) < 540 * 540 ? 1 : 0);
      if (M.type === 'passengers' && !b.f) for (const e of this.enemies) { if (e.dead || e.type !== 10) continue; const dx = e.x - s.x, dy = e.y - s.y; if (dx * dx + dy * dy < 420 * 420 && abs(wrap(atan2(dy, dx) - s.a)) < 0.16) { b.f = 1; break; } }
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
      else if (M.type === 'passengers') { let rk = null, rd = 560 * 560; for (const e of this.enemies) { if (e.dead || e.type !== 10) continue; const ang = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); if (abs(wrap(ang - center)) > half) continue; const q = d2(e, s); if (q < rd) { rd = q; rk = e; } } if (rk) { b.ax = rk.x; b.ay = rk.y; b.f = 1; } else b.f = 0; }
      else b.f = 0;
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
      b.thr = M.type === 'passengers' ? (n === 0 ? 0.6 : 0.5) : travel ? 1 : 0.7;
      // rerouting: spend only what the generator can sustain; shield first when it is down, then repairs, guns in a fight, engines when travelling
      const E = s.en / s.em, budget = s.lock > 0 ? 0 : E > 0.8 ? 4 : E > 0.55 ? 3 : E > 0.3 ? 2 : E > 0.12 ? 1 : 0;
      const want = [0, 0, 0, 0]; let left = budget; const give = (k, v) => { const g = min(v, left); want[k] += g; left -= g; };
      if (s.shDown > 0 && this.up(SHIELD)) give(2, 3);
      if (s.sec.some(c => c.dn) || s.hull < s.hm * 0.6) give(3, 2);
      if (n >= 1) give(1, 3); else give(0, 3);
      give(n >= 1 ? 0 : 1, 2);
      if (this.t - (this.lastPip || 0) > 0.45) {
        let k = -1; for (let q = 0; q < 4; q++) if (s.pip[q] > want[q] && (k < 0 || s.pip[q] - want[q] > s.pip[k] - want[k])) k = q;
        if (k >= 0) { seat.bacts.push('d' + (k + 1)); this.lastPip = this.t; }
        else if (this.rrUsed() < RR_CFG.max) { for (let q = 0; q < 4; q++) if (s.pip[q] < want[q]) { seat.bacts.push('u' + (q + 1)); this.lastPip = this.t; break; } }
      }
      const sideCount = sd => live.filter(e => { const a = wrap(atan2(e.y - s.y, e.x - s.x) - s.a); return sd > 0 ? a > 0 : a < 0; }).length;
      const rs = sideCount(1) >= sideCount(-1) ? 1 : -1, ra = s.a + rs * PI / 2;
      const bigNear = nearest(e => ETYPES[e.type].mp && d2(e, s) < 620 * 620), cl = nr;
      if (cl) { b.ax = (bigNear || cl).x; b.ay = (bigNear || cl).y; } else { b.ax = s.x + cos(ra) * 200; b.ay = s.y + sin(ra) * 200; }
      const rrAim = () => { if (!cl) return; b.ax = s.x + cos(ra) * 200; b.ay = s.y + sin(ra) * 200; };
      for (let slot = 0; slot < 3; slot++) { const A = this.abilityOf(ENG, slot); if (!A || (seat.cd[A[0]] || 0) > 0) continue; const ab = A[0];
        if ((ab === 'bomb' && cl && d2(cl, s) < 680 * 680 && (n >= 2 || bigNear || cl.sh > 0)) || (ab === 'seismic' && bigNear) || (ab === 'burner' && ((travel && n === 0 && M.type !== 'defend') || (th.length >= 3 && s.hull < s.hm * 0.5))) || (ab === 'surge' && n >= 3) || (ab === 'warp' && s.hull < s.hm * 0.35 && n >= 2)) { if (ab === 'warp' && cl) { b.ax = s.x - (cl.x - s.x); b.ay = s.y - (cl.y - s.y); } seat.bacts.push('qer'[slot]); }
        }
    }
    // repair: hit the calibration band, steer the drones, use kit abilities
    if (ctl(REPAIR) && !s.sec[REPAIR].dn) {
      const b = B(REPAIR); const pr = this.repairPriority(); b.rt = pr === REPAIR ? -1 : pr; b.mb = 0.55; b.f = 0;
      // the bot switches the drone off while something is broken and nothing is close, so repairs go 50% faster
      const wantOff = pr >= 0 && pr !== REPAIR && (!nr || d2(nr, s) > 800 * 800);
      if (!!s.droneOff !== wantOff) this.seats[REPAIR].bacts.push('dr');
      if (nr) { b.ax = nr.x; b.ay = nr.y; } else if (this.picks.length) { b.ax = this.picks[0].x; b.ay = this.picks[0].y; }
      // v6: the bot also sends the drones to loot the drones would not fetch on their own, or to flank an enemy that stays out of their reach
      if (!wantOff && !s.dg && s.drones.some(d => d.on) && this.t - (this.dgBot || 0) > 6) {
        const pk = this.picks.find(p => !p.dead && d2(p, s) > 820 * 820 && d2(p, s) < 1700 * 1700);
        if (pk) { this.sendDrones(pk.x, pk.y); this.dgBot = this.t; }
        else if (nr && d2(nr, s) > 720 * 720 && d2(nr, s) < 1500 * 1500) { this.sendDrones(nr.x - cos(nr.a) * 90, nr.y - sin(nr.a) * 90); this.dgBot = this.t; }
      }
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
    if (c.prof.run !== this.runId) { c.prof.t = {}; c.prof.cr = 0; c.prof.earned = 0; fixProf(c.prof); c.prof.run = this.runId; }   // v9: a new run starts every player at 0 credits and a blank pyramid; reconnecting to the same run keeps progress
    if (c.prof.earned < this.crewEarned) { c.prof.cr += this.crewEarned - c.prof.earned; c.prof.earned = this.crewEarned; }
    c.dirty = 1; this.ev('join', c.prof.name, seat.idx); return true;
  }
  removeClient(c) {
    const seat = this.seatOf(c); if (seat) { seat.human = null; seat.bi = blankInput(); this.ev('leave', c.prof.name, seat.idx); }
    this.clients.delete(c); this.votes.delete(c.pid); this.ready.delete(c.pid);
    if (!this.clients.size) this.emptySince = Date.now();
    this.rvCheck();
  }
  switchRole(c, idx) {
    const cur = this.seatOf(c), tgt = this.seats[idx]; if (!cur || !tgt || tgt === cur) return;
    if (tgt.human) { sendTo(c, { t: 'toast', m: tgt.human.prof.name + ' is already on that station' }); return; }
    cur.human = null; cur.bi = blankInput(); tgt.human = c; c.dirty = 1; this.ev('swap', c.prof.name, idx);
  }
  snapshot() {
    const s = this.ship, r1 = v => round(v * 10) / 10, r2 = v => round(v * 100) / 100, M = this.mission;
    const o = { t: 's', ph: this.phase, pt: r1(max(0, this.phaseT)), T: r2(this.t), mk: this.mk, co: this.cores, hpl: this.hullPlus, md: this.mainDone, sc: this.score, ce: this.crewEarned, v: D.VERSION };
    o.sh = { x: round(s.x), y: round(s.y), a: r2(s.a), vx: round(s.vx), vy: round(s.vy), h: r1(s.hull), hm: s.hm,
      sc: s.sec.map((c, k) => this.secExists(k) ? r2(c.hp / this.secMax(k)) : -1), dn: s.sec.map(c => c.dn ? 1 : 0),
      en: round(s.en), em: s.em, lat: round(s.lat || 0), zk: s.zk === 'rad' ? 1 : s.zk === 'cold' ? 2 : 0, sa: r2(s.sa), tl: r2(s.tl), tr: r2(s.tr), thr: r2(s.thr), spd: round(s.spd),
      burn: s.burn > 0 ? 1 : 0, dr: s.drones.map(d => d.on ? [round(d.x), round(d.y), r2(d.a), r2(d.hp / d.mhp), d.fi] : 0), sd: s.sdr.on ? [round(s.sdr.x), round(s.sdr.y)] : 0, dg: s.dg ? [round(s.dg.x), round(s.dg.y), r2(s.dg.t / DRONE_CFG.hold)] : 0,
      st: r1(max(0, s.stun)), ic: r2(max(0, s.ionCd) / ION_CD), tk: [s.task.i, r2(s.task.i >= 0 && s.task.i < NSEC ? s.sec[s.task.i].hp / this.secMax(s.task.i) : s.hull / s.hm), s.droneOff ? 1 : 0, r2(s.task.mult || 0), r2(this.help || 0)],
      shp: r1(s.shp), shm: r1(s.shm), shd: r1(s.shDown), bub: s.bubble > 0 ? 1 : 0, aeg: s.aegis > 0 ? 1 : 0, fort: s.fort > 0 ? 1 : 0, inv: s.inv > 0 ? 1 : 0, roll: r2(s.roll || 0), dead: s.dead, pip: s.pip, lk: r1(s.lock), eu: this.rrUsed(), td: round(this.thrDrain() * 10) / 10, rd: round(RR_CFG.base * RR_CFG.drain[this.rrUsed()] * this.drainM() * 10) / 10, rg: round(RR_CFG.base * min(RR_CFG.regenCap, 1 + this.S(ENG, 'regen') + 0.35 * this.portEff(ENG, 'aux')) * (this.up(ENG) ? 1 : 0.6) * 10) / 10,
      bm: Object.keys(s.beam).map(k => [+k].concat(s.beam[k])), rr: s.reroute > 0 ? 1 : 0, rear: this.portEff(SHIELD, 'rear') > 0 ? 1 : 0, arc: this.shieldArc(), pa: Object.keys(s.pang).map(k => [+k, r2(s.pang[k])]) };
    o.e = this.enemies.filter(e => e.type !== 10 || !M || !M.bx || d2(e, s) < 3000 * 3000).map(e => [e.id, e.type, round(e.x), round(e.y), r2(e.a), ETYPES[e.type].mp ? 1 : (e.type === 10 ? round(e.r) : r2(max(0, e.hp / e.mhp))), e.warp > 0 ? 1 : 0, e.paint > 0 ? 1 : 0, e.ports ? e.ports.map(p => [r2(p.hp / p.mhp), r2(p.pa), p.ch > 0 ? 1 : 0]) : 0, e.shm ? r2(e.sh / e.shm) : -1, e.kz || 0, e.stun > 0 ? r1(e.stun) : 0, e.cmd || 0, r2(e.sc || 1)]);
    o.eb = this.eb.map(b => [b.id, round(b.x), round(b.y), r2(atan2(b.vy, b.vx)), b.t, b.hv ? 1 : 0, round(hypot(b.vx, b.vy)), b.home ? 1 : 0]);
    o.pp = this.pp.map(p => [p.id, round(p.x), round(p.y), r2(atan2(p.vy, p.vx)), p.k === 'rk' ? (p.pil ? 4 : 0) : p.k === 'hm' ? 2 : p.k === 'fk' ? 3 : 1]);
    o.zn = this.zones.map(z => [z.k === 'rad' ? 0 : 1, z.x, z.y, z.r]); o.gw = this.wells.map(w => [w.x, w.y, w.R]);
    o.al = this.allies.map(a => [a.id, a.k, round(a.x), round(a.y), r2(a.a), r2(max(0, a.hp / a.mhp)), r2(a.resc || 0), r2(a.ta || 0), a.gi > 0 ? 1 : 0, a.v || 0]);
    o.pk = this.picks.map(p => [p.id, round(p.x), round(p.y), p.k === 'core' ? 1 : 0]);
    o.mn = this.mines.map(m => [round(m.x), round(m.y)]);
    o.bo = this.bombs.map(b => [round(b.x), round(b.y)]);
    o.wv = this.waves.map(w => [round(w.x), round(w.y), r2(w.a), r2(w.half), round(w.r)]);
    o.crew = this.seats.map(st => [st.human ? st.human.prof.name : st.botName, st.human ? 0 : 1, st.human ? st.human.pid : 0, st.cur.as && !s.sec[st.idx].dn ? 1 : 0, st.human && st.human.inp.idle ? 1 : 0,
      [0, 1, 2].map(k => { const A = this.abilityOf(st.idx, k); if (!A) return 0; const ab = A[0]; return [ab, r1(max(0, st.cd[ab] || 0)), r1(st.cdm[ab] || ABIL[ab].cd * A[1])]; }), Object.keys(st.bf).filter(k => st.bf[k] > 0),
      this.ports[st.idx].map((p, sl) => p && sl < this.mk ? [p.id, p.lv, p.u || {}] : 0)]);
    if (M) o.mi = { name: M.name, type: M.type, lv: M.level, diff: M.diff, kind: M.kind, planet: M.planet, wave: M.wave, waves: M.waves, got: M.got, need: M.need, lost: M.lost, pods: M.pods, jx: M.jx, jy: M.jy, left: this.hostiles(), fac: M.fac, mod: M.mod, bx: M.bx, by: M.by, sx: M.sx, px: M.px, pax: M.pax, ext: M.ext, dur: M.dur, tm: round(M.time), stl: M.stl, ch: M.ch || 0, pre: M.pre ? 1 : 0, ttl: M.title || '' };
    if (this.phase === 'map') { const hum = this.humans(), w = {}; for (const c of this.clients) { const v = this.votes.get(c.pid); if (!v) continue; const seat = this.seatOf(c); w[v] = (w[v] || 0) + 1; } o.opts = this.options; o.votes = w; o.pw = 1; o.my = {}; const pilot = this.seats[PILOT].human; o.pv = pilot ? this.votes.get(pilot.pid) || '' : null; o.wait = [...this.clients].filter(c => !this.votes.has(c.pid)).map(c => c.prof.name); }
    if (this.phase === 'result' || this.phase === 'upgrade') o.res = this.result;
    if (this.phase === 'upgrade' || this.phase === 'intro') o.rdy = [...this.ready];
    if (this.phase === 'upgrade') o.wait = [...this.clients].filter(c => !this.ready.has(c.pid)).map(c => c.prof.name);
    if (this.rv) o.rv = { by: this.rv.by, bp: this.rv.pid, y: [...this.rv.yes], n: [...this.rv.no], need: this.rvNeed(), t: Math.ceil(this.rv.t) };
    if (this.phase === 'lobby') o.lb = r1(this.lobbyGo);
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
const ACTS = new Set(['q', 'e', 'r', 'u1', 'u2', 'u3', 'u4', 'd1', 'd2', 'd3', 'd4', 'z', 'dr']);
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
    I.ax = clamp(n(m.ax), -9999, 9999); I.ay = clamp(n(m.ay), -9999, 9999); I.f = m.f ? 1 : 0; I.as = m.as ? 1 : 0; I.mb = clamp(n(m.mb), 0, 1); I.ck = clamp((I.ck || 0) + clamp(n(m.ck) | 0, 0, 12), 0, 40);
    I.thr = clamp(n(m.thr) || 0.65, 0.25, 1); I.idle = m.idle ? 1 : 0; I.sx = clamp(+m.sx | 0, -1, 1); I.rt = Number.isInteger(m.rt) ? clamp(m.rt, -1, NSEC) : -1;
    { const seat = R.seatOf(c); if (seat && seat.idx === REPAIR && Array.isArray(m.dm) && R.ship) { if (m.dm.length === 0) R.ship.dg = null; else if (m.dm.length === 2 && isFinite(m.dm[0]) && isFinite(m.dm[1])) R.sendDrones(m.dm[0], m.dm[1]); } }
    if (Array.isArray(m.a)) for (const a of m.a.slice(0, 6)) if (ACTS.has(a) && c.acts.length < 12) c.acts.push(a);
  } else if (m.t === 'role') R.switchRole(c, m.role | 0);
  else if (m.t === 'buy') {
    if (R.phase === 'mission') return sendTo(c, { t: 'toast', m: 'Upgrades are bought between missions' });
    const seat = R.seatOf(c), tk = TREES[m.tree] ? m.tree : TREE_OF[seat ? seat.idx : 0], kind = String(m.kind); let err;
    if (kind === 'port') err = seat ? R.buyPort(c.prof, seat.idx, m.slot | 0, String(m.id)) : 'take a station first';
    else if (kind === 'pup') err = seat ? R.upPort(c.prof, seat.idx, m.slot | 0, String(m.opt)) : 'take a station first';
    else err = buy(c.prof, tk, kind, String(m.id), R.mk);
    if (err) sendTo(c, { t: 'toast', m: err }); c.dirty = 1; R.calcStats();
  } else if (m.t === 'mk') { if (R.phase !== 'mission') { if (!R.buyMk()) sendTo(c, { t: 'toast', m: 'Not enough Morph Metal' }); } }
  else if (m.t === 'core') { if (R.phase !== 'mission') { const err = m.hull ? R.hullCore() : R.convertCore(); if (err) sendTo(c, { t: 'toast', m: err }); } }
  else if (m.t === 'start' && R.phase === 'lobby') { if (R.humans()) R.lobbyGo = R.lobbyGo > 0 ? 0 : 3.5; }
  else if (m.t === 'restart') { const err = R.restartVote(c); if (err) sendTo(c, { t: 'toast', m: err }); }
  else if (m.t === 'rvote') { const err = R.rvVote(c, m.v ? 1 : 0); if (err) sendTo(c, { t: 'toast', m: err }); }
  else if (m.t === 'ready' && (R.phase === 'upgrade' || R.phase === 'intro')) { if (m.v === 0) R.ready.delete(c.pid); else R.ready.add(c.pid); }
  else if (m.t === 'vote' && R.phase === 'map') { if (R.options.some(o => o.id === m.id)) R.votes.set(c.pid, m.id); }
  else if (m.t === 'name') { c.prof.name = String(m.name || '').replace(/[^\w \-\.!?]/g, '').trim().slice(0, 14) || c.prof.name; c.dirty = 1; }
  else if (m.t === 'ping') sendTo(c, { t: 'pong', ts: m.ts });
  else if (DEV && m.t === 'dev') devOp(R, c, m);
}
// test-only hooks (enabled with DEV_TOOLS=1): used by the screenshot script and tests to stage scenes
function devOp(R, c, m) {
  const s = R.ship;
  if (m.op === 'setmk') { R.mk = clamp(m.mk | 0, 0, 3); R.resetShip(); for (let r = 0; r < 6; r++) for (let sl = 0; sl < R.mk; sl++) if (!R.ports[r][sl]) R.ports[r][sl] = { id: TREES[TREE_OF[r]].ports[(r + sl) % 3][0], lv: sl + 1, u: {} }; c.dirty = 1; }
  else if (m.op === 'port') { const r = m.r | 0, sl = m.sl | 0; R.ports[r][sl] = { id: String(m.id), lv: m.lv | 0, u: m.u || {} }; if (R.mk <= sl) R.mk = sl + 1; R.resetShip(); c.dirty = 1; }   // v6 dev: install a port directly
  else if (m.op === 'mset') { if (R.mission) Object.assign(R.mission, m.v || {}); }   // v6 dev: tweak the running mission (e.g. fast-forward its timer)
  else if (m.op === 'noport') { R.ports[m.r | 0][m.sl | 0] = null; R.resetShip(); }   // v6 dev: empty a port slot
  else if (m.op === 'give') { c.prof.cr += m.cr | 0; R.cores += m.cores | 0; c.dirty = 1; }
  else if (m.op === 'phase') { R.phase = m.ph; R.phaseT = m.secs || 40; if (m.ph === 'upgrade') R.result = R.result || { win: 1, bonus: 30, cores: 1, name: 'Test', type: 'pirates' }; c.dirty = 1; }
  else if (m.op === 'spawn') { const a = +m.a || 0, d = +m.d || 700; const e = R.addEnemy(m.type | 0, s.x + cos(a) * d, s.y + sin(a) * d, m.L || 8, 'dom', true); e.a = a + PI; if (m.static) e.cd = 1e9; if (m.hpx) { e.hp *= m.hpx; e.mhp *= m.hpx; } }
  else if (m.op === 'squad') { const a = +m.a || 0, d = +m.d || 1100; R.spawnSquad(m.type | 0 || 1, { x: s.x + cos(a) * d, y: s.y + sin(a) * d }, m.L || 8, 'dom', m.n | 0 || 5); }   // v8 dev: spawn a V / triangle squadron
  else if (m.op === 'clear') { R.enemies = []; R.eb = []; }
  else if (m.op === 'ionhit') R.hitShip(s.x, s.y, 1, 1, { t: 3 });   // v7 dev: the ship takes an ion hit (stun)
  else if (m.op === 'estun') { for (const e of R.enemies) e.stun = +m.v || 3; }
  else if (m.op === 'ionbolt') { const a = +m.a || 0, d = +m.d || 900; R.fireEB(s.x + cos(a) * d, s.y + sin(a) * d, a + PI, 'ion', s, m.L || 8); }
  else if (m.op === 'mission') { R.startMission(Object.assign({}, R.options[m.i | 0 || 0], m.over || {})); }
  else if (m.op === 'ship') { Object.assign(s, m.v || {}); }
  else if (m.op === 'path') { const P = c.prof.t[m.tree]; P.path = (m.path || []).slice(0, 5); c.dirty = 1; R.calcStats(); }
  else if (m.op === 'hurt') { for (const k of m.k || []) { s.sec[k].dn = 1; s.sec[k].hp = 0; R.ev('sd', k); } }
  else if (m.op === 'drop') { for (let i = 0; i < (m.n | 0 || 6); i++) { const an = (+m.a || 0) + i * 0.9, dd = (+m.d || 260) + (i % 3) * 40; R.dropCredits(s.x + cos(an) * dd, s.y + sin(an) * dd, 5); const pk = R.picks[R.picks.length - 1]; pk.vx = pk.vy = 0; pk.life = m.life || 40; } }
  else if (m.op === 'mapopt') { if (R.options[m.i | 0]) R.options[m.i | 0].type = m.type; }
  else if (m.op === 'shp') { s.shp = +m.v; s.shDown = 0; }
}

function tickAll() { for (const r of rooms.values()) { if (!r.clients.size) continue; try { r.step(); } catch (e) { console.error('room', r.code, e); } } }
function start() {
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: 1, v: D.VERSION, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0), uptime: process.uptime() | 0 })); }
    if (u === '/rooms') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...rooms.values()].map(r => ({ code: r.code, pub: r.pub, humans: r.humans(), phase: r.phase, mission: r.mission && r.mission.name, type: r.mission && r.mission.type, mainDone: r.mainDone, mk: r.mk, score: r.score, lv: r.mission ? r.mission.level : r.mainDone + 1, names: [...r.clients].map(c => c.prof.name), cap: 6, empty: r.clients.size ? 0 : 1 })))); }
    if (u === '/new') { res.writeHead(302, { location: '/?room=' + newCode() }); return res.end(); }
    let f = files[u]; if (!f && /^\/r\/[A-Za-z0-9]+$/.test(u)) f = files['/'];
    if (!f) { res.writeHead(404); return res.end('not found'); }
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304); return res.end(); }
    const gz = !f.bin && /gzip/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': f.type, 'cache-control': f.bin ? 'public, max-age=3600' : 'no-cache', etag: f.etag, ...(gz ? { 'content-encoding': 'gzip' } : {}) });
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
    for (const [code, r] of rooms) if (!r.clients.size && Date.now() - r.emptySince > ROOM_GRACE) rooms.delete(code);   // v9: only bots left => the game ends and the ship is removed
  }, 1000 / 60);
  if (process.env.WATCH) fs.watch(PUB, () => { try { loadFiles(); } catch (e) { } });
  server.listen(PORT, () => console.log('Spacebelts Optional v' + D.VERSION + ' on :' + PORT));
}
if (require.main === module) start();
module.exports = { Room, buy, botSpend, rooms };
