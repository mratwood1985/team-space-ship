// v8 headless screenshots (needs DEV_TOOLS=1):  DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v8.js http://localhost:8091/ /workspace/spaceship-game/screens
const puppeteer = require('puppeteer-core'), fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const room = 'V8' + Math.floor(Math.random() * 90 + 10);
  const newPage = async (w = 1366, h = 800) => { const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()); const p = await ctx.newPage(); await p.setViewport({ width: w, height: h }); p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); return p; };
  const open = async (role, name) => { const p = await newPage(); await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); await p.type('#name', name); await p.click(`#prefroles [data-r="${role}"]`); await p.click('#go'); await sleep(1500); return p; };
  const P = await open(0, 'Skids'), G = await open(1, 'Boomer');
  const dev = o => P.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const hide = p => p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; });
  const shot = async (n, p = P) => { await hide(p); return p.screenshot({ path: `${OUT}/v8-${n}.png` }); };
  const ph = () => P.evaluate(() => TSS.snap && TSS.snap.ph);
  // ---- lobby
  check(await ph() === 'lobby', 'private ship starts in the lobby');
  await sleep(500); check(await P.evaluate(() => !document.getElementById('lobby').classList.contains('hide') && document.querySelectorAll('#lobby .lc').length === 6), 'lobby shows six character cards');
  check(await P.evaluate(() => document.querySelectorAll('#lobby .lc.taken').length) === 2, 'two seats are taken by humans');
  await shot('1-lobby');
  // click a taken card does nothing, a free card switches
  await G.evaluate(() => document.querySelector('#lobby .lc[data-r="1"]').click()); await P.evaluate(() => document.querySelector('#lobby .lc[data-r="0"]').click()); await sleep(400);
  check(await P.evaluate(() => TSS.me.role) === 0, 'cannot take a seat another player holds (no duplicates)');
  await P.evaluate(() => document.querySelector('#lobby [data-go]').click()); await sleep(1200);
  check(await P.evaluate(() => TSS.snap.lb > 0), 'start begins a launch countdown'); await shot('1b-lobby-countdown');
  await sleep(3500); check(await ph() === 'intro', 'then the arrival cutscene (intro phase)');
  await sleep(2500); await shot('2-intro-cutscene');
  check(await P.evaluate(() => !document.getElementById('dlg').classList.contains('hide')), 'cutscene dialog is showing');
  await P.keyboard.press('Escape'); await G.keyboard.press('Escape'); await sleep(1500);
  check(await ph() === 'map', 'skipping/finishing the cutscene moves to the star map');
  // ---- hazard zone (radiation) + minimap + text feed
  await dev({ op: 'give', cr: 40000, cores: 200 }); await dev({ op: 'setmk', mk: 3 }); await sleep(400);
  await dev({ op: 'port', r: 0, sl: 0, id: 'hmsl', lv: 2 }); await dev({ op: 'port', r: 0, sl: 1, id: 'rockets', lv: 2 }); await dev({ op: 'port', r: 0, sl: 2, id: 'lance', lv: 2 }); await sleep(400);
  await dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 9, kind: 'side', mod: 'rad', ch: 0, pre: 0 } }); await sleep(1500);
  await dev({ op: 'mset', v: { trickle: 1e9 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, hull: 999 } });
  const z = await P.evaluate(() => TSS.snap.zn); check(z && z.length >= 2, 'radiation mission has hazard zones (' + (z && z.length) + ')');
  // put the ship inside the first zone
  await dev({ op: 'ship', v: { x: z[0][1], y: z[0][2], a: 0 } }); await sleep(900);
  check(await P.evaluate(() => TSS.snap.sh.zk) === 1, 'ship inside radiation reports zk=1');
  await sleep(1500); check(await P.evaluate(() => (document.getElementById('feed').children.length >= 1)), 'text feed has the pilot-explained zone note');
  for (let i = 0; i < 6; i++) await dev({ op: 'spawn', type: [1, 2, 4, 5, 3, 7][i], a: i * 1.0, d: 800 + i * 150, L: 9, static: 1 }); await sleep(800);
  await dev({ op: 'hurt', k: [1] }); await dev({ op: 'hurt', k: [3] }); await sleep(900);
  await shot('6-hazard-zone-radar');
  await P.evaluate(() => TSS.setZ(0.22)); await sleep(500); await shot('6b-hazard-zone-wide'); await P.evaluate(() => TSS.setZ(0.6));
  const mission = async (over, keep) => { await dev({ op: 'mission', i: 0, over }); await sleep(1500); await dev({ op: 'mset', v: { trickle: 1e9 } }); if (!keep) await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, hull: 999, x: 0, y: 0, a: 0 } }); await sleep(300); if (await P.evaluate(() => !document.getElementById('dlg').classList.contains('hide'))) await P.keyboard.press('Escape'); };
  // ---- cold zone
  await mission({ type: 'pirates', level: 9, kind: 'side', mod: 'cold', ch: 0, pre: 0 });
  const zc = await P.evaluate(() => TSS.snap.zn); check(zc.length >= 2 && zc.every(q => q[0] === 1), 'cold mission has cold zones');
  await dev({ op: 'ship', v: { x: zc[0][1], y: zc[0][2], a: 0 } }); await sleep(1200);
  check(await P.evaluate(() => TSS.snap.sh.zk) === 2, 'inside a cold zone reports zk=2'); await shot('7-cold-zone');
  // ---- gravity wells: the dedicated mission
  await mission({ type: 'wellstation', level: 6, kind: 'side', mod: 'none', ch: 0, pre: 0 }, 1);
  const gw = await P.evaluate(() => TSS.snap.gw); check(gw.length >= 12, 'well-station mission has many wells (' + gw.length + ')');
  const near = gw.slice().sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))[0];
  await dev({ op: 'ship', v: { x: near[0] - 520, y: near[1] + 120, a: 0 } }); await sleep(800); await shot('5-gravity-well');
  await P.evaluate(() => TSS.setZ(0.2)); await sleep(500); await shot('5b-gravity-wells-station-wide'); await P.evaluate(() => TSS.setZ(0.6));
  // ---- asteroid station + other station shapes
  await mission({ type: 'pirates', level: 9, kind: 'side', mod: 'none', ch: 0, pre: 0 });
  await dev({ op: 'spawn', type: 20, a: 0, d: 600, L: 9, static: 1 }); await sleep(900); await shot('8-asteroid-station');
  await dev({ op: 'clear' });
  for (const [t, a] of [[21, 0], [22, 2.1], [23, 4.2]]) await dev({ op: 'spawn', type: t, a, d: 700, L: 9, static: 1 });
  await P.evaluate(() => TSS.setZ(0.28)); await sleep(900); await shot('8b-station-variants'); await P.evaluate(() => TSS.setZ(0.6));
  // ---- fighter squadrons
  await dev({ op: 'clear' }); await dev({ op: 'squad', type: 1, n: 5, a: 0.4, d: 850, L: 10 }); await dev({ op: 'squad', type: 2, n: 6, a: 3.6, d: 900, L: 10 });
  await P.evaluate(() => TSS.setZ(0.42)); await sleep(500); await shot('10-fighter-v-formation'); await P.evaluate(() => TSS.setZ(0.6));
  const sq = await P.evaluate(() => TSS.snap.e.filter(e => e[13] > 0).length); check(sq >= 11, 'squadron members are in the snapshot, scaled up (' + sq + ')');
  // ---- yellow pilot weapons (laser, rockets, homing missiles, lance) + minimap in a fight
  await dev({ op: 'clear' }); await dev({ op: 'ship', v: { x: 0, y: 0, a: 0, hull: 999, inv: 999 } });
  await dev({ op: 'spawn', type: 4, a: 0, d: 700, L: 9, static: 1, hpx: 20 }); await dev({ op: 'spawn', type: 2, a: -0.5, d: 800, L: 9, static: 1, hpx: 20 });
  await P.mouse.move(1100, 400); await P.mouse.down(); await sleep(1300); await shot('11-yellow-pilot-weapons'); await P.mouse.up();
  // ---- Esc menu
  await P.keyboard.press('Escape'); await sleep(300); check(await P.evaluate(() => !document.getElementById('menu').classList.contains('hide')), 'Esc opens the game menu'); await shot('12-esc-menu'); await P.keyboard.press('Escape');
  // ---- the final boss
  await mission({ type: 'finale', level: 12, kind: 'main', mod: 'none', ch: 12, title: 'The Drowned Throne', pre: 0 }, 1);
  await sleep(500);
  const boss = await P.evaluate(() => TSS.snap.e.find(e => e[1] === 19)); check(boss && boss[8].length >= 30, 'the Drowned Throne has ' + (boss && boss[8].length) + ' ports');
  await dev({ op: 'ship', v: { x: boss[2] - 900, y: boss[3], a: 0 } }); await P.evaluate(() => TSS.setZ(0.27)); await sleep(1200); await shot('9-big-boss'); await P.evaluate(() => TSS.setZ(0.6)); await dev({ op: 'ship', v: { x: boss[2] - 520, y: boss[3] - 120 } }); await sleep(900); await shot('9b-big-boss-close');
  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 10).join('\n') : 'no page errors');
  await b.close(); process.exit(ok && !errs.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
