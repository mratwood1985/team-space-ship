// v4 headless screenshots (needs DEV_TOOLS=1): repair panel + minigames, CLICK RAPIDLY, upgrade descriptions, gameplay.
//   DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v4.js http://localhost:8091/ screens
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/';
const OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const room = 'SHOT' + Math.floor(Math.random() * 90 + 10);
  const open = async (role, name) => {
    const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()); const p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800, deviceScaleFactor: 1 });
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); });
    await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); await p.type('#name', name); await p.click(`[data-r="${role}"]`); await p.click('#go'); await sleep(1500); await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.TSS && TSS.snap, { timeout: 15000 }); return p;
  };
  const R = await open(2, 'Repairer');
  const dev = o => R.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const shot = async (p, n, clip) => { await p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; }); return p.screenshot({ path: `${OUT}/v4-${n}.png`, clip, captureBeyondViewport: false }); };
  await R.waitForFunction(() => TSS.snap.ph === 'map', { timeout: 15000 });
  await dev({ op: 'give', cr: 9000, cores: 8 }); await dev({ op: 'setmk', mk: 1 });
  await dev({ op: 'mission', i: 0 }); await sleep(1800); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, a: -1.2, hull: 22 } });
  await dev({ op: 'spawn', type: 1, a: 0.5, d: 520, L: 3 }); await dev({ op: 'spawn', type: 0, a: 2.4, d: 460, L: 3 });
  await dev({ op: 'hurt', k: [0, 3, 4, 1] }); await sleep(900); await R.keyboard.press('Escape');
  await shot(R, '1-repair-panel-idle');
  const clickRow = t => R.evaluate(t => document.querySelector(`#hlist [data-t="${t}"]`).click(), t);
  const panel = () => R.$eval('#repp', e => { const r = e.getBoundingClientRect(); return { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: Math.min(r.height + 12, innerHeight - r.y) }; });
  const box = async () => { const c = await R.$('#rg'); return c.boundingBox(); };
  await clickRow(3); await sleep(900); let bx = await box(); await R.mouse.move(bx.x + 60, bx.y + 110); await R.mouse.down(); await sleep(900);
  await shot(R, '2-repair-engines-minigame', await panel()); await R.mouse.up();
  await clickRow(4); await sleep(700); await shot(R, '2b-repair-deflector-minigame', await panel());
  await clickRow(0); await sleep(600); bx = await box(); await R.mouse.move(bx.x + 200, bx.y + 100); await sleep(500); await shot(R, '2c-repair-cockpit-minigame', await panel());
  await R.evaluate(() => document.getElementById('hullrow').click()); await sleep(500); bx = await box(); await R.mouse.move(bx.x + 120, bx.y + 100); await R.mouse.down(); await sleep(300); await shot(R, '2d-repair-hull-weld-minigame', await panel()); await R.mouse.up();
  await clickRow(1); await sleep(600); await shot(R, '2e-repair-turret-minigame', await panel());
  // drone disabled
  await R.keyboard.press('g'); await sleep(700); await shot(R, '3-repair-drone-disabled', await panel());
  await R.keyboard.press('g'); await sleep(300);
  // second player: Pilot sees CLICK RAPIDLY when the Repair Bay is destroyed
  const P = await open(0, 'Pilot'); await sleep(500);
  await dev({ op: 'hurt', k: [2] }); await sleep(1200);
  await P.waitForSelector('#rapb', { visible: true, timeout: 5000 });
  for (let i = 0; i < 14; i++) { await P.click('#rapb'); await sleep(50); }
  await shot(P, '4-click-rapidly-pilot'); await shot(R, '4b-repair-bay-destroyed-repair-player', await panel());
  const t0 = Date.now(); while (Date.now() - t0 < 25000 && await R.evaluate(() => TSS.snap.sh.dn[2])) { for (let i = 0; i < 6; i++) await P.click('#rapb').catch(() => { }); await sleep(100); }
  await sleep(500); await shot(P, '4c-repair-bay-fixed-pilot');
  // upgrade descriptions
  await dev({ op: 'phase', ph: 'upgrade', secs: 90 }); await sleep(900);
  await dev({ op: 'path', tree: 'repair', path: [2, 1] }); await dev({ op: 'path', tree: 'shield', path: [3, 2] }); await sleep(400);
  await R.evaluate(() => { TSS.setUp('repair'); document.getElementById('upp').classList.remove('hide'); }); await sleep(400);
  await R.setViewport({ width: 1366, height: 1180 }); await sleep(600); await shot(R, '5-upgrade-descriptions');
  await R.evaluate(() => { TSS.setUp('shield'); }); await sleep(300); await shot(R, '5b-upgrade-descriptions-shield');
  await R.setViewport({ width: 1366, height: 800 }); await sleep(300);
  await R.evaluate(() => { document.getElementById('upp').scrollTop = 99999; }); await sleep(300); await shot(R, '5c-upgrade-limitless-and-big');
  await R.evaluate(() => document.getElementById('upp').classList.add('hide'));
  // star map note + gameplay
  await dev({ op: 'phase', ph: 'map', secs: 90 }); await sleep(800); await shot(R, '6-starmap-fire-note');
  await dev({ op: 'mission', i: 0, over: { level: 7 } }); await sleep(1800); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, a: -1.0, hull: 60, x: 0, y: 0 } });
  await dev({ op: 'spawn', type: 7, a: -0.35, d: 620, L: 6 }); await dev({ op: 'spawn', type: 1, a: 0.5, d: 520, L: 6 }); await dev({ op: 'spawn', type: 0, a: 2.4, d: 560, L: 6 }); await dev({ op: 'spawn', type: 15, a: 1.4, d: 700, L: 6 });
  await sleep(300); await sleep(6500); await P.evaluate(() => { document.getElementById('toasts').innerHTML = ''; }); await P.mouse.move(900, 300); await sleep(600); await shot(P, '7-gameplay'); await shot(R, '7b-gameplay-repair-seat');
  console.log('ERRORS:', errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
