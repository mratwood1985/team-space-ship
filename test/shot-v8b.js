// v8 screenshots part 2: public ship (no lobby, intro plays once), defend-two-stations mission with outpost variants, strafe flames, touch layout.
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()), p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800 });
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL + '?room=SB' + Math.floor(Math.random() * 900 + 100), { waitUntil: 'load' }); await p.type('#name', 'Solo'); await p.click('#prefroles [data-r="0"]');
  const pub = await p.evaluate(() => !!document.querySelector('#go')); await p.click('#go'); await sleep(1500); await p.evaluate(() => TSS.send({ t: 'start' })); await sleep(5000); await p.keyboard.press('Escape'); await sleep(1500);
  const ph = await p.evaluate(() => TSS.snap && TSS.snap.ph + ' pub=' + TSS.me.pub);
  console.log('phase', ph);
  const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const shot = async n => { await p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; }); return p.screenshot({ path: `${OUT}/v8-${n}.png` }); };
  const introShown = await p.evaluate(() => !document.getElementById('dlg').classList.contains('hide')); console.log('intro dialog on public ship:', introShown);
  await dev({ op: 'give', cr: 9000, cores: 9 }); await dev({ op: 'setmk', mk: 3 }); await sleep(300);
  if (introShown) await p.keyboard.press('Escape');
  await dev({ op: 'mission', i: 0, over: { type: 'defend2', level: 6, kind: 'side', mod: 'none', ch: 0, pre: 0 } }); await sleep(1800);
  await dev({ op: 'ship', v: { inv: 999, hull: 999, x: 0, y: 0, a: 0 } });
  const fs = await p.evaluate(() => TSS.snap.al.filter(a => a[1] === 'fs').map(a => [a[2], a[3], a[9]])); check(fs.length === 2 && fs[0][2] !== fs[1][2], 'defend2: two outposts in different areas with different looks ' + JSON.stringify(fs));
  await dev({ op: 'ship', v: { x: fs[0][0] - 330, y: fs[0][1], a: 0 } }); await sleep(900); await shot('13a-outpost-a');
  await dev({ op: 'ship', v: { x: fs[1][0] - 330, y: fs[1][1], a: 0 } }); await sleep(900); await shot('13b-outpost-b');
  await p.evaluate(() => TSS.setZ(0.18)); await dev({ op: 'ship', v: { x: 0, y: 0 } }); await sleep(900); await shot('13c-twin-outposts-wide'); await p.evaluate(() => TSS.setZ(0.6));
  // strafe flames
  await dev({ op: 'clear' }); await p.keyboard.down('x'); await sleep(900); await shot('14-strafe-thrusters'); await p.keyboard.up('x');
  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors');
  // mobile / touch layout
  const m = await b.newPage(); await m.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); m.on('pageerror', e => errs.push(String(e)));
  await m.goto(URL + '?room=TM' + Math.floor(Math.random() * 900 + 100), { waitUntil: 'load' }); await sleep(600); await m.type('#name', 'Tou'); await m.click('#prefroles [data-r="0"]'); await m.click('#go'); await sleep(1500);
  await m.screenshot({ path: `${OUT}/v8-15-lobby-mobile.png` });
  await b.close(); process.exit(ok && !errs.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
