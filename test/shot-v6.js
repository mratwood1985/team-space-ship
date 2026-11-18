// v6 headless screenshots (needs DEV_TOOLS=1):
//   DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v6.js http://localhost:8091/ screens
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/';
const OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const room = 'V6' + Math.floor(Math.random() * 90 + 10);
  const open = async (role, name) => {
    const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
    await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); await p.type('#name', name); await p.click(`[data-r="${role}"]`); await p.click('#go'); await sleep(1500); await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.TSS && TSS.snap, { timeout: 15000 }); return p;
  };
  const E = await open(3, 'Engineer'), R = await open(2, 'Repairer'), G = await open(5, 'PortGunner');
  const dev = o => E.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const shot = async (p, n, clip) => { await p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; }); return p.screenshot({ path: `${OUT}/v6-${n}.png`, captureBeyondViewport: false, ...(clip ? { clip } : {}) }); };
  const mission = async (over, ship, trickle) => { await dev({ op: 'mission', i: 0, over }); await sleep(1800); if (trickle !== false) await dev({ op: 'mset', v: { trickle: 1e9 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: Object.assign({ inv: 999, x: 0, y: 0 }, ship || {}) }); };
  const fs = require('fs');
  // grab the game canvas in the very frame a condition becomes true (a normal screenshot is too slow for a 1900 px/s sniper bolt or a 0.3 s dash)
  const grab = async (p, cond, name, ms = 20000) => { const d = await p.evaluate((cond, ms) => new Promise(res => { const f = new Function('return ' + cond), t0 = performance.now(); const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; (function loop() { let ok = false; try { ok = f(); } catch (e) {} if (ok) return res(cv.toDataURL('image/png')); if (performance.now() - t0 > ms) return res(null); requestAnimationFrame(loop); })(); }), cond, ms); if (d) fs.writeFileSync(`${OUT}/v6-${name}.png`, Buffer.from(d.split(',')[1], 'base64')); return !!d; };
  const wait = (p, fn, ms = 12000) => p.waitForFunction(fn, { polling: 40, timeout: ms }).then(() => true, () => false);
  const around = async (p, wx, wy, w = 360, h = 240) => { const c = await p.evaluate((x, y) => TSS.worldToScreen(x, y), wx, wy); return { x: Math.max(0, Math.min(1366 - w, c[0] - w / 2)), y: Math.max(0, Math.min(800 - h, c[1] - h / 2)), width: w, height: h }; };
  await dev({ op: 'give', cr: 9000, cores: 8 }); await dev({ op: 'setmk', mk: 2 });
  await dev({ op: 'port', r: 2, sl: 0, id: 'drone2', lv: 0 }); await dev({ op: 'port', r: 5, sl: 0, id: 'sniper', lv: 0 }); await dev({ op: 'port', r: 5, sl: 1, id: 'laser', lv: 0 });
  await dev({ op: 'port', r: 1, sl: 0, id: 'rockets', lv: 0 }); await dev({ op: 'port', r: 0, sl: 0, id: 'rockets', lv: 0 }); await sleep(800);

  // 1. drones: spread out, click the map to send them
  await mission({ type: 'survival', level: 12 }, { swarm: 90 });
  await dev({ op: 'spawn', type: 1, a: 0.1, d: 760, L: 3, static: 1 }); await dev({ op: 'spawn', type: 4, a: 0.5, d: 820, L: 3, static: 1 }); await sleep(3500);
  await shot(R, '1a-drones-auto-spread');
  const ship = await R.evaluate(() => [TSS.cur.x, TSS.cur.y]); const tgt = [ship[0] + 430, ship[1] - 170];
  const sc = await R.evaluate((x, y) => TSS.worldToScreen(x, y), tgt[0], tgt[1]); await R.mouse.move(sc[0], sc[1]); await sleep(100); await R.mouse.click(sc[0], sc[1]); await sleep(3800);
  await shot(R, '1-drone-move-to-spread');
  const dg = await R.evaluate(() => TSS.cur.sh.dg); console.log('drone marker', JSON.stringify(dg), 'drones', await R.evaluate(() => TSS.cur.dr.filter(Boolean).length));
  await R.evaluate(() => TSS.setZ(1.4)); await sleep(500); await shot(R, '1b-drone-move-to-zoom'); await R.evaluate(() => TSS.setZ(0.9));
  await R.mouse.click(sc[0], sc[1], { button: 'right' }); await sleep(300);

  // 2. engineer grid bottom-right + 5. A/S/D HUD
  for (const k of ['Digit1', 'Digit1', 'Digit1', 'Digit2', 'Digit2', 'Digit3', 'Digit3', 'Digit3', 'Digit4']) { await E.keyboard.press(k); await sleep(120); }
  await sleep(1500); await shot(E, '2-engineer-grid-bottom-right');
  { const bb = await E.$eval('#engp', e => { const r = e.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; }); await shot(E, '2b-engineer-grid-closeup', bb); }
  await shot(E, '5-asd-hud-engineer'); await shot(R, '5b-asd-hud-repair');
  { const bb = await E.$eval('#abar', e => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: Math.min(1366, r.width + 40), height: r.height + 40 }; }); await shot(E, '5c-asd-hud-closeup', bb); }
  await E.keyboard.press('c');

  // 3/4/8. missiles with flames, orange + red gunner fire, sniper shot
  await mission({ type: 'survival', level: 12 }, { a: -Math.PI / 2 });
  await G.mouse.move(300, 400);
  await dev({ op: 'spawn', type: 3, a: -1.2, d: 640, L: 4 }); await dev({ op: 'spawn', type: 3, a: -2.0, d: 660, L: 4 });
  for (const a of [0.15, -0.25, Math.PI - 0.2, Math.PI + 0.3]) await dev({ op: 'spawn', type: 4, a, d: 470, L: 3, static: 1 });
  // the port gunner (human) holds fire at the left enemies
  const aimG = async () => { const e = await G.evaluate(() => { const L = TSS.cur.e.filter(e => e[1] === 4 && e[2] < TSS.cur.x)[0]; return L ? TSS.worldToScreen(L[2], L[3]) : null; }); if (e) { await G.mouse.move(e[0], e[1]); } };
  await sleep(500); await aimG(); await G.mouse.down();
  let got = {};
  const t0 = Date.now(); while (Date.now() - t0 < 30000 && !(got.snp && got.col && got.msl && got.pmsl)) {
    const st = await E.evaluate(() => { const k = new Set([...TSS.bolts.values()].map(b => b.kind)); return { k: [...k], eb: TSS.cur.eb.filter(b => b[4] === 1).map(b => [b[1], b[2]]), pp: TSS.cur.pp.filter(p => p[4] === 0).map(p => [p[1], p[2]]), x: TSS.cur.x, y: TSS.cur.y }; });
    await aimG();
    if (!got.col && st.k.includes(1) && st.k.includes(3)) { got.col = 1; await shot(E, '4-orange-and-red-gunner-fire'); await E.evaluate(() => TSS.setZ(1.5)); await sleep(60); await shot(E, '4b-orange-and-red-gunner-fire-zoom'); await E.evaluate(() => TSS.setZ(0.9)); }
    if (!got.msl && st.eb.length) { got.msl = 1; await shot(E, '3-enemy-missile-green-flame'); }
    if (!got.pmsl && st.pp.length) { got.pmsl = 1; await shot(E, '3b-player-rocket-red-flame'); }
    await sleep(60);
  }
  console.log('captured', JSON.stringify(got));
  // in-page auto-aim for the port gunner (mouse stays held), enemies re-spawned while we wait for the exact frames
  await G.evaluate(() => { const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; setInterval(() => { const L = TSS.cur.e.filter(e => (e[1] === 4 || e[1] === 3) && e[2] < TSS.cur.x).sort((a, b) => Math.hypot(a[2] - TSS.cur.x, a[3] - TSS.cur.y) - Math.hypot(b[2] - TSS.cur.x, b[3] - TSS.cur.y))[0]; if (L) { const c = TSS.worldToScreen(L[2], L[3]); cv.dispatchEvent(new MouseEvent('mousemove', { clientX: c[0], clientY: c[1], bubbles: true })); } }, 60); });
  const respawn = setInterval(() => { dev({ op: 'spawn', type: 4, a: Math.PI + (Math.random() - 0.5) * 0.8, d: 440, L: 3, static: 1, hpx: 8 }); dev({ op: 'spawn', type: 3, a: -1.6 + (Math.random() - 0.5) * 2, d: 600, L: 4, hpx: 3 }); dev({ op: 'ship', v: { inv: 999 } }); }, 2500);
  await G.evaluate(() => TSS.setZ(0.8)); await E.evaluate(() => TSS.setZ(1.6));
  const [sn] = await Promise.all([
    grab(G, '[...TSS.bolts.values()].some(b => b.kind === 5)', '8-sniper-turret-shot', 40000),
    grab(E, 'TSS.cur.eb.some(b => b[4] === 1 && Math.hypot(b[1] - TSS.cur.x, b[2] - TSS.cur.y) < 300)', '3a-enemy-missile-zoom', 40000)]);
  await sleep(200); const sn2 = await grab(G, '[...TSS.bolts.values()].some(b => b.kind === 5)', '8b-sniper-turret-shot-2', 20000);
  const pr = await grab(E, 'TSS.cur.pp.some(p => p[4] === 0 && Math.hypot(p[1] - TSS.cur.x, p[2] - TSS.cur.y) < 300)', '3c-player-rocket-zoom', 30000);
  clearInterval(respawn); console.log('sniper', sn, sn2, 'rocket', pr); await G.mouse.up(); await G.evaluate(() => TSS.setZ(0.9)); await E.evaluate(() => TSS.setZ(0.9));

  // 6. port upgrade options (engineer: mines, gunner: sniper, repair: empty slot choices)
  await dev({ op: 'port', r: 3, sl: 0, id: 'mines', lv: 3, u: { dmg: 2, rate: 1 } }); await dev({ op: 'noport', r: 2, sl: 1 }); await dev({ op: 'noport', r: 5, sl: 1 });
  await dev({ op: 'phase', ph: 'upgrade', secs: 400 }); await sleep(1200);
  await E.keyboard.press('u').catch(() => {}); await sleep(600);
  if (!await E.$eval('#upp', e => !e.classList.contains('hide'))) { await E.keyboard.press('u'); await sleep(600); }
  await E.evaluate(() => { const h = [...document.querySelectorAll('#upp h4')].find(x => /Ship ports/.test(x.textContent)); if (h) h.scrollIntoView(true); }); await sleep(300); await shot(E, '6-port-upgrade-options-engineer');
  for (const [p, n] of [[G, 'gunner-5-port-choices'], [R, 'repair']]) { if (!await p.$eval('#upp', e => !e.classList.contains('hide'))) { await p.keyboard.press('u'); await sleep(500); } await p.evaluate(() => { const h = [...document.querySelectorAll('#upp h4')].find(x => /Ship ports/.test(x.textContent)); if (h) h.scrollIntoView(true); }); await sleep(300); await shot(p, '6b-port-upgrade-options-' + n); }
  for (const p of [E, G, R]) { if (await p.$eval('#upp', e => !e.classList.contains('hide')).catch(() => false)) await p.keyboard.press('Escape'); }

  // 7. level 10+ missions
  await dev({ op: 'phase', ph: 'map', secs: 60 }); await sleep(500);
  await mission({ type: 'survival', level: 12 }, {}, false); await sleep(5000); await shot(E, '7-level12-last-stand');
  await mission({ type: 'siege', level: 12 }, {}); await dev({ op: 'clear' }); await sleep(300); await dev({ op: 'mission', i: 0, over: { type: 'siege', level: 12 } }); await sleep(2500); await dev({ op: 'ship', v: { inv: 999, x: 0, y: 0 } }); await sleep(1500); await shot(E, '7b-level12-twin-fortress-siege');
  await dev({ op: 'mission', i: 0, over: { type: 'bombrun', level: 12 } }); await sleep(1500); await dev({ op: 'ship', v: { inv: 999, x: 0, y: 0 } });
  await wait(E, () => TSS.cur && TSS.cur.e.some(e => e[1] === 18 && e[10] === 1), 40000); await shot(E, '7c-level12-kamikaze-swarm');

  // 9. kamikaze ship: arming telegraph, dash, blast (tough ones so the bots do not shoot them down first)
  await mission({ type: 'survival', level: 12 }, { shDown: 60, shp: 0 });
  await E.evaluate(() => TSS.setZ(0.75));
  await dev({ op: 'spawn', type: 18, a: 0.3, d: 600, L: 8, hpx: 40 }); await dev({ op: 'spawn', type: 18, a: 2.3, d: 620, L: 8, hpx: 40 });
  let k1 = await grab(E, 'TSS.cur.e.some(e => e[1] === 18 && e[10] === 1)', '9-kamikaze-arming', 8000);
  let k2 = await grab(E, 'TSS.cur.e.some(e => e[1] === 18 && e[10] === 2)', '9c-kamikaze-dash', 8000);
  let k3 = await grab(E, 'TSS.cur.e.filter(e => e[1] === 18).length < 2', '9d-kamikaze-blast', 8000);
  await E.evaluate(() => TSS.setZ(0.9));
  console.log('kamikaze states seen', k1, k2);
  console.log('ERRORS:', errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
