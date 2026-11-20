// v7.1 voice test (needs DEV_TOOLS=1 + Chrome): prerecorded clips are fetched + played through WebAudio; speechSynthesis is only the fallback.
//   node test/voice-test.js http://localhost:8091/
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path');
const URL = process.argv[2] || 'http://localhost:8091/'; const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = require('../public/defs.js'), ST = require('../public/story.js');
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
(async () => {
  // ---- static: every id the manifest lists exists, total size, client ids resolve
  const man = JSON.parse(require('child_process').execSync('node ' + path.join(__dirname, '../tools/voice-manifest.js')).toString()), dir = path.join(__dirname, '../public/voice');
  const miss = man.filter(c => !fs.existsSync(path.join(dir, c.id + '.mp3'))); const total = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
  check(!miss.length, `${man.length} voiced lines, all clips present` + (miss.length ? ' (missing ' + miss.slice(0, 5).map(m => m.id) + ')' : ''));
  check(total < 1.9e6, `clips total ${(total / 1024).toFixed(0)} KB (< 1.9 MB; v9 added variants)`);
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  check(['half', 'low'].every(k => ST.FINN_VAR[k].length >= 3 && ST.FINN_VAR[k].every((_, i) => fs.existsSync(path.join(dir, 'finn_' + k + '_' + i + '.mp3')))) && ST.CARE_VAR.every((_, i) => fs.existsSync(path.join(dir, 'cat_care_' + i + '.mp3'))) && fs.existsSync(path.join(dir, 'mort_thr.mp3')) && !D.PORT_NAMES.some(n => fs.existsSync(path.join(dir, 'finn_' + slug(n) + '.mp3'))), 'v9: Finn hull 50% / critical calls have 3-4 voiced variants each, care package 3, throttle tip voiced; v8: Finn keeps only the hull calls (no spoken "port destroyed" clips any more)');
  check(['rad', 'cold', 'well'].every(k => fs.existsSync(path.join(dir, 'pz_' + k + '.mp3'))) && ST.INTRO.every((_, i) => fs.existsSync(path.join(dir, ST.csId('intro', 'i', i) + '.mp3'))), 'v8: the pilot hazard briefings and the arrival cutscene lines are voiced');
  check(ST.TAUNTS.every((_, i) => fs.existsSync(path.join(dir, 'vt' + i + '.mp3'))) && ST.SENDS.every((_, i) => fs.existsSync(path.join(dir, 'vs' + i + '.mp3'))) && ['open', 'p2', 'p3', 'kill'].every(k => fs.existsSync(path.join(dir, 'vb_' + k + '.mp3'))), 'Szarkath: every taunt, reinforcement line and boss line');
  check(['kraal', 'durmok', 'grakk', 'sskarra'].every(w => fs.existsSync(path.join(dir, 'ci_' + w + '.mp3')) && fs.existsSync(path.join(dir, 'cd_' + w + '.mp3'))) && ST.CMD_INTRO.every((_, i) => fs.existsSync(path.join(dir, 'ci_lt' + i + '.mp3'))) && ST.CMD_DEATH.every((_, i) => fs.existsSync(path.join(dir, 'cd_lt' + i + '.mp3'))), 'commanders: own intro + death line each, lieutenants have a full set');
  const short = ST.csLines().filter(l => l[2].length <= ST.VOICE_MAX); check(short.length > 30 && short.every(l => fs.existsSync(path.join(dir, l[0] + '.mp3'))), `${short.length} short cutscene lines voiced by the crew / cats / commanders (long ones stay text-only)`);
  check(['skids', 'boomer', 'finn', 'mort', 'ophelia', 'ember', 'tavi', 'ishkara', 'szarkath'].every(w => man.some(c => c.who === w)), 'every in-mission and short-cutscene speaker has a voice');
  const mime = (await fetch(URL + 'voice/finn_half_0.mp3')); check(mime.ok && /audio\/mpeg/.test(mime.headers.get('content-type')), 'server serves clips as audio/mpeg');
  // ---- browser
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  async function run(block) {
    const ctx = await (b.createBrowserContext ? b.createBrowserContext() : b.createIncognitoBrowserContext()), p = await ctx.newPage(); await p.setViewport({ width: 1200, height: 760 });
    const reqs = []; await p.setRequestInterception(true); p.on('request', r => { if (/\/voice\/.*\.mp3/.test(r.url())) { reqs.push(r.url().split('/').pop()); if (block) return r.abort(); } r.continue(); });
    await p.evaluateOnNewDocument(() => { window.__plays = 0; window.__speaks = []; const dd = BaseAudioContext.prototype.decodeAudioData; BaseAudioContext.prototype.decodeAudioData = function (ab, ok, no) { return dd.call(this, ab, buf => { buf.__voice = 1; ok && ok(buf); }, no); }; const st = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.__voice) window.__plays++; return st.apply(this, a); }; const sp = window.speechSynthesis && speechSynthesis.speak; if (sp) speechSynthesis.speak = function (u) { window.__speaks.push([u.text, u.pitch, u.rate]); }; });
    await p.goto(URL + '?room=VO' + Math.floor(Math.random() * 9000), { waitUntil: 'load' }); await p.type('#name', 'Finn'); await p.click('#prefroles [data-r="2"]'); await p.click('#go'); await sleep(1500); await p.evaluate(() => TSS.send({ t: 'start' })); await sleep(5000); await p.evaluate(() => TSS.send({ t: 'ready' })); await sleep(800); await p.keyboard.press('Escape');
    const dev = o => p.evaluate(o => TSS.send(Object.assign({ t: 'dev' }, o)), o);
    await dev({ op: 'mission', i: 0, over: { type: 'defend', level: 6, kind: 'main', ch: 6, title: 'x', pre: 0 } }); await sleep(1500); await p.keyboard.press('Escape');
    await dev({ op: 'mset', v: { trickle: 1e9, vT: 0.05 } }); await dev({ op: 'clear' }); await dev({ op: 'ship', v: { inv: 999, hull: 999 } }); await sleep(2500);
    await dev({ op: 'hurt', k: [1] }); await sleep(4500);            // port/section destroyed -> Finn
    await dev({ op: 'ship', v: { hull: 30 } }); await sleep(4500);      // below 50% -> Finn
    const r = await p.evaluate(() => ({ plays: window.__plays, speaks: window.__speaks })); await ctx.close(); return { r, reqs };
  }
  const a = await run(false);
  check(a.reqs.some(f => /^finn_/.test(f)) && a.reqs.some(f => /^vt\d/.test(f)), 'clips were lazy-loaded on demand (' + [...new Set(a.reqs)].slice(0, 6).join(', ') + ')');
  check(a.r.plays >= 2, `${a.r.plays} clip plays through WebAudio`); check(a.r.speaks.length === 0, 'speechSynthesis not used when clips are available');
  const f = await run(true);
  check(f.r.plays === 0 && f.r.speaks.length >= 1 && f.r.speaks.every(s => s[1] === 1 && s[2] === 1), `clips blocked -> speechSynthesis fallback (${f.r.speaks.length} utterances, pitch 1, rate 1)`);
  await b.close(); console.log(ok ? 'VOICE TESTS PASSED' : 'VOICE TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
