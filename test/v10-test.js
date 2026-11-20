// v10: port destruction regression (emerg() recursion), engine reroute turn + shield reroute ion/reboot labels,
// uncapped Energy Siphon upgrade (blocked lasers/ion -> engineer energy).
//   node test/v10-test.js http://localhost:8091
const WebSocket = require('ws'), fs = require('fs'), path = require('path');
const D = require('../public/defs.js');
const { Room } = require('../server.js');
const BASE = process.argv[2] || 'http://localhost:8091', wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
const PILOT = 0, GUNR = 1, REPAIR = 2, ENG = 3, SHIELD = 4, GUNL = 5, DT = 1 / 30;
let pidc = 11000;
const mkC = (name, cr = 0) => ({ pid: ++pidc, ws: { readyState: 0 }, prof: { name, cr, earned: 0, t: {} }, inp: { ax: 0, ay: -300, f: 0, idle: 0, thr: 0.4, rt: -1, mb: 0, ck: 0, sx: 0 }, acts: [] });
const steps = (r, sec) => { for (let i = 0; i < Math.round(sec * 30); i++) r.step(); };
(async () => {
  check(D.VERSION === 10, 'VERSION 10');
  const sip = D.TREES.shield.inf.find(x => x[0] === 'i_siphon');
  check(sip && sip[2] === 'absorb' && sip[3] > 0 && !D.infCap('shield', 'i_siphon', 99), `item 3: Energy Siphon is an uncapped shield upgrade (+${sip[3] * 100}% absorb per level)`);
  check(D.RR_CFG.turn > 0 && D.RR_CFG.ion > 0, `item 2: RR_CFG.turn=${D.RR_CFG.turn} ion=${D.RR_CFG.ion}`);
  const gjs = fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8');
  check(/turn rate \+/.test(gjs) && /20s reboot/.test(gjs) && /ion recharge/.test(gjs), 'item 2: engineer UI labels mention turn rate, 20s reboot and ion recharge');
  check(/enabs/.test(gjs) && /siphonFlash/.test(gjs) && /Energy Siphon/.test(gjs), 'item 3: blocked-shot energy popup + engineer panel flash');

  // ----- item 1: the v8 emerg() recursion is gone; ports and stations take damage, go down, show as destroyed, and can be repaired -----
  const r = new Room('V10A', false), p = mkC('Pil'), rp = mkC('Fix'), e = mkC('Eng'), sh = mkC('Sh');
  r.addClient(p, PILOT); r.addClient(rp, REPAIR); r.addClient(e, ENG); r.addClient(sh, SHIELD);
  p.prof.cr = 1e6; rp.prof.cr = 1e6;
  r.mk = 3; r.resetShip();
  // install a mix of classic and v8/v9 ports
  const buys = [[PILOT, 0, 'needle'], [PILOT, 1, 'swarm'], [PILOT, 2, 'gyro'], [ENG, 0, 'coolant'], [ENG, 1, 'emp'], [SHIELD, 0, 'coil'], [SHIELD, 2, 'harden'], [REPAIR, 0, 'hregen'], [GUNR, 0, 'flak'], [GUNL, 2, 'laser']];
  const berr = [];
  for (const [role, sl, id] of buys) { const err = r.buyPort(p.prof, role, sl, id); if (err) berr.push(id + ':' + err); }
  check(!berr.length, 'installed classic + v8/v9 ports' + (berr.length ? ' ' + berr.join(',') : ''));
  r.startMission(Object.assign({}, r.options[0], { type: 'pirates', level: 6, kind: 'side', mod: 'none', pre: 0 }));
  r.ship.inv = 0; r.ship.aegis = 0; r.ship.hull = 9999; r.ship.hm = 9999; r.ship.shp = 0; r.ship.shDown = 99;
  r.enemies = []; r.eb = []; r.ship.x = 0; r.ship.y = 0; r.ship.a = 0;
  r.calcStats();
  check(r.emerg() === 0, 'emerg() returns 0 with no foam/upgrade (does not recurse)');
  rp.prof.t.repair.i.i_whatever = 0; // no-op
  // foam bonus path
  const foamR = new Room('V10F', false), fr = mkC('F'); foamR.addClient(fr, REPAIR); fr.prof.cr = 1e6; foamR.mk = 3; foamR.resetShip();
  foamR.buyPort(fr.prof, REPAIR, 1, 'foam'); check(Math.abs(foamR.emerg() - 0.2) < 1e-9, `foam port adds +0.2 restart HP fraction (emerg=${foamR.emerg()})`);

  // shoot a v9 port (Needle Gun, secIdx 0,0 = 6) until it is destroyed — this is the path that used to throw
  const kNeedle = D.secIdx(PILOT, 0), kCoil = D.secIdx(SHIELD, 0), kFlak = D.secIdx(GUNR, 0);
  check(r.secExists(kNeedle) && r.ports[PILOT][0].id === 'needle', 'Needle Gun exists as a physical section ' + kNeedle);
  r.secW = []; for (let k = 0; k < D.NSEC; k++) r.secW.push(r.secExists(k) ? r.secWorld(k) : [0, 0]);
  const shootSec = (k, n) => {
    const [wx, wy] = r.secWorld(k);
    for (let i = 0; i < n; i++) r.hitShip(wx, wy, 0.1, 1.2, { t: 0, dm: 1 });
  };
  let threw = 0;
  try { shootSec(kNeedle, 6); } catch (e) { threw = 1; console.log('THREW', e.message); }
  check(!threw && r.ship.sec[kNeedle].dn === 1, `item 1: shooting the Needle Gun port destroys it (dn=${r.ship.sec[kNeedle].dn}, hp=${r.ship.sec[kNeedle].hp}) without throwing`);
  check(r.events.some(e => e[0] === 'sd' && e[1] === kNeedle), 'destroyed-port event sd fired for the Needle Gun');
  try { shootSec(0, 6); shootSec(kCoil, 6); shootSec(kFlak, 6); } catch (e) { threw = 1; }
  check(!threw && r.ship.sec[0].dn && r.ship.sec[kCoil].dn && r.ship.sec[kFlak].dn, 'Cockpit + v9 Regen Coil + Flak Turret can all be destroyed the same way');

  // snapshot exposes health + down flags for the repair panel
  const snap = r.snapshot();
  check(snap.sh.sc[kNeedle] >= 0 && snap.sh.dn[kNeedle] === 1 && snap.sh.sc[kCoil] >= 0 && snap.sh.dn[kCoil] === 1, `snapshot lists destroyed extra ports for the repair panel (sc/dn needle=${snap.sh.sc[kNeedle]}/${snap.sh.dn[kNeedle]})`);

  // repair the Needle Gun: click-to-start (rt) + auto heal; recalled drone makes it faster
  r.ship.sec[REPAIR].dn = 0; r.ship.sec[REPAIR].hp = r.secMax(REPAIR);
  const hp0 = r.ship.sec[kNeedle].hp;
  rp.inp.rt = kNeedle; rp.inp.idle = 0; rp.inp.mb = 0; r.ship.droneOff = 0;
  steps(r, 1);
  const hp1 = r.ship.sec[kNeedle].hp;
  check(r.ship.task.i === kNeedle && hp1 > hp0, `click-to-start repair: task on Needle Gun, HP ${hp0.toFixed(2)} -> ${hp1.toFixed(2)} in 1s`);
  // minigame bonus (mb) speeds it up
  const a1 = hp1 - hp0;
  rp.inp.mb = 1; steps(r, 1); const a2 = r.ship.sec[kNeedle].hp - hp1;
  check(a2 > a1 * 1.4, `minigame speeds repair: +${a1.toFixed(2)}/s base vs +${a2.toFixed(2)}/s with minigame (up to +100%)`);
  // recalled drone +50%
  rp.inp.mb = 0; const hp2 = r.ship.sec[kNeedle].hp; r.ship.droneOff = 1; steps(r, 1); const a3 = r.ship.sec[kNeedle].hp - hp2;
  check(a3 > a1 * 1.3, `recalled drone +50% repair: +${a3.toFixed(2)}/s vs +${a1.toFixed(2)}/s`);
  // finish the repair
  r.healSec(kNeedle, 99); check(!r.ship.sec[kNeedle].dn && r.events.some(e => e[0] === 'sr' && e[1] === kNeedle), 'repaired port comes back (sr event)');

  // CLICK RAPIDLY path: destroying the Repair Bay still sets dn[REPAIR] so other players can click it back
  try { shootSec(REPAIR, 8); } catch (e) { threw = 1; }
  check(!threw && r.ship.sec[REPAIR].dn === 1, 'Repair Bay can be destroyed (CLICK RAPIDLY help still applies)');

  // ----- item 2: engine reroute turns the ship faster; shield reroute speeds 20s reboot + ion recharge -----
  const r2 = new Room('V10B', false), p2 = mkC('P2'), e2 = mkC('E2'); r2.addClient(p2, PILOT); r2.addClient(e2, ENG);
  r2.startMission(r2.options[0]); r2.ship.inv = 999; r2.ship.hull = 999; r2.ship.x = 0; r2.ship.y = 0; r2.ship.a = 0; r2.ship.lock = 0; r2.ship.en = 100;
  r2.ship.pip = [0, 0, 0, 0]; e2.inp.thr = 0.4; p2.inp.idle = 0; p2.inp.ax = 0; p2.inp.ay = 2000; // want heading +PI/2
  const turnFor = pip0 => { r2.ship.a = 0; r2.ship.pip = [pip0, 0, 0, 0]; r2.ship.lock = 0; steps(r2, 0.5); return Math.abs(r2.ship.a); };
  const t0 = turnFor(0), t10 = turnFor(10);
  check(t10 > t0 * 1.2, `item 2: 10 engine slots turn the ship faster (${t0.toFixed(3)} rad in 0.5s -> ${t10.toFixed(3)}, expected ~+30%)`);

  const r3 = new Room('V10C', false), s3 = mkC('S3'), e3 = mkC('E3'); r3.addClient(s3, SHIELD); r3.addClient(e3, ENG);
  r3.startMission(r3.options[0]); r3.ship.inv = 999;
  r3.ship.pip = [0, 0, 0, 0]; r3.ship.lock = 0; r3.ship.shDown = 20; steps(r3, 2); const left0 = r3.ship.shDown;
  r3.ship.pip = [0, 0, 10, 0]; r3.ship.lock = 0; r3.ship.shDown = 20; steps(r3, 2); const left10 = r3.ship.shDown;
  check(left10 < left0 - 0.4, `item 2: 10 shield slots run the 20s reboot faster (2s later: ${left0.toFixed(2)}s left vs ${left10.toFixed(2)}s left)`);
  const cd0 = r3.ionCdM(); r3.ship.pip = [0, 0, 0, 0]; const cdOff = r3.ionCdM();
  r3.ship.pip = [0, 0, 10, 0]; const cdOn = r3.ionCdM();
  check(cdOn < cdOff * 0.6, `item 2: 10 shield slots shorten the ion bolt cooldown (x${cdOff.toFixed(2)} -> x${cdOn.toFixed(2)})`);
  check(r3.shieldMax() > (4 * 1.01), 'shield HP already rises with shield reroute (existing)');

  // ----- item 3: Energy Siphon increases energy gained from blocked shots -----
  const r4 = new Room('V10D', false), s4 = mkC('S4'); r4.addClient(s4, SHIELD);
  r4.startMission(r4.options[0]); r4.ship.inv = 0; r4.ship.shp = 20; r4.ship.shm = 20; r4.ship.shDown = 0; r4.ship.en = 40; r4.ship.em = 200;
  r4.calcStats();
  r4.shieldHit({ t: 0, hv: 0, x: 10, y: 10, sd: 0.01 });
  const g0 = r4.ship.en - 40;
  check(g0 > 0 && r4.events.some(e => e[0] === 'enabs' && e[3] > 0), `a blocked laser already feeds the pool (+${g0} energy, enabs event)`);
  s4.prof.t.shield.i.i_siphon = 4; r4.calcStats(); r4.ship.en = 40; r4.events = [];
  r4.shieldHit({ t: 0, hv: 0, x: 10, y: 10, sd: 0.01 });
  const g4 = r4.ship.en - 40;
  check(g4 > g0 * 1.8, `Energy Siphon Lv 4 raises the conversion (${g0} -> ${g4}; expected 2 * (1+1.0) = 4)`);
  r4.ship.en = 40;
  r4.shieldHit({ t: 3, hv: 1, x: 10, y: 10, sd: 0.01 });
  check(r4.ship.en - 40 > g4, `a blocked ion bolt converts even more (heavy: ${ (r4.ship.en - 40).toFixed(1) })`);

  // live health
  try {
    const h = await (await fetch(BASE + '/health')).json();
    check(h.v === 10, '/health shows v 10 (local ' + h.v + ')');
  } catch (e) { check(false, '/health: ' + e.message); }

  console.log(ok ? 'V10 TESTS PASSED' : 'V10 TESTS FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
