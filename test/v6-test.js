// v6 integration test (needs the server started with DEV_TOOLS=1): drone move-to + separation, steeper drain, stronger shield rerouting,
// per-port upgrade options, bolt colours, sniper + laser ports, kamikaze bomb ship, level 10+ missions.
const WebSocket = require('ws');
const fs = require('fs');
const D = require('../public/defs.js');
const BASE = process.argv[2] || 'http://localhost:8091';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, last: null, evs: [], toasts: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'v6-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m); if (m.t === 's') { c.last = m; for (const e of m.ev || []) c.evs.push(e); } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
const until = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(100); } return false; };
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  // ---- static data ----
  const RC = D.RR_CFG;
  check(D.VERSION >= 6, 'defs: v6');
  check(RC.base * RC.drain[10] === 14 && RC.drain.every((v, i) => i < 2 || v / RC.drain[i - 1] > 1.1) && RC.drain[2] < 1.2, `steeper drain curve: 2 slots x${RC.drain[2]}, 6 slots x${RC.drain[6]}, 10 slots ${RC.base * RC.drain[10]}/s (was 8/s)`);
  check(RC.shHp >= 0.1 && RC.shDr > 0, `shield rerouting adds max shield HP (+${RC.shHp * 100}%/slot) and damage reduction (-${RC.shDr * 100}%/slot)`);
  const gp = D.TREES.gun.ports.map(p => p[0]);
  check(gp.length === 5 && gp.includes('sniper') && gp.includes('laser'), `gunner has 5 extra ports: ${gp.join(', ')}`);
  check(Object.values(D.PORT_UPS).every(l => l.length >= 2 && l.some(o => o.o === 'hp') && !l.some(o => /effect/i.test(o.n))), 'every port has its own upgrade options + Section HP, no generic "Port effect"');
  check(Object.keys(D.PORT_UPS).length === 17 && D.PORT_UPS['pilot.twin'].some(o => o.o === 'pierce') && D.PORT_UPS['engineer.aux'].some(o => o.o === 'eff'), 'port-specific options exist (17 ports)');
  check(D.ETYPES[18].id === 'kamikaze' && D.ETYPES[18].minL === 6, 'kamikaze bomb ship: appears from level 6');
  check(['survival', 'bombrun', 'siege'].every(t => D.MTYPES[t] && D.MTYPES[t].adv), 'three new mission types for level 10+');
  const gsrc = fs.readFileSync(__dirname + '/../public/game.js', 'utf8');
  check(/\['A', 'S', 'D'\]/.test(gsrc) && /key === 'a'|k === 'a'|'a':/.test(gsrc), 'client: abilities are A / S / D');
  const code = 'V6' + (Date.now() % 10000);
  const E = await client(code, 'Eng', 3), R = await client(code, 'Rep', 2);
  const dev = o => E.send(Object.assign({ t: 'dev' }, o));
  const inp = (c, o) => c.send(Object.assign({ t: 'i', ax: 0, ay: -300, f: 0, as: 0, thr: 0.4, rt: -1, mb: 0, ck: 0, idle: 0 }, o));
  const tick = setInterval(() => { inp(E, E.cfg || {}); inp(R, R.cfg || {}); }, 50);
  const startMission = async (type, level) => { dev({ op: 'mission', i: 0, over: { type, level } }); await sleep(600); return until(() => E.last && E.last.ph === 'mission' && E.last.mi && E.last.mi.type === type, 6000); };
  const mi = () => E.last.mi, sh = () => E.last.sh;
  // ---- drones: click to send, never overlap ----
  check(await startMission('pirates', 3), 'mission started');
  await sleep(1200); dev({ op: 'clear' });
  dev({ op: 'port', r: 2, sl: 0, id: 'drone2', lv: 1 }); await sleep(600);
  dev({ op: 'ship', v: { inv: 999, x: 0, y: 0, swarm: 90, shp: 3 } }); dev({ op: 'clear' });
  check(await until(() => sh().dr.filter(d => d).length >= 4, 8000), `several drones out (${sh().dr.filter(d => d).length})`);
  const minDist = () => { const d = sh().dr.filter(x => x); let m = 1e9; for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) m = Math.min(m, Math.hypot(d[i][0] - d[j][0], d[i][1] - d[j][1])); return m; };
  let md = 1e9; for (let i = 0; i < 40; i++) { md = Math.min(md, minDist()); await sleep(100); dev({ op: 'clear' }); }
  check(md >= 28, `auto mode: drones never overlap (closest pair ${md.toFixed(1)} px)`);
  const sx = sh().x, sy = sh().y, tx = sx + 700, ty = sy + 250;
  inp(R, { dm: [tx, ty] });
  check(await until(() => sh().dg && Math.abs(sh().dg[0] - tx) < 3 && Math.abs(sh().dg[1] - ty) < 3, 2000), `click sends the drones: marker at (${sh().dg && sh().dg[0]},${sh().dg && sh().dg[1]})`);
  await sleep(4500); md = 1e9; let near = 0; for (let i = 0; i < 20; i++) { md = Math.min(md, minDist()); await sleep(100); }
  const dd = sh().dr.filter(x => x); near = dd.filter(d => Math.hypot(d[0] - tx, d[1] - ty) < 160).length;
  console.log('DBG', tx, ty, JSON.stringify(sh().dg), JSON.stringify(dd.map(d => [d[0] | 0, d[1] | 0])), sh().x | 0, sh().y | 0);
  check(near >= dd.length - 1 && dd.length >= 4, `drones fly to the clicked spot and hold it (${near}/${dd.length} within 160 px)`);
  check(md >= 28, `at the spot they stay spread out (closest pair ${md.toFixed(1)} px, min is 34 px)`);
  inp(E, { dm: [0, 0] }); await sleep(300); check(sh().dg && Math.abs(sh().dg[0] - tx) < 3, 'only the repair seat can send drones');
  inp(R, { dm: [] }); check(await until(() => !sh().dg, 1500), 'cancel (right-click) returns the drones to auto mode');
  inp(R, { dm: [sx + 99999, sy] }); await sleep(300); check(sh().dg && Math.hypot(sh().dg[0] - sh().x, sh().dg[1] - sh().y) <= 1850, 'far clicks are clamped to 1800 px from the ship'); inp(R, { dm: [] });
  inp(R, { dm: [sh().x + 300, sh().y] }); check(await until(() => !sh().dg, 13000), 'drones go back to auto after the 10 s hold');
  // ---- drain + shield rerouting ----
  dev({ op: 'ship', v: { en: 100, lock: 0, pip: [0, 0, 0, 0], swarm: 0, shDown: 0 } }); await sleep(500);
  const base = sh().shm; dev({ op: 'ship', v: { pip: [0, 0, 10, 0] } }); await sleep(500);
  check(Math.abs(sh().shm / base - 2) < 0.05, `10 shield slots double max shield HP (${base} -> ${sh().shm})`);
  check(Math.abs(sh().rd - 14) < 0.3, `10 slots drain ${sh().rd}/s`);
  dev({ op: 'ship', v: { pip: [0, 0, 0, 0] } }); await sleep(300);
  // ---- port upgrades ----
  dev({ op: 'port', r: 3, sl: 0, id: 'mines', lv: 0 }); dev({ op: 'give', cr: 2000 }); dev({ op: 'phase', ph: 'upgrade', secs: 300 }); await sleep(600);
  const buy = async (opt, slot = 0) => { const c0 = E.me.cr; E.send({ t: 'buy', tree: 'engineer', kind: 'pup', slot, opt }); await sleep(350); return c0; };
  const port = () => E.last.crew[3][7][0];
  let cr0 = E.me.cr; await buy('dmg'); check(port()[1] === 1 && port()[2].dmg === 1, `port upgrade option bought: ${JSON.stringify(port())}`);
  await buy('effect'); await buy('zzz'); check(port()[1] === 1, 'generic "effect" option and unknown options are refused');
  await buy('hp'); check(port()[2].hp === 1 && port()[1] === 2, 'Section HP is still one of the options');
  for (let i = 0; i < 6; i++) await buy('dmg'); check(port()[2].dmg === D.PORT_UPS['engineer.mines'][0].max, `each option stops at its max level (${port()[2].dmg}/${D.PORT_UPS['engineer.mines'][0].max})`);
  // ---- bolt colours, sniper + laser ports ----
  dev({ op: 'port', r: 5, sl: 0, id: 'sniper', lv: 0 }); dev({ op: 'port', r: 5, sl: 1, id: 'laser', lv: 0 }); dev({ op: 'port', r: 1, sl: 0, id: 'rockets', lv: 0 });
  check(await startMission('pirates', 4), 'mission 2 started');
  await sleep(500); dev({ op: 'ship', v: { inv: 999, x: 0, y: 0 } }); E.evs.length = 0;
  for (let i = 0; i < 3; i++) dev({ op: 'spawn', type: 2, a: -0.6 + i * 1.3, d: 520, L: 3, static: 1 });
  await sleep(14000);
  const bs = E.evs.filter(e => e[0] === 'b'), kinds = {}; for (const b of bs) kinds[b[6]] = (kinds[b[6]] || 0) + 1;
  check(kinds[1] > 0 && kinds[3] > 0, `starboard bolts kind 1 (red) x${kinds[1]}, port bolts kind 3 (orange) x${kinds[3]}`);
  const sn = bs.filter(e => e[6] === 5); check(sn.length >= 1 && sn.every(b => Math.abs(Math.hypot(b[4], b[5]) - 1900) < 5), `sniper shots: ${sn.length}, all at 1900 px/s`);
  if (sn.length >= 2) { const ts = E.evs.map((e, i) => e); } check(E.evs.some(e => e[0] === 'snp'), 'sniper fires its own flash event');
  const crew5 = E.last.crew[5][7]; check(crew5[0] && crew5[0][0] === 'sniper' && crew5[1] && crew5[1][0] === 'laser', 'port gunner shows sniper + laser ports');
  // ---- kamikaze ----
  dev({ op: 'clear' }); await sleep(300);
  let blasted = false, sawStates = new Set();
  for (let attempt = 0; attempt < 6 && !blasted; attempt++) {
    dev({ op: 'ship', v: { inv: 0, x: 0, y: 0, shp: 0, shDown: 60, h: 20, hm: 20 } }); dev({ op: 'clear' }); await sleep(200); E.evs.length = 0;
    const h0 = sh().h; dev({ op: 'spawn', type: 18, a: attempt * 1.1, d: 600, L: 8, static: 1 });
    const t0 = Date.now(); while (Date.now() - t0 < 6000) { const k = E.last.e.find(e => e[1] === 18); if (k) sawStates.add(k[10]); if (E.evs.some(e => e[0] === 'kx')) break; await sleep(60); }
    await sleep(300); if (E.evs.some(e => e[0] === 'kx') && sh().h < h0) blasted = true;
  }
  check(sawStates.has(1) && sawStates.has(2), `kamikaze telegraph: states seen ${[...sawStates].join(',')} (1 = arming, 2 = dash)`);
  check(E.evs.some(e => e[0] === 'kz') && blasted, `kamikaze rams the ship and explodes: hull ${sh().h}/${sh().hm}, sections ${JSON.stringify(sh().sc)}`);
  dev({ op: 'ship', v: { shDown: 0, shp: 4 } });
  // ---- level 10+ missions ----
  check(await startMission('survival', 12), 'Last Stand (survival) L12 started'); await sleep(300);
  check(mi().dur >= 100 && mi().ext !== undefined, `survival has a timer: ${mi().dur}s`);
  dev({ op: 'mset', v: { time: mi().dur - 1 } }); dev({ op: 'ship', v: { inv: 999 } }); E.evs.length = 0;
  check(await until(() => E.evs.some(e => e[0] === 'win'), 5000), 'surviving the full time wins the mission');
  await sleep(500); dev({ op: 'phase', ph: 'map' }); await sleep(300);
  check(await startMission('bombrun', 12), 'Kamikaze Swarm (bombrun) L12 started'); dev({ op: 'ship', v: { inv: 999 } });
  check(await until(() => E.last.e.some(e => e[1] === 18), 25000), `bombrun spawns kamikaze ships (waves ${mi().waves})`);
  await sleep(500); dev({ op: 'phase', ph: 'map' }); await sleep(300);
  check(await startMission('siege', 12), 'Twin Fortress Siege L12 started'); dev({ op: 'ship', v: { inv: 999 } }); await sleep(1500);
  check(E.last.e.filter(e => e[1] === 9).length === 2, 'siege: two fortress stations');
  E.evs.length = 0; dev({ op: 'clear' }); check(await until(() => E.evs.some(e => e[0] === 'win'), 5000), 'destroying both fortresses wins');
  await sleep(500); dev({ op: 'phase', ph: 'map' }); await sleep(300);
  check(await startMission('pirates', 12), 'pirates L12 started'); check(mi().ext === true && mi().waves >= 5, `extended pirates: ${mi().waves} waves at level 12 (ext)`);
  clearInterval(tick); E.ws.close(); R.ws.close();
  console.log(ok ? 'V6 TESTS PASSED' : 'V6 TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
