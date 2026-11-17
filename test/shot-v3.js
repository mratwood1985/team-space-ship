// v3 headless screenshots (needs the server started with DEV_TOOLS=1 so scenes can be staged):
//   DEV_TOOLS=1 PORT=8091 node server.js &  node test/shot-v3.js http://localhost:8091/ screens
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/';
const OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const p = await b.newPage(); await p.setViewport({ width: 1366, height: 800, deviceScaleFactor: 1 });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const shot = async (n, clip) => { await p.evaluate(() => { document.getElementById('banner').style.display = 'none'; document.getElementById('toasts').innerHTML = ''; }); return p.screenshot({ path: `${OUT}/v3-${n}.png`, clip, captureBeyondViewport: false }); };
  await p.goto(URL + '?room=SHOT' + Math.floor(Math.random() * 90 + 10), { waitUntil: 'load' });
  await p.type('#name', 'Atwood'); await p.click('[data-r="4"]'); await p.click('#go'); await sleep(1800); await p.click('#card').catch(() => { });
  await p.waitForFunction(() => window.TSS && TSS.snap && TSS.snap.ph === 'map', { timeout: 15000 });
  await sleep(800); await shot('1-starmap');
  // planets montage: every kind rendered by the real planet renderer
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'pm'; d.style.cssText = 'position:fixed;inset:0;z-index:99;background:#04050c;display:grid;grid-template-columns:repeat(4,1fr);align-items:center;padding:10px'; Object.keys(TSS.PK).forEach((k, i) => { const c = document.createElement('canvas'); c.width = c.height = 320; c.style.cssText = 'width:100%;max-width:300px;margin:auto'; c.getContext('2d').drawImage(TSS.planet({ kind: k, seed: 1234 + i * 77, name: k }), 0, 0); const w = document.createElement('div'); w.style.cssText = 'text-align:center;color:#9bd;font:12px monospace'; w.appendChild(c); w.appendChild(document.createTextNode(k)); d.appendChild(w); }); document.body.appendChild(d); });
  await sleep(300); await shot('2-planets'); await p.evaluate(() => document.getElementById('pm').remove());
  // wide shield for the demo: buy +5deg arc upgrades in the upgrade phase, then stage
  await dev({ op: 'give', cr: 6000, cores: 0 }); await dev({ op: 'phase', ph: 'upgrade', secs: 60 }); await sleep(600);
  await dev({ op: 'path', tree: 'shield', path: [1, 1, 1, 1, 0] });
  for (let i = 0; i < 9; i++) await p.evaluate(() => TSS.send({ t: 'buy', tree: 'shield', kind: 'inf', id: 'i_arc' }));
  await sleep(500); await p.evaluate(() => document.getElementById('upp').classList.add('hide'));
  // start a mission, stage each ship tier
  const stage = async mk => { await dev({ op: 'setmk', mk }); await dev({ op: 'mission', i: 0 }); await sleep(1500); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, a: -1.2 } }); };
  const cx = 683, cy = 400;
  for (const mk of [0, 1, 2]) { await stage(mk); await sleep(2200); await p.evaluate(() => TSS.setZ(1.7)); await p.mouse.move(cx + 300, cy - 200); await dev({ op: 'ship', v: { inv: 999, a: -0.4, vx: 0, vy: 0 } }); await sleep(250); await shot('3-ship-mk' + (mk + 1), { x: cx - 260, y: cy - 200, width: 520, height: 400 }); await p.evaluate(() => TSS.setZ(0.63)); }
  // full screenshot of Mk III battle HUD with a wide shield and an enemy gunship
  await dev({ op: 'spawn', type: 6, a: 0.0, d: 650, L: 3 }); await dev({ op: 'spawn', type: 1, a: 0.5, d: 500, L: 3 });
  await p.mouse.move(cx + 300, cy); await sleep(2500); await shot('4-shield-arc');
  await dev({ op: 'hurt', k: [1, 7, 11, 15] }); await sleep(900); await shot('5-destroyed-ports', { x: cx - 230, y: cy - 190, width: 460, height: 380 });
  // large enemies with docks
  await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, x: 0, y: 0, a: -1.5708 } });
  await dev({ op: 'spawn', type: 16, a: 0.2, d: 800, L: 9, static: 1 }); await sleep(2500); await shot('6-carrier-dock');
  await dev({ op: 'clear' }); await dev({ op: 'spawn', type: 7, a: -0.35, d: 520, L: 6, static: 1 }); await dev({ op: 'spawn', type: 15, a: 0.8, d: 480, L: 6, static: 1 }); await dev({ op: 'spawn', type: 11, a: -1.0, d: 300, L: 6, static: 1 }); await sleep(2500); await shot('7-frigate-cruiser-warden');
  await dev({ op: 'clear' }); await dev({ op: 'spawn', type: 17, a: 0.0, d: 900, L: 12, static: 1 }); await sleep(2500); await shot('8-dreadnought');
  // skill pyramid
  await dev({ op: 'give', cr: 3000, cores: 4 }); await dev({ op: 'phase', ph: 'upgrade', secs: 60 }); await sleep(900);
  await dev({ op: 'path', tree: 'shield', path: [3, 2] }); await sleep(500);
  await p.evaluate(() => { TSS.setUp('shield'); document.getElementById('upp').classList.remove('hide'); }); await sleep(400);
  await p.setViewport({ width: 1366, height: 1150 }); await sleep(500); await shot('9-skill-pyramid'); await p.setViewport({ width: 1366, height: 800 }); await sleep(400); await p.evaluate(() => { document.getElementById('upp').scrollTop = 99999; }); await sleep(200); await shot('10-ports-and-upgrades');
  console.log('ERRORS:', errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
