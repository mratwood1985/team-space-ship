// v9 screenshots: ship browser, star-map vote / waiting list, restart vote, radiation effect, pilot strafe hint, engineer throttle tip, gunner ports + Port 3 Double Barrel, ready screen.
//   node test/shot-v9.js http://localhost:8091/ /workspace/spaceship-game/screens   (needs DEV_TOOLS=1)
const puppeteer = require('puppeteer-core'), WebSocket = require('ws');
const URL = process.argv[2] || 'http://localhost:8091/', OUT = process.argv[3] || 'screens';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
function wsc(room, name, role, auto = 1) {
  return new Promise(res => { const ws = new WebSocket(URL.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'), c = { ws, last: null, me: null }; c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'shot-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 's') { c.last = m; if (auto && m.ph === 'intro' && !c._r) { c._r = 1; c.send({ t: 'ready' }); } } }); });
}
(async () => {
  // a few ships flying so the browser has something to list
  const x1 = await wsc('ALPHA', 'Rook', 0), x2 = await wsc('ALPHA', 'Vex', 3), x3 = await wsc('', 'Nova', 4);
  x1.send({ t: 'dev', op: 'mission', i: 0 }); await sleep(400);
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [], ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()), p = await ctx.newPage(); await p.setViewport({ width: 1366, height: 800 });
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
  const shot = async n => { await p.evaluate(() => { const bn = document.getElementById('banner'); if (bn) bn.style.opacity = 0; }); await p.screenshot({ path: `${OUT}/v9-${n}.png` }); console.log('shot', n); };
  const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
  await p.goto(URL, { waitUntil: 'load' }); await p.type('#name', 'Atwood'); await p.click('#prefroles [data-r="0"]'); await p.click('#go'); await sleep(1500);
  const rows = await p.evaluate(() => document.querySelectorAll('#brlist .brr').length); check(rows >= 2, `ship browser lists ${rows} ships`); await shot('01-ship-browser');
  await p.click('#brnew'); await sleep(1500); const code = await p.evaluate(() => TSS.me.code); check(/^[A-Z0-9]{5}$/.test(code) && await p.evaluate(() => TSS.snap.ph === 'lobby'), 'Create new ship -> character lobby of ship ' + code);
  await shot('02-new-ship-lobby');
  const bob = await wsc(code, 'Bob', 5); await sleep(800);
  await dev({ op: 'give', cr: 9000, cores: 9 }); await sleep(300);
  for (let i = 0; i < 4; i++) { await p.evaluate(() => TSS.send({ t: 'buy', tree: 'pilot', kind: 'inf', id: 'i_strafe' })); await sleep(150); }
  await p.evaluate(() => TSS.send({ t: 'start' })); await sleep(5200); await p.keyboard.press('Escape'); await sleep(400); await p.keyboard.press('Escape'); await sleep(1500);
  if (await p.evaluate(() => !document.getElementById('menu').classList.contains('hide'))) { await p.keyboard.press('Escape'); await sleep(300); }
  const ph = await p.evaluate(() => TSS.snap.ph); check(ph === 'map', 'after the briefing: star map (' + ph + ')');
  const o = await p.evaluate(() => TSS.snap.opts.map(o => o.id)); bob.send({ t: 'vote', id: o[1] }); await sleep(700);
  await shot('03-star-map-waiting-vote');
  bob.send({ t: 'restart' }); await sleep(900); check(await p.evaluate(() => !document.getElementById('rvote').classList.contains('hide')), 'restart vote banner shows Yes / No'); await shot('04-restart-vote');
  await p.click('#rvote [data-rv="0"]'); await sleep(700); check(await p.evaluate(() => document.getElementById('rvote').classList.contains('hide') && TSS.snap.ph === 'map'), 'voted No -> vote failed, still on the star map');
  // radiation zone
  await dev({ op: 'mission', i: 0, over: { type: 'pirates', level: 4, kind: 'side', mod: 'rad', ch: 0, pre: 0 } }); await sleep(1800); await p.keyboard.press('Escape'); await sleep(300);
  if (await p.evaluate(() => !document.getElementById('menu').classList.contains('hide'))) { await p.keyboard.press('Escape'); await sleep(300); }
  await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, hull: 999 } }); await sleep(500);
  const zn = await p.evaluate(() => (TSS.snap.zn || []).filter(z => z[0] === 0)); check(zn.length > 0, 'rad zones in the mission: ' + zn.length);
  if (zn.length) { const z = zn[0]; await dev({ op: 'ship', v: { x: z[1] - z[3] * 0.55, y: z[2], a: 0 } }); await p.evaluate(() => TSS.setZ(0.42)); await sleep(1600); await shot('05-radiation-zone'); await p.evaluate(() => TSS.setZ(0.75)); await sleep(1200); await shot('05b-radiation-inside'); }
  await dev({ op: 'ship', v: { x: 0, y: 0 } }); await p.evaluate(() => TSS.setZ(0.6)); await p.keyboard.down('z'); await sleep(900);
  const hint = await p.evaluate(() => { const e = document.getElementById('strafeh'); return e && e.textContent; }); check(/Z \/ X/.test(hint || '') && /Lv 4/.test(hint || ''), 'pilot strafe hint: ' + hint); await shot('06-pilot-strafe-hint'); await p.keyboard.up('z');
  // engineer
  await p.evaluate(() => TSS.send({ t: 'role', role: 3 })); await sleep(800); for (let i = 0; i < 12; i++) { await p.keyboard.press('ArrowUp'); await sleep(60); } await p.evaluate(() => document.getElementById('card').click()); await sleep(2900);
  const ti = await p.evaluate(() => document.getElementById('thrinfo').textContent); check(/drains reroute power/.test(ti), 'engineer throttle label: ' + ti); await shot('07-engineer-throttle-tip');
  // gunner ports (upgrade screen) + ready list
  await p.evaluate(() => TSS.send({ t: 'role', role: 1 })); await sleep(600); await dev({ op: 'setmk', mk: 3 }); for (const sl of [0, 1, 2]) await dev({ op: 'noport', r: 1, sl }); await dev({ op: 'phase', ph: 'upgrade' }); await sleep(1200);
  if (await p.evaluate(() => document.getElementById('upp').classList.contains('hide'))) { await p.keyboard.press('u'); await sleep(500); }
  await p.evaluate(() => { const h = [...document.querySelectorAll('#upp h4')].find(x => /^Ship ports/.test(x.textContent)), u = document.getElementById('upp'); if (h) u.scrollTop += h.getBoundingClientRect().top - u.getBoundingClientRect().top - 8; }); await sleep(300);
  const nOpt = await p.evaluate(() => document.querySelectorAll('#upp [data-port]').length); check(nOpt === 15, `gunner sees ${nOpt} port buttons (5 guns x 3 slots)`); await shot('08-gunner-port-options');
  await p.evaluate(() => TSS.send({ t: 'buy', kind: 'port', slot: 2, id: 'flak' })); await sleep(700); await p.evaluate(() => { const h = [...document.querySelectorAll('#upp h4')].find(x => /^Ship ports/.test(x.textContent)), u = document.getElementById('upp'); if (h) u.scrollTop += h.getBoundingClientRect().top - u.getBoundingClientRect().top - 8; }); await sleep(300);
  const dbl = await p.evaluate(() => !!document.querySelector('#upp [data-opt="dbl"]')); check(dbl, 'Port 3 Flak offers the Double Barrel upgrade'); await shot('09-gunner-port3-double-barrel');
  await p.evaluate(() => { const r = document.getElementById('rdy'); if (r) r.click(); }); await sleep(800); await p.evaluate(() => { const u = document.getElementById('upp'); u.scrollTop = u.scrollHeight; }); await sleep(300);
  const st = await p.evaluate(() => document.getElementById('upst').textContent); check(/waiting for Bob/.test(st) && /No timer/.test(st), 'ready footer: ' + st); await shot('10-ready-waiting');
  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors'); if (errs.length) ok = false;
  for (const c of [x1, x2, x3, bob]) c.ws.close(); await b.close(); console.log(ok ? 'SHOTS OK' : 'SHOTS HAD FAILURES'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
