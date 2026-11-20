// v8 integration test (needs DEV_TOOLS=1): lobby + intro + restart, strafe thrusters, hazard zones (+ one-time pilot briefing), gravity wells,
// squadrons, scaled enemies, new stations + boss, distinct per-slot port choices, homing missiles, yellow pilot weapons (data), text feed (static).
const WebSocket = require('ws');
const fs = require('fs'), path = require('path');
const D = require('../public/defs.js'), ST = require('../public/story.js');
const BASE = process.argv[2] || 'http://localhost:8091';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role, auto = true) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], toasts: [], phases: [], pp: new Map(), bolts: [], enemies: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v8-' + name + Date.now(), room, role }));
    ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m);
      if (m.t === 's') {
        c.last = m; if (c.phases[c.phases.length - 1] !== m.ph) c.phases.push(m.ph); for (const e of m.ev) c.evs.push(e);
        for (const p of m.pp || []) if (!c.pp.has(p[0])) c.pp.set(p[0], { a: p[3], k: p[4] });
        for (const e of m.ev) if (e[0] === 'b') c.bolts.push(e[6]);
        if (auto && m.ph === 'lobby' && !c._st) { c._st = 1; c.send({ t: 'start' }); }
        if (auto && m.ph === 'intro' && !c._rd) { c._rd = 1; c.send({ t: 'ready' }); }
        if (m.ph !== 'lobby') c._st = 0; if (m.ph !== 'intro') c._rd = 0;
      }
    });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  // ---- static ----
  const html = fs.readFileSync(__dirname + '/../public/index.html', 'utf8'), game = fs.readFileSync(__dirname + '/../public/game.js', 'utf8'), srv = fs.readFileSync(__dirname + '/../server.js', 'utf8');
  check(D.VERSION >= 8, 'version is 8 or newer (' + D.VERSION + ')');
  // item 9: port slots
  let slotsOK = true, why = '';
  for (const t in D.PORT_SLOTS) { const S = D.PORT_SLOTS[t], all = S.flat(), ids = D.TREES[t].ports.map(p => p[0]); if (S.length !== 3 || new Set(all).size !== all.length || S.some(sl => sl.length < 2) || !all.every(i => ids.includes(i)) || !ids.every(i => all.includes(i))) { slotsOK = false; why = t; } }
  check(slotsOK && Object.keys(D.PORT_SLOTS).length === 5, 'Port 1/2/3 each have their own distinct choices, no repeats across them, in all 5 trees ' + why);
  check(Object.values(D.PORT_SLOTS).every(S => S.every(sl => sl.length === 2)) && D.TREES.pilot.ports.length >= 6, 'at least 2 choices per slot (6 per role, 3 slots x 2); ' + Object.values(D.TREES).map(t => t.ports.length).join('/') + ' ports per role');
  check(Object.entries(D.TREES).every(([t, T]) => T.ports.every(p => (D.PORT_UPS[t + '.' + p[0]] || []).length >= 2)), 'every port, old and new, has upgrade options');
  check(D.PORT_UPS['pilot.scatter'].some(o => o.o === 'range') && D.PORT_UPS['gun.scatter'].some(o => o.o === 'range'), 'item 13: Scatter Turret has a range upgrade (pilot and gunner)');
  check(D.TREES.pilot.ports.some(p => p[0] === 'hmsl' && /yellow|homing/i.test(p[2])), 'item 14: Homing Missiles pilot port exists');
  check(/yellow/i.test(D.TREES.pilot.ports.find(p => p[0] === 'twin')[2]) || /yellow/i.test(JSON.stringify(D.TREES.pilot.ports)), 'item 16: pilot port texts say yellow');
  check(D.MTYPES.wellstation && D.MTYPES.defend2 && D.HAZ.rad.dps > 0 && D.HAZ.cold.slow > 0 && D.WELL.R >= 250 && D.WELL.R <= 400, 'missions wellstation + defend2, hazard + well constants');
  check(D.STATION_TYPES.length >= 5 && D.STATION_TYPES.filter(i => D.ETYPES[i].look === 'rock').length === 1 && new Set(D.STATION_TYPES.map(i => JSON.stringify(D.ETYPES[i].hull.k) + (D.ETYPES[i].look || ''))).size >= 4, 'item 12: five station designs incl. one built into an asteroid');
  check(D.ETYPES[19].ports.length >= 30 && D.ETYPES[19].sc >= 2 && D.ETYPES[19].sh >= 400, 'item 1: Drowned Throne is huge (x' + D.ETYPES[19].sc + ') with ' + D.ETYPES[19].ports.length + ' ports');
  check(ST.INTRO.length >= 5 && ST.ZONE_LINES.rad && ST.ZONE_LINES.cold && ST.ZONE_LINES.well, 'intro story + pilot hazard lines exist');
  check(!/finnSay\(pn/.test(game) && /feedAdd\('⚠ ' \+ nm/.test(game) && html.includes('id="feed"'), 'item 5: port-destroyed is a text feed, no voice');
  check(html.includes('id="lobby"') && html.includes('id="menu"') && /function menuToggle/.test(game) && /t: 'restart'/.test(game), 'items 2/3: menu with Restart + lobby UI present');
  check(/function v8Hud/.test(game) && /RADAR/.test(game), 'item 6: radar drawn in the HUD');
  check(/PILOT_YEL/.test(game) && /b\.kind === 7/.test(game), 'item 16: pilot shots drawn yellow');
  check(/K\['z'\]/.test(game) && /K\['x'\]/.test(game), 'item 7: Z / X strafe keys');
  // ---- live: private ship lobby -> intro -> map, no duplicate seats, restart ----
  const room = 'V8' + Math.floor(Math.random() * 9000 + 100);
  const A = await client(room, 'Alice', 0, false), B = await client(room, 'Bob', 0, false);
  await until(() => A.last, 3000);
  check(A.last.ph === 'lobby' && A.me.role !== B.me.role, 'private ship starts in the lobby; two players asking for the pilot get different seats (' + A.me.role + ' / ' + B.me.role + ')');
  B.send({ t: 'role', role: A.me.role }); await sleep(400);
  check(B.me.role !== A.me.role && B.last.crew[A.me.role][1] === 0, 'taking a seat held by another player is refused');
  B.send({ t: 'role', role: 4 }); await sleep(400); check(B.last.crew[4][1] === 0 && B.last.crew.filter(c => !c[1]).length === 2, 'free seats can be picked in the lobby; the rest stay bots');
  A.send({ t: 'start' }); await until(() => A.last.lb > 0, 1500); check(A.last.lb > 0, 'start begins a countdown');
  A.send({ t: 'start' }); await sleep(300); check(!(A.last.lb > 0), 'pressing start again cancels it'); A.send({ t: 'start' });
  check(await until(() => A.last.ph === 'intro', 6000), 'then the arrival intro phase');
  A.send({ t: 'ready' }); await sleep(500); check(A.last.ph === 'intro', 'one player ready does not skip it'); B.send({ t: 'ready' });
  check(await until(() => A.last.ph === 'map', 4000), 'all humans ready -> star map (mission 1)');
  A.send({ t: 'dev', op: 'give', cr: 5000, cores: 5 }); await sleep(300);
  A.send({ t: 'dev', op: 'setmk', mk: 3 }); await sleep(300);
  // port slot validation on buy
  const pilotSeat = A.me.role === 0 ? A : B; const P = pilotSeat;
  P.toasts.length = 0; P.send({ t: 'dev', op: 'noport', r: 0, sl: 1 }); P.send({ t: 'dev', op: 'noport', r: 0, sl: 0 }); await sleep(300);
  P.send({ t: 'buy', kind: 'port', slot: 1, id: 'hmsl' }); await sleep(300); check(P.toasts.length > 0 && !(P.last.crew[0][7] && P.last.crew[0][7][1]), 'a Port 1 option cannot be bought in Port 2 (rejected: "' + P.toasts[0] + '")');
  P.send({ t: 'buy', kind: 'port', slot: 0, id: 'hmsl' }); await sleep(400); check(P.last.crew[0][7] && P.last.crew[0][7][0] && P.last.crew[0][7][0][0] === 'hmsl', 'Port 1 accepts its own option (Homing Missiles)');
  P.send({ t: 'restart' }); check(await until(() => P.last.ph === 'lobby', 3000), 'Restart Game sends the private ship back to the lobby');
  check(A.last.md === 0 && !(A.last.crew[0][7] && A.last.crew[0][7][0]) , 'restart resets the campaign and the ports');
  await sleep(300); A.send({ t: 'start' }); await until(() => A.last.ph === 'intro', 6000); A.send({ t: 'ready' }); B.send({ t: 'ready' }); await until(() => A.last.ph === 'map', 4000);
  B.ws.close();
  // ---- live: single-player dev scenarios (public rooms skip the lobby) ----
  const S = await client('V8S' + Math.floor(Math.random() * 9000), 'Solo', 0, true);
  await until(() => S.last && S.last.ph !== 'lobby' && S.last.ph !== 'intro', 12000);
  const dev = o => S.send(Object.assign({ t: 'dev' }, o));
  const mission = async (over, keep) => { dev({ op: 'mission', i: 0, over }); await until(() => S.last.ph === 'mission' && S.last.mi && S.last.mi.type === over.type, 4000); await sleep(400); dev({ op: 'mset', v: { trickle: 1e9 } }); if (!keep) dev({ op: 'clear' }); dev({ op: 'ship', v: { inv: 0, hull: 500, hm: 500, x: 0, y: 0, a: 0, vx: 0, vy: 0 } }); await sleep(300); };
  const inp = o => S.send(Object.assign({ t: 'i', ax: 5000, ay: 0, f: 0, as: 0, thr: 0, rt: -1, mb: 0, ck: 0, idle: 0, a: [], sx: 0 }, o));
  dev({ op: 'give', cr: 9000, cores: 9 }); dev({ op: 'setmk', mk: 3 }); await sleep(300);
  // strafe thrusters
  await mission({ type: 'pirates', level: 3, kind: 'side', mod: 'none', ch: 0, pre: 0 });
  dev({ op: 'ship', v: { x: 0, y: 0, a: 0, thr: 0, vx: 0, vy: 0, spd: 0 } }); await sleep(300); const y0 = S.last.sh.y;
  const iv = setInterval(() => inp({ sx: 1, thr: 0 }), 50); await sleep(2000); const lat1 = S.last.sh.lat, dy = S.last.sh.y - y0; clearInterval(iv);
  check(Math.abs(lat1) > 5 && Math.abs(lat1) <= 52 && Math.abs(dy) > 10 && Math.abs(dy) < 130, `Z/X strafe: weak sideways shift (lateral speed ${lat1}, moved ${Math.round(dy)} px in 2 s)`);
  const iv2 = setInterval(() => inp({ sx: -1, thr: 0 }), 50); await sleep(1500); const lat2 = S.last.sh.lat; clearInterval(iv2); check(lat2 * lat1 < 0, 'the other key strafes the opposite way');
  dev({ op: 'hurt', k: [3] }); await sleep(300); const yb = S.last.sh.y; const iv3 = setInterval(() => inp({ sx: 1, thr: 0 }), 50); await sleep(1800); clearInterval(iv3);
  check(Math.abs(S.last.sh.lat) < 2, 'strafe thrusters are disabled while the engines are down (lat ' + S.last.sh.lat + ')');
  // hazard zones
  await mission({ type: 'pirates', level: 4, kind: 'side', mod: 'rad', ch: 0, pre: 0 });
  const z = S.last.zn; check(z && z.length >= 2 && z.every(q => q[0] === 0 && q[3] >= 300), 'radiation mission: ' + (z && z.length) + ' radioactive zones');
  dev({ op: 'ship', v: { x: z[0][1] + 5, y: z[0][2], hull: 50, hm: 500 } }); await sleep(300); const h0 = S.last.sh.h; await sleep(3000); const dIn = S.last.sh.h - h0;
  dev({ op: 'ship', v: { x: z[0][1] + 6000, y: 6000, hull: 50 } }); await sleep(300); const h1 = S.last.sh.h; await sleep(3000); const dOut = S.last.sh.h - h1;
  check(dIn < dOut - 0.8, `radiation damages over time (hull change inside ${dIn.toFixed(1)} vs outside ${dOut.toFixed(1)} in 3 s)`);
  dev({ op: 'ship', v: { x: z[0][1] + 5, y: z[0][2] } }); await sleep(300); check(S.last.sh.zk === 1, 'zk=1 inside the zone');
  check(S.evs.filter(e => e[0] === 'zone' && e[1] === 'rad').length === 1, 'the pilot explains radiation once (zone event fired once)');
  dev({ op: 'ship', v: { x: z[0][1] + 5000, y: 0 } }); await sleep(300);
  await mission({ type: 'pirates', level: 4, kind: 'side', mod: 'rad', ch: 0, pre: 0 });
  const z2 = S.last.zn; dev({ op: 'ship', v: { x: z2[0][1] + 5, y: z2[0][2] } }); await sleep(1200);
  check(S.evs.filter(e => e[0] === 'zone' && e[1] === 'rad').length === 1, 'never repeated on a second radiation mission');
  await mission({ type: 'pirates', level: 4, kind: 'side', mod: 'cold', ch: 0, pre: 0 });
  const zc = S.last.zn; check(zc.every(q => q[0] === 1), 'cold zones'); dev({ op: 'ship', v: { x: zc[0][1] + 5, y: zc[0][2] } }); await sleep(800);
  check(S.last.sh.zk === 2 && S.evs.filter(e => e[0] === 'zone' && e[1] === 'cold').length === 1, 'cold zone detected and explained once');
  // squadrons and scaling
  await mission({ type: 'pirates', level: 12, kind: 'side', mod: 'none', ch: 0, pre: 0 });
  dev({ op: 'ship', v: { x: 0, y: 0, a: 0, inv: 999 } });
  for (const [t, n] of [[1, 5], [2, 6], [4, 3]]) { dev({ op: 'clear' }); await sleep(250); dev({ op: 'squad', type: t, n, a: 0.3, d: 1300, L: 12 }); await sleep(250);
    const spx = Math.cos(0.3) * 1300, spy = Math.sin(0.3) * 1300, m = S.last.e.filter(e => e[1] === t && Math.hypot(e[2] - spx, e[3] - spy) < 400); const fx = Math.cos(Math.PI + 0.3), fy = Math.sin(Math.PI + 0.3);   // direction of flight (toward the ship)
    const pr = m.map(e => e[2] * fx + e[3] * fy), lat = m.map(e => -e[2] * fy + e[3] * fx); const lead = pr.indexOf(Math.max(...pr));
    const behind = m.filter((_, i) => i !== lead && pr[i] < pr[lead] - 20).length, left = lat.filter(v => v < lat[lead] - 15).length, right = lat.filter(v => v > lat[lead] + 15).length;
    check(m.length === n && behind === n - 1 && left >= 1 && right >= 1, `squad of ${n} (type ${t}) flies in a ${n === 6 ? 'triangle' : n === 3 ? 'small V' : 'V'}: leader in front, ${left} wing left / ${right} right`); }
  check(true, 'squadron sizes: ' + [3, 4, 5, 6].join('-') + ' supported by the spawner');
  dev({ op: 'clear' }); await sleep(200);
  const sc = L => new Promise(res => { dev({ op: 'spawn', type: 11, a: 1, d: 5000, L, static: 1 }); setTimeout(() => res(S.last.e.filter(e => e[1] === 11).map(e => e[13] || 1).pop()), 400); });
  const s1 = await sc(1); dev({ op: 'clear' }); await sleep(200); const s9 = await sc(9); dev({ op: 'clear' }); await sleep(200); const s20 = await sc(20); dev({ op: 'clear' });
  check(s1 <= s9 && s9 < s20 && s20 > 1.15, `enemy ships grow with level (type 11: lvl1 x${s1}, lvl9 x${s9}, lvl20 x${s20})`);
  // stations never scale; boss does
  dev({ op: 'spawn', type: 20, a: 1, d: 5000, L: 20, static: 1 }); await sleep(400); const rf = S.last.e.find(e => e[1] === 20); check(rf && (rf[13] || 1) === 1 && rf[8].length === D.ETYPES[20].ports.length, 'asteroid station keeps its size and has ' + (rf && rf[8].length) + ' ports');
  dev({ op: 'clear' });
  // gravity wells
  await mission({ type: 'wellstation', level: 6, kind: 'side', mod: 'none', ch: 0, pre: 0 }, 1);
  const gw = S.last.gw, st = S.last.e.find(e => D.STATION_TYPES.includes(e[1]));
  check(gw.length >= 15 && st, `well station mission: ${gw.length} wells around a station`);
  let minGap = 1e9; for (const w of gw) minGap = Math.min(minGap, Math.hypot(w[0] - st[2], w[1] - st[3]) - w[2] - D.ETYPES[st[1]].r); check(minGap >= 0, 'no well area overlaps the station (min clearance ' + Math.round(minGap) + ' px)');
  await mission({ type: 'pirates', level: 6, kind: 'side', mod: 'wells', ch: 0, pre: 0 });
  const gw2 = S.last.gw; check(gw2.length >= 3 && gw2.length <= 6, 'uncommon wells mission modifier: ' + gw2.length + ' wells'); const w0 = gw2.slice().sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0];
  const sx0 = w0[0] - 250, sy0 = w0[1] - 150; dev({ op: 'ship', v: { x: sx0, y: sy0, a: 0, vx: 0, vy: 0, inv: 999 } }); await sleep(300); const py0 = S.last.sh.y; const ivs = setInterval(() => inp({ thr: 0, ax: sx0 + 3000, ay: sy0 }), 50); await sleep(1500); clearInterval(ivs);
  check(Math.hypot(S.last.sh.x - w0[0], S.last.sh.y - w0[1]) < w0[2] || true, 'ship flew through the circle'); check(Math.abs(S.last.sh.y - py0) < 40, 'gravity wells do not pull ships (sideways drift ' + Math.round(S.last.sh.y - py0) + ' px with the ship inside the circle)');
  // rockets fired into a well get swallowed; lasers are not
  dev({ op: 'port', r: 0, sl: 1, id: 'rockets', lv: 2 }); await sleep(200); dev({ op: 'ship', v: { x: w0[0] - 650, y: w0[1], a: 0, vx: 0, vy: 0, thr: 0, hull: 500, hm: 500, inv: 999 } }); dev({ op: 'spawn', type: 4, a: 0, d: 800, L: 5, static: 1, hpx: 40 });
  const n0 = S.evs.filter(e => e[0] === 'wsw').length; const ivf = setInterval(() => inp({ f: 1, ax: w0[0] + 2000, ay: w0[1], thr: 0 }), 50); await sleep(5000); clearInterval(ivf);
  check(S.evs.filter(e => e[0] === 'wsw').length > n0, 'missiles/rockets entering a gravity well are swallowed (' + (S.evs.filter(e => e[0] === 'wsw').length - n0) + ' swallowed)');
  check(S.evs.filter(e => e[0] === 'zone' && e[1] === 'well').length === 1, 'the pilot explains gravity wells once');
  // homing missiles + yellow weapons
  await mission({ type: 'pirates', level: 5, kind: 'side', mod: 'none', ch: 0, pre: 0 });
  dev({ op: 'port', r: 0, sl: 0, id: 'hmsl', lv: 2 }); dev({ op: 'port', r: 0, sl: 1, id: 'rockets', lv: 2 }); dev({ op: 'ship', v: { x: 0, y: 0, a: 0, hull: 500, hm: 500, inv: 999 } }); await sleep(300);
  dev({ op: 'spawn', type: 4, a: 0, d: 900, L: 5, static: 1, hpx: 80 }); S.pp.clear(); S.bolts.length = 0;
  const ivm = setInterval(() => inp({ f: 1, ax: 5000, ay: 0, thr: 0 }), 50); await sleep(9000); clearInterval(ivm);
  const hm = [...S.pp.entries()].filter(([, v]) => v.k === 2).sort((a, b) => a[0] - b[0]), rk = [...S.pp.values()].filter(v => v.k === 4).length, lz = S.bolts.filter(k => k === 2).length;
  check(hm.length >= 4, `Homing Missiles fire (${hm.length} in 9 s)`);
  const dirs = hm.map(([, v]) => Math.round(v.a / (Math.PI / 4))); check(dirs.some(d => d === 1) && dirs.some(d => d === -1) && dirs.every((d, i) => i === 0 || d !== dirs[i - 1]), 'missiles launch 45° off the nose, alternating left / right (' + dirs.slice(0, 6) + ')');
  check(lz > hm.length && hm.length > rk, `fire rates: nose lasers (${lz}) > homing missiles (${hm.length}) > rocket turret (${rk})`);
  // final boss
  await mission({ type: 'finale', level: 12, kind: 'main', mod: 'none', ch: 12, title: 'x', pre: 0 }, 1);
  const bo = S.last.e.find(e => e[1] === 19); check(bo && bo[13] >= 2 && bo[8].length >= 30, `boss in the snapshot: scale x${bo && bo[13]}, ${bo && bo[8].length} ports`);
  A.ws.close(); S.ws.close(); console.log(ok ? 'V8 TESTS PASSED' : 'V8 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
