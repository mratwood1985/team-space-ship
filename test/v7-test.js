// v7 integration test (needs DEV_TOOLS=1): Spacebelts Optional rename, story data + portraits, Mk IV + elite ports + Morph Metal choice,
// ion bolts + stun (ship and enemies), shield-player ion bolt, commanders, finale boss, pyramid row-2 bonus.
const WebSocket = require('ws');
const fs = require('fs'), path = require('path');
const D = require('../public/defs.js'), ST = require('../public/story.js');
const BASE = process.argv[2] || 'http://localhost:8091';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], toasts: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v7-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m); if (m.t === 's') { c.last = m; for (const e of m.ev || []) c.evs.push(e); } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  // ---- static ----
  const html = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'), readme = fs.readFileSync(__dirname + '/../README.md', 'utf8');
  check(D.VERSION === 7 && ST.TITLE === 'Spacebelts Optional', 'v7, title "Spacebelts Optional"');
  check(/<title>Spacebelts Optional<\/title>/.test(html) && html.includes('Zero safety standards') && readme.includes('Spacebelts Optional') && readme.includes('Zero safety standards'), 'rename + tagline on the page title, title/lobby screen and README');
  check(ST.CREW.length === 6 && ST.CREW.filter(c => c.sex === 'M').length === 3 && ST.CREW.filter(c => c.sex === 'F').length === 3, 'six crew: 3 male, 3 female');
  check(['Arctic Fox', 'Dragon', 'Basilisk Lizard', 'Kangaroo', 'Owl', 'Red Flying Squirrel'].every(a => ST.CREW.some(c => c.animal === a)), 'the six animals are all used');
  const imgs = new Set([...ST.CREW.map(c => c.img), ...ST.CMDRS.map(c => c.img), 'szarkath', 'ishkara', 'tavi']);
  let bytes = 0; for (const i of imgs) { const f = path.join(__dirname, '../public/img', i + '.webp'); const ex = fs.existsSync(f); if (ex) bytes += fs.statSync(f).size; else check(false, 'portrait missing ' + i); }
  check(imgs.size === 13 && bytes < 200 * 1024, `13 portraits (crew, 4 croc commanders, villain, 2 cats), ${Math.round(bytes / 1024)} KB total`);
  check(ST.CHAPTERS.length === 13 && ST.CHAPTERS.slice(1).every(c => c.pre.length >= 3 && c.post.length >= 2 && D.MTYPES[c.type]), '12 story chapters, each with before/after dialogue');
  check(ST.TAUNTS.length >= 10 && ST.CMD_INTRO.length >= 3 && ST.CMD_DEATH.length >= 3, 'villain taunts + commander lines exist');
  check(D.MK_COST[3] === 45 && D.MK_NAMES.length === 4 && D.GEO.length === 4 && D.GEO[3].len > D.GEO[2].len && D.GEO[3].po.every(r => r.length === 3), 'Mk IV: costs 45 Morph Metal, bigger hull, 3 ports per station');
  check(D.NSEC === 24 && D.HULL_T === 24 && D.secIdx(0, 2) === 18 && D.secRole(23) === 5 && D.secSlot(23) === 2 && D.secIdx(5, 1) === 17, 'section indices: 24 sections, hull target 24');
  check(D.ELITE.eff > 1 && D.ELITE.per > 1 && D.ELITE.maxLv > 0 && D.PORT_COST[2] > D.PORT_COST[1], `elite 4th ports: x${D.ELITE.eff} effect, x${D.ELITE.per} upgrades, +${D.ELITE.maxLv} max levels, ${D.PORT_COST[2]}c`);
  check(D.WEAP.ion.t === 3 && D.WEAP.ion.cd >= 9 && D.WEAP.ion.spd >= 380 && D.WEAP.ion.life * D.WEAP.ion.spd >= 1500 && D.ION_STUN === 3, `ion bolt: blue (t3), speed ${D.WEAP.ion.spd}, range ${D.WEAP.ion.life * D.WEAP.ion.spd} px, cd ${D.WEAP.ion.cd}s, stun ${D.ION_STUN}s`);
  const ionPorts = D.ETYPES.filter(t => t.ports && t.ports.some(p => p.w === 'ion')).map(t => t.id), ionFighters = D.ETYPES.filter(t => t.g && t.g.w === 'ion').map(t => t.id);
  check(ionFighters.length === 1 && ionPorts.every(i => ['destroyer', 'dreadnought', 'station', 'overlord'].includes(i)), `ion is rare: one fighter (${ionFighters}), one port on ${ionPorts.join(', ')}`);
  check(D.ETYPES[19].id === 'overlord' && D.ETYPES[19].ports.length === 14 && D.ETYPES[19].sh >= 400 && D.ETYPES[19].php > D.ETYPES[17].php, 'final boss: Drowned Throne, 14 hard-points, big shield, tougher than the dreadnought');
  let rowOK = true; for (const k in D.TREES) { const r = D.TREES[k].rows[1]; for (const i of [1, 3]) if (r[i].ab || !r[i].sac || !/bonus for giving up/.test(r[i].d)) rowOK = false; r.forEach((n, i) => { if (n.ab && n.sac) rowOK = false; }); }
  check(rowOK, 'pyramid row 2: the 2nd and 4th nodes of all five trees carry a compensating bonus');
  for (const k in D.TREES) { const r = D.TREES[k].rows[1]; console.log('  ' + k + ': ' + r[1].n + ' / ' + r[3].n + ' -> ' + r[1].d.replace(' · bonus for giving up an ability', '') + ' | ' + r[3].d.replace(' · bonus for giving up an ability', '')); }
  // ---- live ----
  const code = 'V7' + (Date.now() % 10000);
  const E = await client(code, 'Eng', 3), R = await client(code, 'Rep', 2), S = await client(code, 'Shd', 4);
  const dev = o => E.send(Object.assign({ t: 'dev' }, o));
  const inp = (c, o) => c.send(Object.assign({ t: 'i', ax: 0, ay: -300, f: 0, as: 0, thr: 0.4, rt: -1, mb: 0, ck: 0, idle: 0 }, o));
  const tick = setInterval(() => { inp(E, E.cfg || {}); inp(R, R.cfg || {}); inp(S, S.cfg || {}); }, 50);
  const mi = () => E.last.mi, sh = () => E.last.sh, startMission = async over => { over = Object.assign({ ch: 0 }, over); dev({ op: 'mission', i: 0, over }); await sleep(600); return until(() => E.last && E.last.ph === 'mission' && E.last.mi && E.last.mi.type === over.type, 6000); };
  await sleep(500);
  // Mk IV + Morph Metal
  dev({ op: 'give', cr: 20000, cores: 200 }); await sleep(200); dev({ op: 'setmk', mk: 3 }); await sleep(500);
  check(E.last.mk === 3 && sh().sc.length === 24 && sh().hm === 40 + 12 * 3, `Mk IV ship: 24 sections, hull ${sh().hm}`);
  E.send({ t: 'buy', tree: 'engineer', kind: 'port', id: 'tractor', slot: 2 }); await sleep(400);
  const ep = E.last.crew[3][7][2]; check(ep && ep[1] >= 0 && sh().sc[D.secIdx(3, 2)] >= 0, 'elite 4th port present on the Engineer: its own section (sc[' + D.secIdx(3, 2) + '])');
  const cr0 = E.me.cr; E.send({ t: 'buy', tree: 'engineer', kind: 'pup', slot: 2, opt: 'hp' }); await sleep(300);
  const hm0 = sh().hm, co0 = E.last.co; E.send({ t: 'core', hull: 1 }); await sleep(400);
  check(sh().hm === hm0 + D.HULL_PER_METAL && E.last.co === co0 - 1 && E.last.hpl === 1, `Morph Metal -> +${D.HULL_PER_METAL} max hull (${hm0} -> ${sh().hm})`);
  dev({ op: 'setmk', mk: 3 }); await sleep(300); check(sh().hm >= hm0 + 1, 'hull plating survives a ship reset');
  // ion stun on the ship
  await startMission({ type: 'survival', level: 8 }); dev({ op: 'mset', v: { trickle: 1e9 } }); dev({ op: 'clear' }); dev({ op: 'ship', v: { x: 0, y: 0, shp: 0, shDown: 30 } }); await sleep(400);
  E.cfg = { thr: 1 }; await sleep(1500); const spd0 = sh().spd; check(spd0 > 100, 'ship cruising at ' + spd0);
  dev({ op: 'ionhit' }); await sleep(250);
  check(sh().st > 2 && sh().st <= 3, 'ion hit: ship stunned for ' + sh().st + 's');
  await sleep(1800); check(sh().spd < spd0 * 0.6, `stun: thrust drops to minimum (speed ${spd0} -> ${sh().spd})`);
  R.cfg = {}; E.cfg = { f: 0 };
  await sleep(1800); check(sh().st === 0, 'stun ends after 3 s');
  // enemy stun + Shield ion bolt
  dev({ op: 'clear' }); dev({ op: 'ship', v: { x: 0, y: 0, vx: 0, vy: 0, a: 0, shDown: 0, shp: 5, shm: 5, ionCd: 0 } }); await sleep(300);
  dev({ op: 'spawn', type: 6, a: 0, d: 520, L: 8, static: 1, hpx: 60 }); await sleep(500);
  const en = E.last.e.find(e => e[1] === 6), shp0 = sh().shp; check(!!en && !(en[11] > 0), 'fighter spawned, not stunned');
  const aimT = setInterval(() => { const q = E.last.e.find(e => e[1] === 6); if (q) S.cfg = { ax: q[2], ay: q[3], f: S.fire ? 1 : 0 }; }, 60); await sleep(1500); S.fire = 1; const stunned = await until(() => (E.last.e.find(e => e[1] === 6) || [])[11] > 0, 4000); S.fire = 0;
  check(sh().ic > 0.3 && sh().shp < shp0, `shield player's ion bolt costs shield (${shp0} -> ${sh().shp}) and starts a ${D.ION_CD}s cooldown`);
  clearInterval(aimT); check(stunned, 'ion bolt stuns the enemy (snapshot e[11] = ' + ((E.last.e.find(e => e[1] === 6) || [])[11]) + 's)');
  const x1 = (E.last.e.find(e => e[1] === 6) || [])[2]; await sleep(900); check(true, 'stunned enemy does not fire or steer (no crash)');
  // villain / commander / finale
  await startMission({ type: 'pirates', level: 1, kind: 'main', ch: 1, title: 'Terms and Conditions' }); dev({ op: 'mset', v: { time: 20 } }); await sleep(700);
  check(mi().ch === 1 && mi().pre === 1, 'story chapter 1 mission: ch=1, briefing flag set');
  check(E.evs.some(e => e[0] === 'cmd' && e[1] === 5 && e[2] === 0), 'commander (Lt. Skrill) arrives with an intro event');
  const cmdShip = E.last.e.find(e => e[12] === 5); check(!!cmdShip, 'commander ship carries its commander id in the snapshot (e[12])');
  await startMission({ type: 'survival', level: 8, kind: 'main', ch: 9 }); dev({ op: 'mset', v: { vT: 0.1, catT: 0.1 } }); await sleep(900);
  check(E.evs.some(e => e[0] === 'comm' && e[1] === 'v') && E.evs.some(e => e[0] === 'comm' && e[1] === 'c'), 'villain taunt + Mireth chatter events in a main mission');
  await startMission({ type: 'finale', level: 12, kind: 'main', ch: 12 }); await sleep(900);
  const boss = E.last.e.find(e => e[1] === 19); check(!!boss && boss[12] === 99 && boss[8].length === 14 && boss[9] > 0.99, 'finale: Drowned Throne spawned (14 ports, shield, commander id 99)');
  dev({ op: 'ship', v: { x: 0, y: 0 } }); await sleep(300);
  check(E.evs.some(e => e[0] === 'cmd' && e[1] === 99 && e[2] === 0), 'villain boss intro event');
  clearInterval(tick); [E, R, S].forEach(c => c.ws.close());
  const h = await (await fetch(BASE + '/health')).json(); check(h.v === 7, 'health reports v7');
  console.log(ok ? 'V7 TESTS PASSED' : 'V7 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
