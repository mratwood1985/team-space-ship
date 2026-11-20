// v10 screenshots: repair panel with damaged/destroyed ports + hull fire, engineer reroute labels, Energy Siphon upgrade.
//   node test/shot-v10.js http://localhost:8091/ /workspace/spaceship-game/screens
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [], p = await b.newPage(); await p.setViewport({ width: 1366, height: 800 });
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
  const shot = async n => { await p.evaluate(() => { const bn = document.getElementById('banner'); if (bn) bn.style.opacity = 0; const t = document.getElementById('toasts'); if (t) t.innerHTML = ''; const c = document.getElementById('card'); if (c) c.classList.add('hide'); const cm = document.getElementById('comm'); if (cm) cm.classList.add('hide'); }); await p.screenshot({ path: `${OUT}/v10-${n}.png` }); console.log('shot', n); };
  const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  const send = o => p.evaluate(o => TSS.send(o), o);
  const closeOv = async () => { if (await p.evaluate(() => !document.getElementById('menu').classList.contains('hide'))) { await p.keyboard.press('Escape'); await sleep(250); } };
  await p.goto(URL + '?room=V10S' + Math.floor(Math.random() * 900), { waitUntil: 'load' });
  await p.waitForSelector('#prefroles [data-r="2"]', { timeout: 8000 });
  await p.type('#name', 'Atwood'); await p.click('#prefroles [data-r="2"]'); await p.click('#go'); await sleep(1800);
  await send({ t: 'start' }); await sleep(5200); await p.keyboard.press('Escape'); await sleep(400); await closeOv();
  await dev({ op: 'give', cr: 9000, cores: 9 }); await dev({ op: 'setmk', mk: 3 }); await sleep(400);
  await dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 4, kind: 'side', mod: 'none', ch: 0, pre: 0 } }); await sleep(1800); await closeOv();
  await dev({ op: 'ship', v: { inv: 999, hull: 36, x: 0, y: 0, a: 0 } }); await dev({ op: 'clear' });
  // destroy / damage a mix of stations and extra ports (6=pilot port 1, 10=repair port 1, 12=eng port 1, 18=pilot elite, 1=starboard gun)
  await dev({ op: 'hurt', k: [1, 6, 12, 18] });
  await sleep(400);
  await p.evaluate(() => {
    TSS.setZ(0.7);
    const w = document.getElementById('stuntxt'); if (w) w.style.opacity = 0;
  });
  await sleep(500);
  await p.evaluate(() => {
    const list = document.getElementById('hlist'), pan = document.getElementById('repp');
    if (list) { list.style.maxHeight = '430px'; list.scrollTop = 0; }
    if (pan) pan.style.maxHeight = '92vh';
  });
  await sleep(400);
  const bars = await p.evaluate(() => [...document.querySelectorAll('#hlist .hr')].map(r => r.className + '|' + r.innerText.replace(/\s+/g, ' ').trim() + '|w=' + (r.querySelector('.hb i') && r.querySelector('.hb i').style.width)).filter(x => /DOWN|Wing|Starboard|Mine|elite/.test(x)));
  console.log('bars', bars);
  const panel = await p.evaluate(() => { const e = document.getElementById('repp'); return e && !e.classList.contains('hide') && /DOWN/.test(e.innerText); });
  check(panel, 'repair panel is open and lists a DOWN port');
  await shot('01-repair-panel-destroyed-ports');
  // zoomed hull fire
  await p.evaluate(() => TSS.setZ(1.15)); await sleep(500); await shot('02-port-fire-on-hull');
  await p.evaluate(() => TSS.setZ(0.7));

  // engineer labels
  await send({ t: 'role', role: 3 }); await sleep(800);
  await p.evaluate(() => { const c = document.getElementById('card'); if (c) c.click(); });
  for (let i = 0; i < 4; i++) await send({ t: 'i', ax: 0, ay: 0, a: ['u1'], thr: 0.4 });
  for (let i = 0; i < 4; i++) await send({ t: 'i', ax: 0, ay: 0, a: ['u3'], thr: 0.4 });
  await sleep(1000);
  const lab = await p.evaluate(() => [...document.querySelectorAll('#rrrows .rrd')].map(e => e.textContent));
  check(lab[0] && /turn rate/.test(lab[0]), 'engine label: ' + lab[0]);
  check(lab[2] && /20s reboot/.test(lab[2]) && /ion recharge/.test(lab[2]), 'shield label: ' + lab[2]);
  await shot('03-engineer-reroute-labels');

  // shield Energy Siphon
  await send({ t: 'role', role: 4 }); await sleep(800);
  await p.evaluate(() => { const c = document.getElementById('card'); if (c) c.click(); });
  if (await p.evaluate(() => document.getElementById('upp').classList.contains('hide'))) { await p.keyboard.press('u'); await sleep(500); }
  await p.evaluate(() => {
    const u = document.getElementById('upp');
    const h = [...u.querySelectorAll('button, .nd, h4, .row')].find(x => /Energy Siphon/.test(x.textContent || ''));
    if (h) u.scrollTop += h.getBoundingClientRect().top - u.getBoundingClientRect().top - 80;
  });
  await sleep(400);
  const seen = await p.evaluate(() => /Energy Siphon/.test(document.getElementById('upp').innerText));
  check(seen, 'Energy Siphon is visible on the shield upgrade screen');
  await shot('04-shield-energy-siphon');

  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors');
  if (errs.length) ok = false;
  await b.close(); console.log(ok ? 'SHOTS OK' : 'SHOTS HAD FAILURES');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
