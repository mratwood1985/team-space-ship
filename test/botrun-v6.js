// v6 bot soak: one idle human, five bots, new missions at level 10+, sniper + laser ports on the gunners. Prints how it goes; fails if the server dies or errors.
const WebSocket = require('ws');
const BASE = process.argv[2] || 'http://localhost:8091', TYPE = process.argv[3] || 'bombrun', SECS = +process.argv[4] || 60;
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws'); let last, evs = {}, started = 0; const send = o => ws.send(JSON.stringify(o)); const sleep = ms => new Promise(r => setTimeout(r, ms));
ws.on('open', () => send({ t: 'join', name: 'Idle', cid: 'bot' + Date.now(), room: 'BOT' + (Date.now() % 10000), role: 4 }));
ws.on('message', d => { const m = JSON.parse(d); if (m.t === 's') { last = m; for (const e of m.ev || []) evs[e[0]] = (evs[e[0]] || 0) + 1; } if (m.t === 'me' && !started) { started = 1; go(); } });
async function go() {
  const dev = o => send(Object.assign({ t: 'dev' }, o));
  dev({ op: 'setmk', mk: 2 }); dev({ op: 'port', r: 5, sl: 0, id: 'sniper', lv: 0 }); dev({ op: 'port', r: 5, sl: 1, id: 'laser', lv: 0 }); dev({ op: 'port', r: 2, sl: 0, id: 'drone2', lv: 0 });
  await sleep(500); dev({ op: 'mission', i: 0, over: { type: TYPE, level: 10 } });
  for (let i = 0; i < SECS / 5; i++) { await sleep(5000); const s = last.sh; console.log(TYPE, (i + 1) * 5 + 's', 'ph', last.ph, 'hull', s.h, '/', s.hm, 'shp', s.shp, 'hostiles', last.mi && last.mi.left, 'wave', last.mi && last.mi.wave + '/' + last.mi.waves, 'kam', last.e.filter(e => e[1] === 18).length, 'types', JSON.stringify(last.e.map(e => e[1] + ':' + (e[2] | 0) + ',' + (e[3] | 0))), 'ship', s.x | 0, s.y | 0, 'drones', s.dr.filter(x => x).length, 'dg', JSON.stringify(s.dg)); if (last.ph !== 'mission') break; }
  console.log('events', JSON.stringify(evs)); const r = await fetch(BASE + '/health').then(r => r.json()); console.log('server alive', r.ok === 1); process.exit(r.ok === 1 ? 0 : 1);
}
