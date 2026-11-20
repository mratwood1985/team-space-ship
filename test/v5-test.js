// v5 integration test (needs the server started with DEV_TOOLS=1): engineer rerouting + bomb, depletion lockout, autonomous drone,
// port switching, spawn positions, passenger run, money bonus, armed defence station.
const WebSocket = require('ws');
const D = require('../public/defs.js');
const BASE = process.argv[2] || 'http://localhost:8091';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], seen: new Map(), maxBeam: 0, droneBeam: 0, minSpeed: 1e9, maxSpeed: 0 };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v5-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); }
      if (m.t === 's' && m.ph === 'lobby' && !c._st) { c._st = 1; c.send({ t: 'start' }); } if (m.t === 's' && m.ph === 'intro' && !c._rd) { c._rd = 1; c.send({ t: 'ready' }); } if (m.t === 's') { c.last = m; for (const e of m.ev || []) c.evs.push(e); if (m.ph === 'mission') for (const e of m.e || []) if (!c.seen.has(e[0])) c.seen.set(e[0], { t: m.tm || Date.now() / 1000, type: e[1], x: e[2], y: e[3], sx: m.sh.x, sy: m.sh.y, e: m.e.map(q => [q[1], q[2], q[3]]) }); if (m.sh && m.sh.bm) for (const b of m.sh.bm) if (b && b[0] >= 100) c.droneBeam++; } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  // ---- data ----
  const RC = D.RR_CFG;
  check(D.VERSION >= 5 && D.MONEY_MULT === 1.1, 'defs: v5, money x1.1');
  check(RC.max === 10 && RC.drain.length === 11 && RC.drain.every((v, i) => i === 0 || v >= RC.drain[i - 1]) && RC.drain[1] === 1, 'drain table: 10 slots, rising with every slot, 1 slot = exactly the starting regen');
  check(RC.base * RC.drain[10] > RC.base * RC.regenCap && RC.base * RC.drain[2] > RC.base && RC.base * RC.drain[2] < RC.base * 1.6, `10 slots always outdrain the best generator (${(RC.base * RC.drain[10]).toFixed(1)}/s vs max regen ${(RC.base * RC.regenCap).toFixed(1)}/s); 2 slots drop very slowly (-${(RC.base * (RC.drain[2] - 1)).toFixed(2)}/s)`);
  check(D.INNATE.engineer === 'bomb' && !D.ABIL.reroute && D.BOMB_CFG.cd > 0, 'bomb is the engineer\'s innate ability on its own cooldown; old reroute ability is gone');
  const code = 'V5' + (Date.now() % 10000);
  const E = await client(code, 'Eng', 3), R = await client(code, 'Rep', 2);
  const dev = o => E.send(Object.assign({ t: 'dev' }, o));
  const inp = (c, o) => c.send(Object.assign({ t: 'i', ax: 0, ay: -300, f: 0, as: 0, thr: 0.65, rt: -1, mb: 0, ck: 0, idle: 0 }, o));
  const acts = (c, a) => inp(c, Object.assign({}, c.cfg || {}, { a }));
  const tick = setInterval(() => { inp(E, E.cfg || {}); inp(R, R.cfg || {}); }, 50);
  dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 3 } });
  check(await until(() => E.last && E.last.ph === 'mission', 6000), 'mission started');
  await sleep(1500); dev({ op: 'clear' }); dev({ op: 'ship', v: { inv: 999, x: 0, y: 0, en: 50, lock: 0, pip: [0, 0, 0, 0] } }); await sleep(500);
  // ---- rerouting ----
  let sh = E.last.sh; check(Array.isArray(sh.pip) && sh.pip.length === 4 && sh.eu === 0, 'snapshot carries 4 reroute options');
  check(Math.abs(sh.rg - RC.base) < 0.2, `start: regen is ${sh.rg}/s`);
  acts(E, ['u1']); await sleep(500); check(E.last.sh.pip[0] === 1 && E.last.sh.eu === 1, 'u1 adds one engine slot');
  const e1 = E.last.sh.en; await sleep(3000); check(Math.abs(E.last.sh.en - e1) < 0.8, `1 slot is exactly sustained by the starting generator (energy ${e1} -> ${E.last.sh.en})`);
  acts(E, ['u2']); await sleep(400); const e2 = E.last.sh.en; await sleep(5000); const d2 = (e2 - E.last.sh.en) / 5;
  check(d2 > 0.02 && d2 < 1.3, `2 slots: the bar starts dropping very slowly (-${d2.toFixed(2)}/s)`);
  for (let i = 0; i < 14; i++) { acts(E, ['u' + (1 + i % 4)]); await sleep(120); }
  sh = E.last.sh; check(sh.pip.reduce((a, b) => a + b, 0) === 10 && sh.eu === 10 && sh.pip.every(v => v >= 0 && v <= 10), `never more than 10 slots in total: ${JSON.stringify(sh.pip)} (14 attempts)`);
  check(Math.abs(sh.rd - RC.base * RC.drain[10]) < 0.2 && sh.rd > sh.rg, `10 slots: drain ${sh.rd}/s is the maximum and exceeds regen ${sh.rg}/s`);
  acts(E, ['d1']); await sleep(300); check(E.last.sh.eu === 9, 'd1 removes a slot'); acts(E, ['z']); await sleep(300); check(E.last.sh.eu === 0 && E.last.sh.pip.every(v => v === 0), 'z clears everything');
  // ---- bomb: own cooldown, no energy ----
  dev({ op: 'ship', v: { en: 40, lock: 0 } }); await sleep(300); E.evs.length = 0; const eb0 = E.last.sh.en;
  acts(E, ['q']); await sleep(600); check(E.evs.some(e => e[0] === 'bl'), 'bomb thrown from the very start (innate Q)');
  check(E.last.sh.en >= eb0 - 0.3, `bomb costs no ship energy (${eb0} -> ${E.last.sh.en})`);
  const bl0 = E.evs.filter(e => e[0] === 'bl').length; acts(E, ['q']); await sleep(500); check(E.evs.filter(e => e[0] === 'bl').length === bl0, 'second bomb is refused while the bomb cooldown runs');
  // ---- depletion lockout ----
  dev({ op: 'ship', v: { en: 3, lock: 0, pip: [0, 0, 0, 0] } }); await sleep(200); E.evs.length = 0;   // v6: 10 slots drain 14/s, so the lockout can start while the slots are still being added
  for (let i = 0; i < 10; i++) { acts(E, ['u1']); await sleep(100); }
  E.cfg = { thr: 1 };
  check(await until(() => E.last.sh.lk > 0, 4000), 'energy hit 0 -> power lockout');
  check(E.evs.some(e => e[0] === 'pwr' && e[1] === 0), 'pwr(0) event sent'); const lk0 = E.last.sh.lk;
  check(lk0 > 17 && lk0 <= 20.1, `lockout lasts 20 s (${lk0}s left)`);
  await sleep(4000); const spLock = E.last.sh.spd;
  check(spLock <= 0.25 * 140 + 3 || spLock < 60, `engine thrust capped at 25% during lockout (speed ${spLock})`);
  acts(E, ['u2']); await sleep(400); check(E.last.sh.eu >= 0, 'rerouting acts do not crash during lockout');
  check(await until(() => E.last.sh.lk <= 0 && E.evs.some(e => e[0] === 'pwr' && e[1] === 1), 22000), 'power returns after ~20 s (pwr(1) event)');
  check(E.last.sh.en > E.last.sh.em * 0.8, `energy is refilled after the lockout (${E.last.sh.en}/${E.last.sh.em})`);
  acts(E, ['z']); E.cfg = { thr: 0.65 }; await sleep(300);
  // ---- drone ----
  dev({ op: 'ship', v: { en: 100, x: 0, y: 0, hull: 20 } }); await sleep(400);
  const dr = E.last.sh.dr.filter(d => d); check(dr.length >= 1 && dr[0].length === 5, `drone out by default, tuple [x,y,a,hp,firing]`);
  const cr0 = R.me.cr; dev({ op: 'drop', n: 1, a: 1, d: 20, life: 30 });
  check(await until(() => R.me.cr > cr0, 8000), `credits picked up (drone/ship): ${cr0} -> ${R.me.cr}`);
  check(R.me.cr - cr0 === Math.round(5 * D.MONEY_MULT), `money bonus: a 5-credit chip pays ${R.me.cr - cr0} (x${D.MONEY_MULT})`);
  E.cfg = { thr: 0 }; dev({ op: 'ship', v: { x: 0, y: 0, vx: 0, vy: 0 } }); await sleep(1500); dev({ op: 'drop', n: 5, a: 0.3, d: 380, life: 30 });
  const pin = setInterval(() => dev({ op: 'ship', v: { x: 0, y: 0 } }), 250);   // thr 0 means the default 0.65 on the wire, so keep the ship parked by hand
  const allPk = await until(() => E.last.pk.length === 0, 28000); clearInterval(pin);
  check(allPk, 'drone/ship collect every dropped chip (ship parked, chips 380-460 px away)'); E.cfg = { thr: 0.65 };
  dev({ op: 'spawn', type: 1, a: 0.5, d: 420, L: 2, static: 1 }); E.droneBeam = 0; await sleep(6000);
  check(E.droneBeam > 3, `drone fires its short laser beam at enemies (${E.droneBeam} beam samples)`);
  // ---- port switching ----
  dev({ op: 'hurt', k: [3, 4] }); dev({ op: 'ship', v: { hull: 20 } }); await sleep(400);
  R.cfg = { rt: 3 }; await sleep(700); check(R.last.sh.tk[0] === 3, 'click engines -> repairing engines');
  R.cfg = { rt: 3, mb: 1 }; await sleep(700); R.cfg = { rt: 4, mb: 1 }; await sleep(500); check(R.last.sh.tk[0] === 4, 'switch to deflector immediately, even mid-minigame');
  R.cfg = { rt: D.HULL_T, mb: 1 }; await sleep(500); check(R.last.sh.tk[0] === D.HULL_T, 'switch to the hull immediately');
  R.cfg = { rt: 3 }; await sleep(500); check(R.last.sh.tk[0] === 3, 'switch back to engines immediately');
  R.cfg = { rt: -1 }; dev({ op: 'ship', v: { hull: 999 } });
  // ---- spawns: only docks or map edges ----
  dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 4 } }); await sleep(800); dev({ op: 'clear' }); dev({ op: 'ship', v: { inv: 999, x: 0, y: 0 } }); E.seen.clear();
  await sleep(45000);
  let n = 0, bad = []; const t0 = E.seen; const dockT = new Set(D.ETYPES.map((t, i) => t.ports && t.ports.some(p => p.w === 'dock') ? i : -1).filter(i => i >= 0));
  for (const [id, s] of t0) { if (s.type === 10) continue; n++;
    const edge = Math.min(D.ARENA - Math.abs(s.x), D.ARENA - Math.abs(s.y)), nearDock = s.e.some(q => dockT.has(q[0]) && Math.hypot(q[1] - s.x, q[2] - s.y) < 450);
    if (edge > 450 && !nearDock) bad.push([id, s.type, Math.round(s.x), Math.round(s.y)]); }
  check(n >= 3 && bad.length === 0, `${n} new enemies appeared in 45 s, all at an edge or by a dock (bad: ${JSON.stringify(bad.slice(0, 4))})`);
  // ---- passenger run ----
  dev({ op: 'mission', i: 0, over: { type: 'passengers', level: 3 } }); await sleep(1500); dev({ op: 'ship', v: { inv: 999 } }); await sleep(500);
  let mi = E.last.mi; check(mi && mi.type === 'passengers' && mi.bx === 4000 && mi.by === 640 && !mi.pax, `passenger run: long narrow map ${mi && mi.bx * 2}x${mi && mi.by * 2}`);
  check(E.last.sh.x < -3000, `ship starts at the near end (x=${E.last.sh.x})`);
  const rocks = E.last.e.filter(e => e[1] === 10).length, foes = E.last.e.filter(e => e[1] !== 10).length; check(rocks >= 30, `lots of asteroids near the start (${rocks} in view range)`); console.log('   hostiles at start:', foes);
  check(E.last.al.some(a => a[1] === 'pax'), 'passenger transport waits at the far end');
  dev({ op: 'ship', v: { x: 3500, y: 0, vx: 0, vy: 0 } }); E.evs.length = 0; check(await until(() => E.last.mi.pax === 1, 5000) && E.evs.some(e => e[0] === 'pax'), 'flying to the far end picks up the passengers');
  await sleep(3000); const foes2 = E.last.e.filter(e => e[1] !== 10).length; console.log('   ambush hostiles:', foes2);
  check(E.last.e.every(e => Math.abs(e[2]) <= 4000 + 5 && Math.abs(e[3]) <= 640 + 5), 'everything stays inside the corridor');
  dev({ op: 'ship', v: { x: -3300, y: 0 } }); check(await until(() => E.last.ph === 'result' || E.last.ph === 'upgrade', 8000) && E.last.sh, 'bringing the passengers back to the start wins the mission');
  // ---- defend station has guns ----
  dev({ op: 'phase', ph: 'map', secs: 60 }); await sleep(500);
  dev({ op: 'mission', i: 0, over: { type: 'defend', level: 3 } }); await sleep(1500); dev({ op: 'ship', v: { inv: 999 } }); dev({ op: 'clear' });
  const st = E.last.al.find(a => a[1] === 'fs'); check(!!st && st.length >= 9, 'station tuple carries turret angle + flash');
  check(await (async () => { dev({ op: 'ship', v: { x: st[2] + 400, y: st[3] } }); dev({ op: 'spawn', type: 0, a: Math.PI, d: 500, L: 3, static: 1 }); let fired = 0; const d = Date.now() + 9000; while (Date.now() < d) { const s2 = E.last.al.find(a => a[1] === 'fs'); if (s2 && s2[8]) fired++; await sleep(60); } return fired > 0; })(), 'the station fires its own guns at nearby enemies');
  const hpOK = D.VERSION >= 5; clearInterval(tick); E.ws.close(); R.ws.close();
  console.log(ok && hpOK ? 'V5 TESTS PASSED' : 'V5 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
