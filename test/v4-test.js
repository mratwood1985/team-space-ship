// v4 integration test (needs the server started with DEV_TOOLS=1): repair rework, CLICK RAPIDLY / Repair Bay, straight enemy bullets, level-based fire, bigger maps.
const WebSocket = require('ws');
const D = require('../public/defs.js');
const BASE = process.argv[2] || 'http://localhost:8091';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], eb: new Map() };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v4-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); }
      if (m.t === 's') { c.last = m; for (const e of m.ev || []) c.evs.push(e); if (m.sh && m.sh.eb) { } for (const b of m.eb || []) { const a = c.eb.get(b[0]) || []; a.push([m.tm || Date.now() / 1000, b]); c.eb.set(b[0], a); } } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  check(D.VERSION >= 4 && D.ARENA === 4200 && D.EFIRE_WEAK_LV === 5 && D.EFIRE_WEAK < 1, 'defs: v4+, arena 4200, enemy fire reduced on levels 1-5');
  const code = 'V4' + (Date.now() % 10000);
  const R = await client(code, 'Rep', 2), P = await client(code, 'Pil', 0);
  R.send({ t: 'dev', op: 'mission', i: 0, over: { type: 'escort', level: 3 } });
  check(await until(() => R.last && R.last.ph === 'mission', 6000), 'mission started (escort, level 3)');
  const ms = R.evs.find(e => e[0] === 'ms'); check(ms && ms[3] === 3, 'ms event carries the mission level: ' + JSON.stringify(ms));
  R.send({ t: 'dev', op: 'clear' });
  const mi = R.last.mi; if (mi && mi.jx !== undefined) check(Math.hypot(mi.jx, mi.jy) > 2900, 'escort jump point is farther away: ' + Math.round(Math.hypot(mi.jx, mi.jy)));
  const inp = (c, o) => c.send(Object.assign({ t: 'i', ax: 0, ay: -300, f: 0, as: 0, thr: 0.4, rt: -1, mb: 0, ck: 0, idle: 0 }, o));
  const tick = setInterval(() => { inp(R, R.cfg || {}); inp(P, P.cfg || {}); }, 50);
  // --- repair: needs a click, then automatic ---
  R.send({ t: 'dev', op: 'ship', v: { hull: 20 } });
  P.send({ t: 'dev', op: 'hurt', k: [0, 3] }); await sleep(300);
  check(R.last.sh.dn[0] === 1 && R.last.sh.dn[3] === 1, 'cockpit + engines destroyed');
  await sleep(2500);
  check(R.last.sh.sc[0] === 0 && R.last.sh.tk[0] === -1, 'no repair happens until the repair player clicks a port');
  R.cfg = { rt: 0 }; await sleep(4000);
  const p1 = R.last.sh.sc[0]; check(p1 > 0.15 && R.last.sh.tk[0] === 0 && R.last.sh.sc[3] === 0, `after clicking the cockpit it repairs automatically (${Math.round(p1 * 100)}%) and only that port; speed x${R.last.sh.tk[3]}`);
  const m0 = R.last.sh.tk[3];
  R.cfg = { rt: 0, mb: 1 }; await sleep(600); const m1 = R.last.sh.tk[3]; check(m1 > m0 * 1.8, `minigame bonus doubles the speed (x${m0} -> x${m1})`);
  R.cfg = { rt: 0, mb: 0 };
  inp(R, Object.assign({}, R.cfg, { a: ['dr'] })); await sleep(500); const off = R.last.sh.tk;
  check(off[2] === 1 && Math.abs(off[3] / m0 - 1.5) < 0.05, `disabling the drone speeds up repair x1.5 (x${m0} -> x${off[3]})`);
  check(R.last.sh.dr.filter(d => d).length === 0, 'drones are recalled while disabled');
  inp(R, Object.assign({}, R.cfg, { a: ['dr'] })); await sleep(900);
  check(R.last.sh.tk[2] === 0 && R.last.sh.dr.filter(d => d).length >= 1, 'drone is out again while ship sections are still damaged');
  await until(() => R.last.sh.dn[0] === 0, 40000); await sleep(400); check(R.last.sh.dn[0] === 0 && R.last.sh.tk[0] !== 0, 'cockpit repaired, target cleared (must click the next one)');
  check(R.last.sh.dn[3] === 1, 'engines still down: nothing starts without a click');
  // --- repair bay destroyed ---
  P.send({ t: 'dev', op: 'hurt', k: [2] }); await sleep(400);
  check(R.last.sh.dn[2] === 1, 'repair bay destroyed');
  R.cfg = { rt: 3, mb: 1, ck: 10 }; await sleep(3000);
  check(R.last.sh.dn[2] === 1 && R.last.sh.dn[3] === 1 && R.last.sh.sc[3] === 0, 'repair player cannot repair ports (nor the repair bay) while it is destroyed, even clicking');
  check(R.last.sh.dr.filter(d => d).length === 0, 'no drone while the repair bay is destroyed');
  R.cfg = { rt: 3 };
  const t0 = Date.now(); const slow = R.last.sh.sc[2];
  await sleep(4000); const bots = R.last.sh.sc[2] - slow; check(bots > 0 && bots < 0.15, `bots in empty seats slowly help (+${Math.round(bots * 100)}% in 4s)`);
  P.cfg = { ck: 8 }; const t1 = Date.now(); const ok2 = await until(() => R.last.sh.dn[2] === 0, 40000);
  console.log('   repaired in', ((Date.now() - t1) / 1000).toFixed(1), 's with one human clicking ~160/s (+4 bots)');
  check(ok2, 'rapid clicks from another player repair the Repair Bay'); P.cfg = {};
  check(R.evs.some(e => e[0] === 'sd' && e[1] === 2) && R.evs.some(e => e[0] === 'sr' && e[1] === 2), 'destroyed/repaired events reach every player');
  // --- straight enemy bullets ---
  R.send({ t: 'dev', op: 'clear' }); for (let i = 0; i < 4; i++) R.send({ t: 'dev', op: 'spawn', type: 0, a: i * 1.6, d: 500, L: 3 });
  await sleep(7000); let n = 0, bad = 0, worst = 0;
  for (const [id, arr] of P.eb) { if (arr.length < 4 || arr[0][1][7]) continue; const b0 = arr[0][1], b1 = arr[arr.length - 1][1]; const a = b0[3]; n++;
    const dx = b1[1] - b0[1], dy = b1[2] - b0[2], len = Math.hypot(dx, dy) || 1; let perp = 0;
    for (const q of arr) perp = Math.max(perp, Math.abs((q[1][1] - b0[1]) * dy - (q[1][2] - b0[2]) * dx) / len); worst = Math.max(worst, perp); if (perp > 2 || arr.some(q => q[1][3] !== a)) bad++; }
  check(n >= 3 && bad === 0, `enemy bullets fly in a straight line (${n} bullets tracked, worst sideways drift ${worst.toFixed(1)}px)`);
  clearInterval(tick); R.ws.close(); P.ws.close();
  // level-6 full strength
  const L = await client('V6' + (Date.now() % 10000), 'Lv', 0); L.send({ t: 'dev', op: 'mission', i: 0, over: { level: 6 } }); await until(() => L.evs.some(e => e[0] === 'ms'), 5000);
  const ms6 = L.evs.find(e => e[0] === 'ms'); check(ms6 && ms6[3] === 6, 'level-6 mission announces level 6 (client shows the full-strength notice)'); L.ws.close();
  console.log(ok ? 'V4 TESTS PASSED' : 'V4 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
