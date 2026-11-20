// v9 test: 0 starting credits per run, faster player voices + variants, stronger radiation, steeper reroute drain, restart VOTE (public too),
// ship browser data (/rooms), empty ships removed after a grace period, 3 port choices per slot (gunners: 5 repeatable guns + Port 3 Double Barrel),
// uncapped Strafe Thrusters upgrade, throttle lag + throttle power drain, no star-map / upgrade timers (ready / all voted), pilot breaks vote ties.
//   node test/v9-test.js http://localhost:8091      (in-process Room checks + live WebSocket checks)
const WebSocket = require('ws'), fs = require('fs'), path = require('path');
const D = require('../public/defs.js'), ST = require('../public/story.js');
const { Room } = require('../server.js');
const BASE = process.argv[2] || 'http://localhost:8091', wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5, DT = 1 / 30;
let pidc = 9000;
const mkC = (name, cr = 0) => ({ pid: ++pidc, ws: { readyState: 0 }, prof: { name, cr, earned: 0, t: {} }, inp: {}, acts: [] });
const steps = (r, sec) => { for (let i = 0; i < sec * 30; i++) r.step(); };
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], toasts: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v9-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m); if (m.t === 's') { c.last = m; for (const e of m.ev) c.evs.push(e); } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  // ---------- static ----------
  check(D.VERSION === 9, 'VERSION 9');
  const RC = D.RR_CFG; check(RC.drain[10] >= 12 && RC.drain[5] >= 3.5 && RC.drain[1] === 1, `item 4: steeper reroute drain (5 slots ${(RC.base * RC.drain[5]).toFixed(1)}/s, 10 slots ${(RC.base * RC.drain[10]).toFixed(1)}/s; v8 was 5.5 / 18.9)`);
  check(D.HAZ.rad.dps >= 1.2, `item 3: radiation hull damage ${D.HAZ.rad.dps}/s (v8: 0.6)`);
  for (const t of ['pilot', 'engineer', 'shield', 'repair']) {
    const S = D.PORT_SLOTS[t], all = S.flat();
    check(S.length === 3 && S.every(sl => sl.length === 3 && new Set(sl).size === 3) && new Set(all).size === 9 && all.every(id => D.TREES[t].ports.some(p => p[0] === id)), `item 8: ${t}: 3 distinct choices per slot, no repeats across slots (${S.map(x => x.join('/')).join(' | ')})`);
    check(all.every(id => (D.PORT_UPS[t + '.' + id] || []).length >= 2), `${t}: every port has its own upgrade list`);
  }
  const G = D.PORT_SLOTS.gun; check(G.length === 3 && G.every(sl => sl.length === 5 && sl.join() === G[0].join()) && G[0].every(id => D.TREES.gun.ports.some(p => p[0] === id)), `item 8: gunners: the same 5 guns in every slot (${G[0].join(', ')})`);
  check(G[0].every(id => D.portUps('gun', id, 2).some(u => u.o === 'dbl')) && G[0].every(id => !D.portUps('gun', id, 0).some(u => u.o === 'dbl') && !D.portUps('gun', id, 1).some(u => u.o === 'dbl')) && !D.portUps('pilot', 'twin', 2).some(u => u.o === 'dbl'), 'item 8: Double Barrel is offered for every gun in Port 3 only');
  const inf = D.TREES.pilot.inf.find(x => x[0] === 'i_strafe'); check(inf && inf[2] === 'strafe' && !D.infCap('pilot', 'i_strafe', 999), 'item 9: pilot Strafe Thrusters upgrade exists with no level cap');
  check(ST.FINN_VAR.half.length >= 3 && ST.FINN_VAR.low.length >= 3 && ST.CARE_VAR.length >= 3 && new Set(ST.FINN_VAR.half).size === ST.FINN_VAR.half.length, `item 12: variants: Finn 50% ${ST.FINN_VAR.half.length}, Finn critical ${ST.FINN_VAR.low.length}, care package ${ST.CARE_VAR.length}`);
  const vdir = path.join(__dirname, '../public/voice'), gv = fs.readFileSync(path.join(__dirname, '../tools/gen-voice.py'), 'utf8');
  const rate = w => +((gv.match(new RegExp("'" + w + "':\\s*\\('[^']+',\\s*'([+-]\\d+)%'")) || [])[1]);
  check(rate('finn') === 10 && rate('skids') === 18 && rate('mort') === 8 && rate('ophelia') === 7 && rate('ember') === 14 && rate('boomer') === 10 && rate('szarkath') === -14, 'item 2: player voices ~10% faster (finn +10, skids +18, boomer +10, mort +8, ophelia +7, ember +14), Szarkath unchanged (-14%)');
  const newer = ['finn_half_0', 'skids_x', 'mort_thr'].filter(f => fs.existsSync(path.join(vdir, f + '.mp3'))); check(newer.length >= 2 && ['finn_low_3', 'cat_care_2'].every(f => fs.existsSync(path.join(vdir, f + '.mp3'))), 'item 12: variant clips generated');
  const gjs = fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8'), html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  check(/id="browser"/.test(html) && /function openBrowser/.test(gjs) && /fetch\('\/rooms'/.test(gjs), 'item 6: ship browser overlay before the lobby');
  check(/id="rvote"/.test(html) && /t: 'rvote'/.test(gjs), 'item 5: restart vote banner with Yes / No');
  check(/function radFx/.test(gjs), 'item 3: radiation shimmer / smoke / ripple effect');
  check(/id="strafeh"/.test(gjs) && /Z \/ X/.test(gjs), 'item 9: pilot ability bar shows Z / X strafe + the upgrade level');
  check(/id="thrinfo"/.test(html) && /THR_TIP/.test(gjs) && fs.existsSync(path.join(vdir, 'mort_thr.mp3')), 'item 10: engineer throttle label + tooltip + one-time voiced tip');

  // ---------- in-process Room ----------
  { // item 1 + 7: a fresh run starts at 0 credits; reconnecting to the same run keeps progress
    const r = new Room('V9A', false), c = mkC('Rich', 750); c.prof.t = { pilot: { path: [1], i: {}, b: {} } };
    r.addClient(c, 0); check(c.prof.cr === 0 && !(c.prof.t.pilot.path || []).length, `item 1: joining a new run resets credits to 0 (was 750) and the pyramid`);
    c.prof.cr = 40; r.removeClient(c); r.addClient(c, 0); check(c.prof.cr === 40, 'reconnect to the same run keeps credits');
    const r2 = new Room('V9B', true); r.removeClient(c); r2.addClient(c, 0); check(c.prof.cr === 0, 'a different (new) ship starts from 0 again');
    check(new Room('V9P', true).phase === 'lobby', 'public ships also start in the character lobby');
  }
  { // item 5: restart vote, public ship
    const r = new Room('V9V', true), a = mkC('Ann'), b = mkC('Ben'), c = mkC('Cy'); r.addClient(a, 0); r.addClient(b, 1); r.addClient(c, 2);
    r.phase = 'map'; r.mainDone = 3; const run0 = r.runId; a.prof.cr = 99;
    r.restartVote(a); check(r.rv && r.rv.yes.size === 1 && r.phase === 'map', 'item 5: Ann starts a restart vote (1 yes, needs ' + r.rvNeed() + ')');
    r.rvVote(b, 0); check(r.rv && r.phase === 'map', 'Ben votes No: still open');
    r.rvVote(c, 1); check(!r.rv && r.phase === 'lobby' && r.mainDone === 0 && r.runId !== run0 && a.prof.cr === 0, 'Cy votes Yes: majority -> everyone back to the lobby, campaign + credits reset (public ship)');
    r.phase = 'map'; r.restartVote(a); r.rvVote(b, 0); r.rvVote(c, 0); check(!r.rv && r.phase === 'map', 'a majority of No ends the vote, nothing restarts');
    r.restartVote(a); steps(r, 31); check(!r.rv && r.phase === 'map', 'the vote expires after 30 s');
    const s1 = new Room('V9S', false), x = mkC('Solo'); s1.addClient(x, 0); s1.phase = 'map'; s1.restartVote(x); check(s1.phase === 'lobby' && !s1.rv, 'alone on a ship: restart is immediate');
  }
  { // item 11: no timers between missions, pilot breaks ties, bots auto-ready
    const r = new Room('V9R', false), p = mkC('Pil'), g = mkC('Gun'); r.addClient(p, PILOT); r.addClient(g, GUNR);
    r.phase = 'upgrade'; r.phaseT = 45; r.ready.clear(); steps(r, 70); check(r.phase === 'upgrade', 'item 11: upgrade screen waits 70 s+ with nobody ready (no timer)');
    r.ready.add(p.pid); steps(r, 5); check(r.phase === 'upgrade', 'one of two ready: still waiting');
    r.ready.add(g.pid); steps(r, 1); check(r.phase === 'map', 'all humans ready -> star map');
    steps(r, 70); check(r.phase === 'map', 'star map waits 70 s+ (no timer)');
    const [A, B] = r.options; r.votes.set(g.pid, B.id); r.votes.set(p.pid, A.id); check(r.chooseMission().id === A.id, 'item 11: 1:1 tie -> the human pilot\'s pick wins');
    r.votes.clear(); r.votes.set(g.pid, B.id); steps(r, 3); check(r.phase === 'map', 'only one of two voted: still waiting');
    r.votes.set(p.pid, A.id); steps(r, 2); check(r.phase === 'mission' && r.mission.id === A.id, 'everyone voted -> mission launches with the pilot tiebreak');
    const rb = new Room('V9Q', false), h = mkC('Gun2'), h2 = mkC('Eng2'); rb.addClient(h, GUNR); rb.addClient(h2, ENG); rb.phase = 'map'; rb.phaseT = 16; const [X, Y] = rb.options; rb.votes.set(h.pid, X.id); rb.votes.set(h2.pid, Y.id);
    check(rb.chooseMission().id === X.id || rb.chooseMission().id === Y.id, 'bot pilot: tie resolved by the old tiebreak');
    const rn = new Room('V9N', false); rn.phase = 'upgrade'; rn.phaseT = 1.5; steps(rn, 1); check(rn.phase === 'map', 'no humans: bots are always ready');
  }
  { // item 10: throttle lag + drain above 40%
    const r = new Room('V9T', false), e = mkC('Eng'); r.addClient(e, ENG); r.startMission(r.options[0]); r.ship.inv = 999; r.ship.hull = 999; r.ship.hm = 999;
    Object.assign(e.inp, { thr: 0.4, idle: 0, ax: 0, ay: -300 }); steps(r, 4); check(Math.abs(r.ship.thr - 0.4) < 0.02 && r.thrDrain() === 0, `item 10: throttle 40% -> no throttle drain (${r.thrDrain()})`);
    e.inp.thr = 1; steps(r, 0.5); const t05 = r.ship.thr; steps(r, 2); const t25 = r.ship.thr;
    check(t05 < 0.7 && t25 > 0.95, `engines spool slowly: set 100%, after 0.5 s ${Math.round(t05 * 100)}%, after 2.5 s ${Math.round(t25 * 100)}%`);
    const d100 = r.thrDrain(); e.inp.thr = 0.7; steps(r, 3); const d70 = r.thrDrain();
    check(d100 > 2.5 && d70 > 0.5 && d70 < d100, `drain scales with throttle: 70% -> ${d70.toFixed(2)}/s, 100% -> ${d100.toFixed(2)}/s`);
    const gain = th => { e.inp.thr = th; steps(r, 3); r.ship.pip = [0, 0, 0, 0]; r.ship.lock = 0; r.ship.en = 20; const e0 = r.ship.en; steps(r, 2); return r.ship.en - e0; };
    const g40 = gain(0.4), g100 = gain(1); check(g40 - g100 > 2 * d100 * 0.8, `energy over 2 s with no reroute slots: +${g40.toFixed(1)} at 40% vs +${g100.toFixed(1)} at 100% throttle`);
  }
  { // item 9: strafe upgrade, no cap
    const r = new Room('V9F', false), p = mkC('Pilo'); r.addClient(p, PILOT); r.calcStats(); const m0 = r.strafeM();
    p.prof.t.pilot.i.i_strafe = 25; r.calcStats(); const m25 = r.strafeM(); check(m0 === 1 && Math.abs(m25 - 3) < 1e-6, `item 9: Strafe Thrusters Lv 25 -> strafe power x${m25.toFixed(2)} (no cap)`);
    r.startMission(r.options[0]); r.ship.inv = 999; Object.assign(p.inp, { sx: 1, idle: 0, ax: r.ship.x + 1000, ay: r.ship.y }); steps(r, 2); const lat = Math.abs(r.ship.lat); check(lat > 46 * 2, `strafe speed with Lv 25: ${lat.toFixed(0)} px/s (base 46)`);
  }
  { // item 8: buy every new port; Port 3 double barrel fires twice as many rounds
    const shots = dbl => { const r = new Room('V9D' + dbl, false), g = mkC('G'); r.addClient(g, GUNR); r.mk = 3; r.resetShip(); g.prof.cr = 1e6;
      const err = r.buyPort(g.prof, GUNR, 2, 'flak'); if (dbl) r.upPort(g.prof, GUNR, 2, 'dbl'); r.startMission(r.options[0]); r.ship.inv = 999; r.ship.hull = r.ship.hm = 999;
      let n = 0; const af = r.addFlak.bind(r); r.addFlak = (...a) => { n++; return af(...a); }; Object.assign(g.inp, { f: 1, idle: 0, ax: r.ship.x + 400, ay: r.ship.y + 300 }); steps(r, 6); return { n, err, u: r.ports[GUNR][2].u }; };
    const a = shots(0), b = shots(1); check(!a.err && b.u.dbl === 1 && b.n >= 1.8 * a.n && a.n > 3, `item 8: Port 3 Flak Double Barrel: ${b.n} shells vs ${a.n} without`);
    const r = new Room('V9X', false), g = mkC('G2'); r.addClient(g, GUNL); r.mk = 3; r.resetShip(); g.prof.cr = 1e6;
    check(!r.buyPort(g.prof, GUNL, 0, 'rockets') && !r.buyPort(g.prof, GUNL, 1, 'rockets') && !r.buyPort(g.prof, GUNL, 2, 'rockets'), 'gunner can pick Rocket Turret in all three slots');
    check(r.upPort(g.prof, GUNL, 0, 'dbl') && !r.upPort(g.prof, GUNL, 2, 'dbl') && r.upPort(g.prof, GUNL, 2, 'dbl'), 'Double Barrel: refused on Port 1, accepted once on Port 3 (max 1)');
    let all = true; const bad = [];
    for (const [t, role] of [['pilot', PILOT], ['engineer', ENG], ['shield', SHIELD], ['repair', REPAIR]]) D.PORT_SLOTS[t].forEach((sl, k) => { const id = sl[2], rr = new Room('V9' + t + k, false), c = mkC('P'); rr.addClient(c, role); rr.mk = 3; rr.resetShip(); c.prof.cr = 1e6; const e = rr.buyPort(c.prof, role, k, id) || rr.upPort(c.prof, role, k, (D.PORT_UPS[t + '.' + id] || [])[0].o); if (e) { all = false; bad.push(id + ':' + e); } rr.startMission(rr.options[0]); rr.ship.inv = 999; try { steps(rr, 3); } catch (x) { all = false; bad.push(id + '!' + x.message); } });
    check(all, 'every new third-choice port can be bought, upgraded and simulated' + (bad.length ? ' ' + bad.join(', ') : ''));
    // EMP stuns, Shield Pulse wipes shots, Bulkheads add HP
    const re = new Room('V9E', false), ce = mkC('E'); re.addClient(ce, ENG); re.mk = 3; re.resetShip(); ce.prof.cr = 1e6; re.buyPort(ce.prof, ENG, 1, 'emp'); re.startMission(re.options[0]); re.ship.inv = 999;
    const en = re.addEnemy(1, re.ship.x + 150, re.ship.y, 3, 'dom', true); en.cd = 1e9; en.hp = en.mhp = 1e7; let stunned = 0; for (let i = 0; i < 150; i++) { en.x = re.ship.x + 150; en.y = re.ship.y; re.step(); if (en.stun > 0) stunned = 1; } check(stunned, `EMP Projector stunned a nearby enemy (stun ${(en.stun || 0).toFixed(2)})`);
    const rp = new Room('V9B2', false), cp = mkC('R'); rp.addClient(cp, REPAIR); const h0 = rp.secMax(0); rp.mk = 3; rp.resetShip(); cp.prof.cr = 1e6; rp.buyPort(cp.prof, REPAIR, 2, 'bulk'); check(rp.secMax(0) > h0, `Reinforced Bulkheads: station HP ${h0} -> ${rp.secMax(0)}`);
  }
  // ---------- live ----------
  const h = await (await fetch(BASE + '/health')).json(); check(h.v === 9, '/health shows v 9');
  const code = 'V9' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const a = await client(code, 'Ada', 0); await sleep(800);
  check(a.me.cr === 0 && a.last.ph === 'lobby', `live: new ship ${code} opens in the lobby, Ada has ${a.me.cr} credits`);
  let rooms = await (await fetch(BASE + '/rooms')).json(); const me = rooms.find(r => r.code === code);
  check(me && me.humans === 1 && me.lv === 1 && me.names.includes('Ada') && me.cap === 6, 'item 6: /rooms lists the ship with players, names and level: ' + JSON.stringify(me));
  const b = await client(code, 'Bea', 3); await sleep(600);
  a.send({ t: 'start' }); await until(() => a.last.ph === 'intro', 6000); a.send({ t: 'ready' }); b.send({ t: 'ready' }); await until(() => a.last.ph === 'map', 6000);
  check(a.last.ph === 'map' && Array.isArray(a.last.wait) && a.last.wait.length === 2, 'live: star map lists who we are waiting for: ' + JSON.stringify(a.last.wait));
  a.send({ t: 'restart' }); await until(() => a.last.rv, 2000); check(a.last.rv && a.last.rv.need === 2 && a.last.rv.y.length === 1, 'live: restart vote in the snapshot ' + JSON.stringify(a.last.rv));
  b.send({ t: 'rvote', v: 1 }); await until(() => a.last.ph === 'lobby', 3000); check(a.last.ph === 'lobby' && !a.last.rv && a.evs.some(e => e[0] === 'rvr' && e[1] === 1), 'live: majority yes -> back to the lobby');
  a.ws.close(); b.ws.close(); await sleep(1500);
  rooms = await (await fetch(BASE + '/rooms')).json(); check(rooms.some(r => r.code === code && r.humans === 0), 'empty ship kept during the grace period (reconnects)');
  console.log('   waiting for the 45 s grace period...'); await sleep(46000);
  rooms = await (await fetch(BASE + '/rooms')).json(); check(!rooms.some(r => r.code === code), 'item 7: only bots left -> after the grace period the ship is removed');
  const a2 = await client(code, 'Ada', 0); await sleep(600); check(a2.last.ph === 'lobby' && a2.last.md === 0 && a2.me.cr === 0, 'rejoining the code starts a brand-new run from the beginning');
  a2.ws.close();
  console.log(ok ? 'V9 TESTS PASSED' : 'V9 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
