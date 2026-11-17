// v3 WebSocket integration test: rooms, bots, weighted voting, full mission -> upgrade -> ready loop, abilities,
// skill-pyramid rules, permanent ports, Mk upgrades + core conversion, independent shield aim, enemy shields/docks.
// Checks that need credits/cores/spawns use the dev hooks and run only when the server was started with DEV_TOOLS=1 (auto-detected).
const WebSocket = require('ws');
const D = require('../public/defs.js');
const BASE = process.argv[2] || 'http://localhost:8080';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, snaps: 0, last: null, evs: {}, abs: [], phases: [], toasts: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'test-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m); if (m.t === 's') { c.snaps++; c.last = m; if (c.phases[c.phases.length - 1] !== m.ph) c.phases.push(m.ph); for (const e of m.ev) { c.evs[e[0]] = (c.evs[e[0]] || 0) + 1; if (e[0] === 'ab') c.abs.push(e[2]); } } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
async function until(fn, ms) { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(200); } return false; }
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const h0 = await (await fetch(BASE + '/health')).json(); console.log('health', h0); check(h0.v === D.VERSION && D.VERSION === 3, 'health reports v3');
  const t0 = Date.now(); const a = await client('', 'Alice', 0); check(a.me.role === 0 && a.me.pub, `public join as Pilot in ${Date.now() - t0}ms (room ${a.me.code})`);
  await sleep(2500);
  check(a.snaps > 25, `snapshots streaming: ${a.snaps} in 2.5s`);
  check(a.last.crew.filter(c => c[1]).length === 5, 'other 5 seats are bots: ' + a.last.crew.map(c => c[0] + (c[1] ? '(bot)' : '')).join(', '));
  check(a.last.crew.every(c => Array.isArray(c[5]) && c[5].length === 3 && Array.isArray(c[7]) && c[7].length === 2), 'every crew entry carries 3 ability slots + 2 port slots');
  const S = a.last.sh;
  check(S.sc.length === 18 && S.dn.length === 18, 'snapshot has 18 ship sections (6 stations + 12 port sockets)');
  check(S.sc.slice(0, 6).every(v => v >= 0) && S.sc.slice(6).every(v => v === -1), 'Mk I: only the 6 stations exist, no extra port sections yet');
  check(S.arc === 15 && S.shm > 0 && S.shp === S.shm && S.shd === 0, `shield starts as a ${S.arc}° arc, ${S.shp}/${S.shm} HP, up`);
  a.send({ t: 'i', ax: a.last.sh.x + 1000, ay: a.last.sh.y, f: 1, idle: 1 });
  // private room, 3 humans: pilot vote weight = 2
  const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const b = await client(code, 'Bob', 0), c = await client(code, 'Cara', 0), d = await client(code, 'Dan', 4);
  check(b.me.code === code && b.me.role === 0, `private room ${code}: Bob is Pilot`);
  check(c.me.role !== 0 && c.me.role >= 0, `Cara got a different free seat (${c.me.role})`);
  c.send({ t: 'role', role: 3 }); await sleep(500); check(c.me.role === 3, 'Cara switched to Engineer (took a bot seat)');
  c.send({ t: 'role', role: 0 }); await sleep(400); check(c.me.role === 3, 'Cara cannot steal the human Pilot seat');
  await until(() => b.last && b.last.ph === 'map', 8000);
  check(b.last.ph === 'map' && b.last.opts.length === 5, `star map offers ${b.last.opts && b.last.opts.length} missions (1 main + 4 sides): ` + (b.last.opts || []).map(o => o.type + '/' + ['E', 'N', 'H', 'X'][o.diff] + '@' + o.planet.name + ':' + o.planet.kind).join(', '));
  check(b.last.opts.every(o => D.PLANET_K.includes(o.planet.kind)), 'every planet has one of the ' + D.PLANET_K.length + ' realistic kinds');
  check(b.last.pw === 2, `pilot vote weight with 3 players = ${b.last.pw}`);
  const opt = b.last.opts.find(o => o.type === 'pirates' || o.type === 'defend') || b.last.opts[0], other = b.last.opts.find(o => o !== opt);
  b.send({ t: 'vote', id: opt.id }); c.send({ t: 'vote', id: other.id }); await sleep(300);
  check(b.last.votes[opt.id] === 2 && b.last.votes[other.id] === 1, `weighted tally: pilot pick=${b.last.votes[opt.id]}, Cara's pick=${b.last.votes[other.id]}`);
  d.send({ t: 'vote', id: opt.id });
  await until(() => b.last.ph === 'mission', 4000);
  check(b.last.ph === 'mission' && b.last.mi.name === opt.planet.name, `all voted -> mission launched at ${b.last.mi && b.last.mi.name} (${b.last.mi && b.last.mi.type})`);
  // independent shield aim: Dan (Shield) points the arc at +x; turning the ship must not rotate it
  const hs = () => b.last.sh;
  d.send({ t: 'i', ax: hs().x + 2000, ay: hs().y, idle: 0 }); await sleep(2500);
  const sa0 = hs().sa; check(Math.abs(sa0) < 0.25, `shield arc aimed by its own player at the cursor (sa=${sa0})`);
  const DEV = await (async () => { b.send({ t: 'dev', op: 'give', cr: 5, cores: 0 }); await sleep(400); return b.me.cr >= 5 && b.toasts.length >= 0 && (await until(() => b.me.cr >= 5, 600)); })();
  const crBefore = b.me.cr;
  if (DEV) {
    console.log('dev tools detected: running staged checks');
    b.send({ t: 'dev', op: 'ship', v: { a: 2.4 } }); d.send({ t: 'i', ax: hs().x + 2000, ay: hs().y, idle: 0 }); await sleep(200);
    check(Math.abs(hs().sa - sa0) < 0.5, `ship turned (a=${hs().a}) but shield arc stayed at the cursor (sa=${hs().sa})`);
    b.send({ t: 'dev', op: 'clear' }); b.send({ t: 'dev', op: 'spawn', type: 16, a: 0, d: 1200, L: 9, static: 1 }); await sleep(600);
    const car = b.last.e.find(e => e[1] === 16);
    check(car && Array.isArray(car[8]) && car[8].length === D.ETYPES[16].ports.length && car[9] > 0, 'Carrier spawned with high-HP ports and an enemy shield (fraction ' + (car && car[9]) + ')');
    check(D.ETYPES[16].ports.some(p => p.w === 'dock') && D.ETYPES[7].ports.some(p => p.w === 'dock'), 'large ships carry a shipping dock port');
    let spawned = 0; b.send({ t: 'dev', op: 'clear' }); b.send({ t: 'dev', op: 'spawn', type: 7, a: 0, d: 700, L: 8 }); await sleep(14000);
    spawned = b.evs.dock || 0; check(spawned > 0, `frigate dock spawned fighters (${spawned} dock events)`);
    b.send({ t: 'dev', op: 'clear' });
  }
  for (const x of [b, c, d]) x.send({ t: 'i', ax: 0, ay: 0, idle: 1 }); // let bots fly our seats
  console.log('waiting for the mission to finish (bots flying idle seats)...');
  await until(() => b.last.ph === 'upgrade', 400000);
  check(b.phases.includes('result') && b.last.ph === 'upgrade', `mission ended -> upgrade screen (phases ${b.phases.join('>')}, result ${JSON.stringify(b.last.res)})`);
  check(b.me.cr > crBefore, `credits earned: Bob ${b.me.cr}, Cara ${c.me.cr}, Dan ${d.me.cr}`);
  check((b.evs.pick || 0) > 0, `credit chips picked up in mission: ${b.evs.pick}`);
  // ---- skill pyramid rules ----
  const TP = D.TREES.pilot; if (DEV) b.send({ t: 'dev', op: 'give', cr: 5000, cores: 0 }); await sleep(400);
  const P = () => b.me.tr.pilot.path;
  check(P().length === 0 && TP.rows.map(r => r.length).join() === '6,5,4,3,2', 'pyramid has rows 6/5/4/3/2 and nothing picked yet');
  if (b.me.cr >= D.NODE_COST[0]) {
    const cr0 = b.me.cr; b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: TP.rows[0][2].id }); await sleep(400);
    check(P().join() === '2' && b.me.cr === cr0 - D.NODE_COST[0], `row 1 pick (${TP.rows[0][2].n}) costs ${D.NODE_COST[0]}: path ${P()}`);
    b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: TP.rows[0][3].id }); await sleep(300); check(P().length === 1, 'cannot pick a second node in the same row');
    b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: TP.rows[1][4].id }); await sleep(300); check(P().length === 1, 'row 2 node not adjacent to the previous pick is refused');
    if (b.me.cr >= D.NODE_COST[1]) { b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: TP.rows[1][1].id }); await sleep(300); check(P().join() === '2,1', 'adjacent row 2 node accepted: path ' + P()); }
    check(D.pyrAllowed([0], 1).join() === '0' && D.pyrAllowed([5], 1).join() === '4' && D.pyrAllowed([2], 1).join() === '1,2', 'edge picks lead to 1 choice, middle picks to 2');
  } else console.log('SKIP pyramid buys: not enough credits (run with DEV_TOOLS=1)');
  const cI = b.me.cr; b.send({ t: 'buy', tree: 'pilot', kind: 'inf', id: 'i_turn' }); await sleep(300); if (cI >= D.infCost(0)) check(b.me.tr.pilot.i.i_turn === 1, 'infinite upgrade bought');
  // ---- ports are permanent, need a Mk upgrade, are bought per seat ----
  b.send({ t: 'buy', tree: 'pilot', kind: 'port', id: 'twin', slot: 0 }); await sleep(300); check(!b.last.crew[0][7][0], 'port refused at Mk I (needs a ship upgrade)');
  if (DEV) {
    b.send({ t: 'dev', op: 'give', cr: 0, cores: 40 }); await sleep(300); b.send({ t: 'mk' }); await sleep(400);
    check(b.last.mk === 1 && b.last.sh.sc[6 + 0] === -1, 'Mk II bought with ' + D.MK_COST[1] + ' cores; the section appears only once the port is installed');
    b.send({ t: 'buy', tree: 'pilot', kind: 'port', id: 'twin', slot: 0 }); await sleep(400);
    check(b.last.crew[0][7][0] && b.last.crew[0][7][0][0] === 'twin' && b.last.sh.sc[6] >= 0, 'Wing Cannon installed: pilot gets a physical extra section (sc[6]=' + b.last.sh.sc[6] + ')');
    b.send({ t: 'buy', tree: 'pilot', kind: 'port', id: 'rockets', slot: 0 }); await sleep(300); check(b.last.crew[0][7][0][0] === 'twin', 'port choice is permanent');
    b.send({ t: 'buy', tree: 'pilot', kind: 'pup', slot: 0 }); await sleep(300); check(b.last.crew[0][7][0][1] === 1, 'each port is upgraded separately (lv ' + b.last.crew[0][7][0][1] + ')');
    const g0 = b.me.cr; b.send({ t: 'mk' }); await sleep(400); check(b.last.mk === 2, 'Mk III bought'); b.send({ t: 'core' }); await sleep(400);
    check(b.me.cr === g0 + D.CORE_RATE, `core -> credits conversion after Mk III: +${b.me.cr - g0} (rate ${D.CORE_RATE})`);
    b.send({ t: 'dev', op: 'hurt', k: [6] }); await sleep(300);
  }
  for (const x of [b, c, d]) x.send({ t: 'ready' });
  await until(() => b.last.ph === 'map', 3000); check(b.last.ph === 'map', 'everyone READY -> back to the star map early');
  for (const x of [b, c, d]) x.send({ t: 'vote', id: b.last.opts[0].id });
  await until(() => b.last.ph === 'mission', 4000);
  if (DEV) { check(b.last.sh.dn[6] === 0 || b.last.sh.dn[6] === 1, 'section flags present after ship reset'); }
  await sleep(1500); b.send({ t: 'i', ax: 0, ay: 0, idle: 0, a: ['q'] }); await sleep(800);
  check(b.abs.includes('roll'), `pilot used Q ability -> ${b.abs.join(',')}`);
  check(a.abs.length > 0 || c.abs.length > 0, `bots use abilities too: ${[...new Set(c.abs)].join(',')}`);
  check((a.evs.b || 0) > 20, `lasers fired (public): ${a.evs.b}`); check((a.evs.boom || 0) > 3, `explosions: ${a.evs.boom}`);
  console.log('private event counts:', JSON.stringify(b.evs));
  d.ws.close(); await sleep(800); check(c.last.crew[4][1] === 1, 'Dan left -> bot took the Shield seat');
  const h = await (await fetch(BASE + '/health')).json(); console.log('health', h); check(h.v === 3, 'health reports v3');
  a.ws.close(); b.ws.close(); c.ws.close();
  console.log(ok ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
