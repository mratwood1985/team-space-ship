// HUD portrait screenshots (needs DEV_TOOLS=1 + Chrome): node test/shot-hud.js http://localhost:8091/ /workspace/spaceship-game/screens
const puppeteer = require('puppeteer-core'); const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens'; const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const [name, w, h, touch, role] of [['v7-1-hud-portrait', 1366, 800, 0, 2], ['v7-1-hud-portrait-mobile', 430, 900, 1, 0], ['v7-1-hud-portrait-landscape', 844, 390, 1, 4], ['v7-1-hud-portrait-desktop-small', 1024, 600, 0, 3]]) {
    const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()), p = await ctx.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: touch ? 2 : 1, hasTouch: !!touch, isMobile: !!touch });
    await p.goto(URL + '?room=HP' + Math.floor(Math.random() * 9000), { waitUntil: 'load' }); await p.type('#name', 'Tester'); await p.click(`#prefroles [data-r="${role}"]`); await p.click('#go'); await sleep(1500); await p.keyboard.press('Escape');
    const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
    await dev({ op: 'mission', i: 0, over: { type: 'survival', level: 4, kind: 'main', ch: 0, title: 'x', pre: 0 } }); await sleep(1500); await dev({ op: 'mset', v: { trickle: 1e9 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999 } }); await sleep(1200);
    await p.evaluate(() => { document.getElementById('banner').style.opacity = 0; document.getElementById('toasts').innerHTML = ''; });
    await p.screenshot({ path: `${OUT}/${name}.png` }); await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
