// v7 headless screenshots (needs DEV_TOOLS=1):  DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v7.js http://localhost:8091/ /workspace/spaceship-game/screens
const puppeteer = require('puppeteer-core'), fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const room = 'V7' + Math.floor(Math.random() * 90 + 10);
  const newPage = async (w = 1366, h = 800, sc = 1) => { const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()); const p = await ctx.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: sc }); p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); }); return p; };
  // ---- 1. title + roster (before joining)
  { const p = await newPage(1366, 900); await p.goto(URL, { waitUntil: 'load' }); await sleep(1500); await p.screenshot({ path: `${OUT}/v7-1-title-roster.png` });
    await p.evaluate(() => { document.getElementById('intro').scrollTop = 600; }); await sleep(300); await p.screenshot({ path: `${OUT}/v7-1b-title-sector.png` });
    const pm = await newPage(430, 900, 2); await pm.goto(URL, { waitUntil: 'load' }); await sleep(1200); await pm.screenshot({ path: `${OUT}/v7-1c-title-mobile.png` }); await pm.close(); await p.close(); }
  const open = async (role, name) => { const p = await newPage(); await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); await p.type('#name', name); await p.click(`#prefroles [data-r="${role}"]`); await p.click('#go'); await sleep(1500); await p.keyboard.press('Escape'); await p.waitForFunction(() => window.TSS && TSS.snap, { timeout: 15000 }); return p; };
  const E = await open(3, 'Mort'), R = await open(2, 'Finn'), S = await open(4, 'Ophelia');
  const dev = o => E.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const hide = p => p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; });
  const shot = async (p, n, clip, keepToast) => { if (!keepToast) await hide(p); return p.screenshot({ path: `${OUT}/v7-${n}.png`, ...(clip ? { clip } : {}) }); };
  const mission = async (over, ship, trickle) => { await dev({ op: 'mission', i: 0, over }); await sleep(1500); if (trickle !== false) await dev({ op: 'mset', v: { trickle: 1e9 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: Object.assign({ inv: 999, x: 0, y: 0 }, ship || {}) }); };
  const grab = async (p, cond, name, ms = 20000) => { const d = await p.evaluate((cond, ms) => new Promise(res => { const f = new Function('return ' + cond), t0 = performance.now(); const cv = document.getElementById('c'); (function loop() { let ok = false; try { ok = f(); } catch (e) { } if (ok) return res(cv.toDataURL('image/png')); if (performance.now() - t0 > ms) return res(null); requestAnimationFrame(loop); })(); }), cond, ms); if (d) fs.writeFileSync(`${OUT}/v7-${name}.png`, Buffer.from(d.split(',')[1], 'base64')); return !!d; };
  await dev({ op: 'give', cr: 40000, cores: 200 }); await dev({ op: 'setmk', mk: 3 }); await sleep(500);
  for (const [r, sl, id] of [[0, 2, 'scatter'], [1, 2, 'rockets'], [2, 2, 'welder'], [3, 2, 'tractor'], [4, 2, 'reflect'], [5, 2, 'rockets']]) await dev({ op: 'port', r, sl, id, lv: 2 });
  await sleep(600);
  // ---- 2. cutscene (chapter 1 briefing) + 3. villain taunt
  await dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 1, kind: 'main', ch: 1, title: 'Terms and Conditions', pre: 1 } }); await sleep(1400);
  await dev({ op: 'ship', v: { inv: 999, x: 0, y: 0 } }); await sleep(2200); await shot(E, '2-cutscene-briefing');
  await sleep(6000); await shot(E, '2b-cutscene-line-3');
  await E.keyboard.press('Escape');
  await dev({ op: 'mission', i: 0, over: { type: 'defend', level: 6, kind: 'main', ch: 6, title: 'Home Defense', pre: 0 } }); await sleep(1500); await dev({ op: 'mset', v: { trickle: 1e9, vT: 0.05, catT: 40 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999 } }); await sleep(1800);
  await shot(E, '3-villain-taunt');
  await dev({ op: 'mset', v: { catT: 0.05 } }); await sleep(1200); await shot(E, '3b-cat-comm');
  await dev({ op: 'mset', v: { csDone: 0, time: 40 } }); await sleep(1500); await shot(E, '3c-commander-intro');
  // ---- 4. ion bolt + stun
  await mission({ type: 'survival', level: 8 }, { shp: 0, shDown: 30, hull: 999 });
  await dev({ op: 'spawn', type: 8, a: 0, d: 1000, L: 8, static: 1 }); await sleep(600);
  await dev({ op: 'ionbolt', a: 0, d: 1100, L: 8 }); await sleep(100);
  await grab(E, "TSS.snap && TSS.snap.eb.some(b => b[4] === 3 && Math.hypot(b[1] - TSS.cur.x, b[2] - TSS.cur.y) < 520)", '4-ion-bolt-incoming', 4000);
  await dev({ op: 'ship', v: { inv: 0 } }); await dev({ op: 'ionhit' });
  await grab(E, "TSS.snap && TSS.snap.sh.st > 1.5", '4b-ship-stunned-canvas', 6000); await sleep(300);
  await shot(E, '4c-ship-stunned-hud', null, true);
  await sleep(3500);
  await dev({ op: 'clear' }); await dev({ op: 'ship', v: { shp: 5, shm: 5, shDown: 0, ionCd: 0, vx: 0, vy: 0 } }); await dev({ op: 'spawn', type: 7, a: 0, d: 560, L: 6, static: 1 }); await sleep(900);
  const en = await E.evaluate(() => TSS.snap.e.find(e => e[1] === 7).slice(2, 4)); await S.evaluate((x, y) => { window.__ion = setInterval(() => { const d = TSS.cur; }, 1000); }, en[0], en[1]);
  const sw = await S.evaluate((x, y) => TSS.worldToScreen(x, y), en[0], en[1]); await S.mouse.move(sw[0], sw[1]); await S.mouse.down(); await sleep(300); await S.mouse.up();
  await grab(E, "TSS.snap && TSS.snap.e.some(e => e[11] > 0.5)", '4d-enemy-stunned', 4000); await sleep(200); await shot(E, '4e-enemy-stunned-view');
  // ---- 5. hull bar + alarm
  await mission({ type: 'survival', level: 8 }, { hull: 5, inv: 0 }); await dev({ op: 'ship', v: { hull: 30, inv: 999 } }); await sleep(900); await dev({ op: 'ship', v: { hull: 30 } });
  await shot(E, '5a-hull-bar-big');
  await dev({ op: 'ship', v: { hull: 3, inv: 999 } }); await sleep(700); await shot(E, '5-alarm-hull-critical'); await shot(E, '5b-alarm-hud-crop', { x: 0, y: 640, width: 520, height: 160 });
  await dev({ op: 'ship', v: { hull: 70 } });
  // ---- 6. Mk IV ship
  await mission({ type: 'survival', level: 8 }, { hull: 999 }); await E.evaluate(() => TSS.setZ(2.3)); await dev({ op: 'ship', v: { a: -Math.PI / 2 } }); await sleep(900); await shot(E, '6-mk4-ship-closeup');
  await E.evaluate(() => TSS.setZ(1.0)); await sleep(500); await shot(E, '6b-mk4-ship-in-flight');
  // ---- 7. Morph Metal choice (upgrade bay), 8. pyramid row-2 bonus
  await dev({ op: 'phase', ph: 'upgrade', secs: 120 }); await sleep(900); await E.keyboard.press('u'); await sleep(300); await E.evaluate(() => { const d = document.getElementById('upp'); d.classList.remove('hide'); }); await sleep(500);
  await E.evaluate(() => { TSS.setUp('engineer'); }); await sleep(500);
  const mk = await E.$('.mkrow'); if (mk) { await mk.scrollIntoView(); await sleep(200); const bb = await mk.boundingBox(); await E.screenshot({ path: `${OUT}/v7-7-morph-metal-choice.png`, clip: { x: Math.max(0, bb.x - 10), y: Math.max(0, bb.y - 50), width: Math.min(1366, bb.width + 20), height: bb.height + 70 } }); }
  const pyr = await E.$('.pyr'); if (pyr) { await pyr.scrollIntoView(); await sleep(200); const pb = await pyr.boundingBox(); await E.screenshot({ path: `${OUT}/v7-8-pyramid-full.png`, clip: { x: 0, y: Math.max(0, pb.y - 40), width: 1366, height: Math.min(800 - Math.max(0, pb.y - 40), pb.height + 60) } });
    const nodes = await E.$$('.pyr .pn'); const r2 = nodes.slice(6, 11); const bb0 = await r2[1].boundingBox(), bb1 = await r2[3].boundingBox();
    await E.screenshot({ path: `${OUT}/v7-8b-pyramid-row2-bonus.png`, clip: { x: Math.max(0, bb0.x - 150), y: Math.max(0, bb0.y - 60), width: Math.min(1366, bb1.x + bb1.width - bb0.x + 300), height: bb0.height + 90 } }); }
  // ---- 9. final boss
  await E.keyboard.press('Escape'); await dev({ op: 'mission', i: 0, over: { type: 'finale', level: 12, kind: 'main', ch: 12, title: 'The Drowned King', pre: 0 } }); await sleep(1800);
  await dev({ op: 'mset', v: { trickle: 1e9 } }); await dev({ op: 'ship', v: { hull: 999, inv: 999 } }); await sleep(600);
  const bp = await E.evaluate(() => { const b = TSS.snap.e.find(e => e[1] === 19); return b ? [b[2], b[3]] : null; }); console.log('boss at', bp);
  await dev({ op: 'ship', v: { x: bp[0] + 760, y: bp[1] + 60, vx: 0, vy: 0, a: Math.PI } }); await E.evaluate(() => TSS.setZ(0.5)); await sleep(1200); await E.keyboard.press('Escape'); await sleep(500); await shot(E, '9-final-boss');
  await dev({ op: 'ship', v: { x: bp[0] + 560, y: bp[1] + 20 } }); await E.evaluate(() => TSS.setZ(0.7)); await sleep(1200); await shot(E, '9b-final-boss-closer');
  fs.writeFileSync(OUT + '/v7-errors.txt', errs.join('\n')); console.log('errors:', errs.length, errs.slice(0, 8)); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
