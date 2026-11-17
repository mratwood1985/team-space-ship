// v3 headless play-through screenshots: intro, star map, gunner, engineer, repair, battle, upgrade screen, mobile. Reports page errors.
// Start the server with DEV_TOOLS=1 to let the script force the upgrade screen if the mission is still running.
const puppeteer = require('puppeteer-core');
const URL = process.argv[2] || 'http://localhost:8080/';
const OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const p = await b.newPage(); await p.setViewport({ width: 1366, height: 800 });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const room = 'SHOT' + Math.floor(Math.random() * 90 + 10);
  const t0 = Date.now(); await p.goto(URL + '?room=' + room, { waitUntil: 'load' }); console.log('page load ms', Date.now() - t0);
  await p.screenshot({ path: OUT + '/v3-flow-0-intro.png' });
  await p.type('#name', 'Atwood'); await p.click('[data-r="5"]'); await p.click('#go');
  await sleep(1500); await p.click('#card').catch(() => { });
  await p.waitForFunction(() => !document.getElementById('map').classList.contains('hide'), { timeout: 15000 });
  await sleep(1200); await p.screenshot({ path: OUT + '/v3-flow-1-starmap.png' });
  // vote for a mission with capital ships if offered
  const pickId = await p.evaluate(() => { const cards = [...document.querySelectorAll('.mc')]; const t = cards.find(c => /Station|Flagship/.test(c.innerText) && !/Defend/.test(c.innerText)) || cards[0]; t.click(); return t.innerText.split('\n').slice(0, 3).join(' '); });
  console.log('voted:', pickId);
  await p.waitForFunction(() => /Wave|hostiles|Pods|Freighters/.test(document.getElementById('mi').innerText), { timeout: 20000 });
  await sleep(2500);
  await p.mouse.move(300, 300); await p.mouse.down();
  for (let i = 0; i < 10; i++) { await p.mouse.move(250 + i * 25, 250 + (i % 3) * 80); await sleep(300); }
  await p.screenshot({ path: OUT + '/v3-flow-2-gunner.png' }); await p.mouse.up();
  // engineer
  await p.keyboard.press('Tab'); await sleep(300); await p.click('#rolesp [data-r="3"]'); await sleep(1200); await p.click('#card').catch(() => { });
  await p.keyboard.press('2'); await sleep(300); await p.keyboard.press('w'); await sleep(1500);
  await p.screenshot({ path: OUT + '/v3-flow-3-engineer.png' });
  // repair
  await p.keyboard.press('Tab'); await sleep(300); await p.click('#rolesp [data-r="2"]'); await sleep(1200); await p.click('#card').catch(() => { });
  await p.mouse.move(900, 300); await sleep(2500);
  await p.screenshot({ path: OUT + '/v3-flow-4-repair.png' });
  // fight on as pilot until the upgrade screen
  await p.keyboard.press('Tab'); await sleep(300); await p.click('#rolesp [data-r="0"]'); await sleep(800); await p.click('#card').catch(() => { });
  let shotBig = false;
  for (let i = 0; i < 90; i++) {
    const st = await p.evaluate(() => ({ up: !document.getElementById('upp').classList.contains('hide') && /READY/.test(document.getElementById('upp').innerText), mi: document.getElementById('mi').innerText }));
    if (st.up) break;
    await p.mouse.move(683 + Math.cos(i / 4) * 300, 400 + Math.sin(i / 4) * 250); if (i === 0) await p.mouse.down(); await sleep(400);
    if (!shotBig && i === 20) { await p.screenshot({ path: OUT + '/v3-flow-5-battle.png' }); shotBig = true; }
  }
  await p.mouse.up(); await sleep(800);
  if (!await p.evaluate(() => /READY/.test(document.getElementById('upp').innerText))) { await p.evaluate(() => { TSS.send({ t: 'dev', op: 'give', cr: 400, cores: 2 }); TSS.send({ t: 'dev', op: 'phase', ph: 'upgrade', secs: 60 }); }); await sleep(1200); }
  await p.screenshot({ path: OUT + '/v3-flow-6-upgrades.png' });
  const upText = await p.evaluate(() => document.getElementById('upp').innerText.slice(0, 300)); console.log('UPGRADE:', upText.replace(/\n/g, ' | '));
  // mobile
  const m = await b.newPage(); m.on('pageerror', e => errs.push('mobile: ' + e.message));
  await m.emulate({ viewport: { width: 400, height: 860, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  await m.goto(URL, { waitUntil: 'load' }); await m.click('[data-r="4"]'); await m.tap('#go');
  await sleep(2000); await m.tap('#card').catch(() => { });
  await m.waitForFunction(() => /Wave|hostiles|Pods|Freighters/.test(document.getElementById('mi').innerText), { timeout: 40000 }).catch(() => { });
  await sleep(4000); await m.screenshot({ path: OUT + '/v3-flow-7-mobile.png' });
  console.log('ERRORS:', errs.length ? errs : 'none');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
