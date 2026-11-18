// v5 headless screenshots (needs DEV_TOOLS=1): reroute panel + depleted state, bomb, drone, currency, armed station, passenger run.
//   DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v5.js http://localhost:8091/ screens
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/';
const OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const room = 'V5' + Math.floor(Math.random() * 90 + 10);
  const open = async (role, name) => {
    const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
    await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); await p.type('#name', name); await p.click(`[data-r="${role}"]`); await p.click('#go'); await sleep(1500); await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.TSS && TSS.snap, { timeout: 15000 }); return p;
  };
  const E = await open(3, 'Engineer'), R = await open(2, 'Repairer'); await E.evaluate(() => { window.Z0 = TSS.camZ; });
  const dev = o => E.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const shot = async (p, n, clip) => { await p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; }); return p.screenshot({ path: `${OUT}/v5-${n}.png`, captureBeyondViewport: false, ...(clip ? { clip } : {}) }); };
  const mission = async (over, ship, keep) => { await dev({ op: 'mission', i: 0, over }); await sleep(1800); if (!keep) await dev({ op: 'clear' }); await dev({ op: 'ship', v: Object.assign({ inv: 999 }, ship || {}) }); };

  await dev({ op: 'give', cr: 9000, cores: 8 }); await dev({ op: 'setmk', mk: 1 });

  // 1. reroute panel (mixed slots) + depleted state
  await mission({ type: 'pirates', level: 4 }, { a: -1.0, x: 0, y: 0 });
  await dev({ op: 'spawn', type: 1, a: 0.5, d: 520, L: 3 }); await dev({ op: 'spawn', type: 0, a: 2.4, d: 460, L: 3 });
  for (const k of ['Digit1', 'Digit1', 'Digit1', 'Digit2', 'Digit2', 'Digit3', 'Digit3', 'Digit4']) { await E.keyboard.press(k); await sleep(120); }
  await sleep(2500); await shot(E, '1-engineer-reroute-panel');
  const panel = () => E.$eval('#engp', e => { const r = e.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; });
  await shot(E, '1b-engineer-reroute-panel-closeup', await panel());
  for (const k of ['Digit1', 'Digit1', 'Digit1', 'Digit1', 'Digit1', 'Digit1']) { await E.keyboard.press(k); await sleep(100); }
  await dev({ op: 'ship', v: { en: 1.5 } }); await sleep(2200); await shot(E, '2-engineer-energy-depleted'); await shot(E, '2b-engineer-energy-depleted-closeup', await panel());

  // 2. bomb (innate, own cooldown)
  await mission({ type: 'pirates', level: 4 }, { a: -1.0, x: 0, y: 0, en: 100, lock: 0, pip: [0, 0, 0, 0] });
  await dev({ op: 'ship', v: { en: 100, lock: 0, pip: [0, 0, 0, 0] } });
  for (let i = 0; i < 5; i++) await dev({ op: 'spawn', type: i % 2 ? 1 : 0, a: -1.0 + (i - 2) * 0.12, d: 330 + i * 18, L: 3, static: 1 });
  await sleep(3200); { const c = await E.evaluate(() => TSS.worldToScreen(Math.cos(-1.0) * 360, Math.sin(-1.0) * 360)); await E.mouse.move(c[0], c[1]); }
  await sleep(300); await E.keyboard.press('q'); await sleep(350); await shot(E, '3-bomb-thrown'); await sleep(450); await shot(E, '3b-bomb-blast'); await sleep(250); await shot(E, '3c-bomb-blast2');

  // 3. new drone + brighter currency
  await mission({ type: 'pirates', level: 5 }, { a: -1.0, x: 0, y: 0 });
  await dev({ op: 'spawn', type: 1, a: 0.1, d: 330, L: 2 }); await dev({ op: 'spawn', type: 0, a: -0.4, d: 380, L: 2 });
  await dev({ op: 'drop', n: 8, a: 0.4, d: 230 }); await sleep(3500);
  await shot(R, '4-drone-beam'); await shot(E, '5-currency-bright');
  await R.evaluate(() => { const c = document.getElementById('c') || document.querySelector('canvas'); });
  const dr = await R.evaluate(() => TSS.cur.dr.filter(Boolean)[0]); console.log('drone', JSON.stringify(dr));
  await E.evaluate(() => TSS.setZ(1.0)); await sleep(500); if (dr) { const cl = await E.evaluate(() => { const d = TSS.cur.dr.filter(Boolean)[0]; return d ? TSS.worldToScreen(d[0], d[1]) : null; }); if (cl) await shot(E, '4b-drone-closeup', { x: Math.max(0, cl[0] - 160), y: Math.max(0, cl[1] - 110), width: 320, height: 220 }); }
  await shot(E, '4c-drone-zoom'); await E.evaluate(() => TSS.setZ(window.Z0));

  // 4. armed defence station
  await mission({ type: 'defend', level: 5 }, { a: 0, x: 0, y: 0 });
  await sleep(6000); await dev({ op: 'ship', v: { inv: 999 } });
  for (let i = 0; i < 3; i++) await dev({ op: 'spawn', type: i % 2 ? 1 : 0, a: 2.6 + i * 0.3, d: 520, L: 4 });
  await sleep(1400); await shot(E, '6-armed-station');
  { const st = await E.evaluate(() => TSS.cur.al.find(a => a[1] === 'fs')); console.log('station', JSON.stringify(st));
    if (st) { await dev({ op: 'ship', v: { x: st[2] + 260, y: st[3], inv: 999 } }); await dev({ op: 'spawn', type: 1, a: 3.14, d: 560, L: 4 }); await dev({ op: 'spawn', type: 0, a: 2.5, d: 600, L: 4 }); await E.evaluate(() => TSS.setZ(1.5)); await sleep(1600); await shot(E, '6b-armed-station-zoom'); await sleep(500); await shot(E, '6c-armed-station-firing'); await E.evaluate(() => TSS.setZ(window.Z0)); } }

  // 5. passenger run
  await mission({ type: 'passengers', level: 4 }, {}, true);
  await sleep(1200); await shot(E, '7-passenger-run-start');
  await dev({ op: 'ship', v: { x: 2300, y: 20, a: 0, inv: 999 } }); await sleep(1800); await shot(E, '7b-passenger-run-midfield');
  await dev({ op: 'ship', v: { x: 3250, y: 0, a: 0, inv: 999 } }); await sleep(1500); await shot(E, '7c-passenger-run-passengers-ahead');
  await dev({ op: 'ship', v: { x: 3500, y: 0, a: 0, inv: 999 } }); await sleep(2200); await shot(E, '7d-passenger-run-pickup');
  await dev({ op: 'ship', v: { x: -3000, y: 0, a: PI_(), inv: 999 } }); await sleep(900); await shot(E, '7e-passenger-run-returning');
  await dev({ op: 'phase', ph: 'map', secs: 90 }); await sleep(600); await dev({ op: 'mapopt', i: 1, type: 'passengers' }); await sleep(900); await shot(E, '8-starmap');
  console.log('ERRORS:', errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
function PI_() { return Math.PI; }
