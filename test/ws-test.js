// v2 WebSocket integration test: public + private rooms, bots, roles, weighted voting, full mission -> upgrade -> ready loop, abilities.
const WebSocket = require('ws');
const BASE = process.argv[2] || 'http://localhost:8080';
const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, role) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl); const c = { ws, me: null, snaps: 0, last: null, evs: {}, abs: [], phases: [], toasts: [] };
    c.send = o => ws.send(JSON.stringify(o));
    ws.on('open', () => c.send({ t: 'join', name, cid: 'test-' + name + Date.now(), room, role }));
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'me') { c.me = m; res(c); } if (m.t === 'toast') c.toasts.push(m.m); if (m.t === 's') { c.snaps++; c.last = m; if (c.phases[c.phases.length - 1] !== m.ph) c.phases.push(m.ph); for (const e of m.ev) { c.evs[e[0]] = (c.evs[e[0]] || 0) + 1; if (e[0] === 'ab') c.abs.push(e[2]); } } });
    ws.on('error', rej); setTimeout(() => rej(new Error('join timeout')), 8000);
  });
}
async function until(fn, ms) { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await sleep(200); } return false; }
(async () => {
  let ok = true; const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const t0 = Date.now(); const a = await client('', 'Alice', 0); check(a.me.role === 0 && a.me.pub, `public join as Pilot in ${Date.now() - t0}ms (room ${a.me.code})`);
  await sleep(2500);
  check(a.snaps > 25, `snapshots streaming: ${a.snaps} in 2.5s`);
  check(a.last.crew.filter(c => c[1]).length === 5, 'other 5 seats are bots: ' + a.last.crew.map(c => c[0] + (c[1] ? '(bot)' : '')).join(', '));
  check(a.last.crew.every(c => Array.isArray(c[5]) && c[5].length === 3), 'every crew entry carries 3 ability slots');
  a.send({ t: 'i', ax: a.last.sh.x + 1000, ay: a.last.sh.y, f: 1, idle: 1 });
  // private room, 3 humans: pilot vote weight = 2
  const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const b = await client(code, 'Bob', 0), c = await client(code, 'Cara', 0), d = await client(code, 'Dan', 4);
  check(b.me.code === code && b.me.role === 0, `private room ${code}: Bob is Pilot`);
  check(c.me.role !== 0 && c.me.role >= 0, `Cara got a different free seat (${c.me.role})`);
  c.send({ t: 'role', role: 3 }); await sleep(500); check(c.me.role === 3, 'Cara switched to Engineer (took a bot seat)');
  c.send({ t: 'role', role: 0 }); await sleep(400); check(c.me.role === 3, 'Cara cannot steal the human Pilot seat');
  await until(() => b.last && b.last.ph === 'map', 8000);
  check(b.last.ph === 'map' && b.last.opts.length === 5, `star map offers ${b.last.opts && b.last.opts.length} missions (1 main + 4 sides): ` + (b.last.opts || []).map(o => o.type + '/' + ['E', 'N', 'H', 'X'][o.diff] + '@' + o.planet.name).join(', '));
  check(b.last.pw === 2, `pilot vote weight with 3 players = ${b.last.pw}`);
  const opt = b.last.opts.find(o => o.type === 'pirates' || o.type === 'defend') || b.last.opts[0], other = b.last.opts.find(o => o !== opt);
  b.send({ t: 'vote', id: opt.id }); c.send({ t: 'vote', id: other.id }); await sleep(300);
  check(b.last.votes[opt.id] === 2 && b.last.votes[other.id] === 1, `weighted tally: pilot pick=${b.last.votes[opt.id]}, Cara's pick=${b.last.votes[other.id]}`);
  d.send({ t: 'vote', id: opt.id });
  await until(() => b.last.ph === 'mission', 4000);
  check(b.last.ph === 'mission' && b.last.mi.name === opt.planet.name, `all voted -> mission launched at ${b.last.mi && b.last.mi.name} (${b.last.mi && b.last.mi.type})`);
  for (const x of [b, c, d]) x.send({ t: 'i', ax: 0, ay: 0, idle: 1 }); // let bots fly our seats
  console.log('waiting for the mission to finish (bots flying idle seats)...');
  await until(() => b.last.ph === 'upgrade', 150000);
  check(b.phases.includes('result') && b.last.ph === 'upgrade', `mission ended -> upgrade screen (phases ${b.phases.join('>')}, result ${JSON.stringify(b.last.res)})`);
  check(b.me.cr > 0, `credits earned: Bob ${b.me.cr}, Cara ${c.me.cr}, Dan ${d.me.cr}`);
  check((b.evs.pick || 0) > 0, `credit chips picked up in mission: ${b.evs.pick}`);
  const cr0 = b.me.cr; b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: 'p_roll' }); await sleep(400);
  check(b.me.tr.pilot.n.p_roll === 1 && b.me.cr === cr0 - 12, `bought Barrel Roll (cr ${cr0} -> ${b.me.cr})`);
  b.send({ t: 'buy', tree: 'pilot', kind: 'node', id: 'p_ace' }); await sleep(300); check(!b.me.tr.pilot.n.p_ace, 'tier-5 node refused without prerequisites/Mk II');
  b.send({ t: 'buy', tree: 'pilot', kind: 'inf', id: 'i_turn' }); await sleep(300); check(b.me.tr.pilot.i.i_turn === 1, 'infinite upgrade bought');
  for (const x of [b, c, d]) x.send({ t: 'ready' });
  await until(() => b.last.ph === 'map', 3000); check(b.last.ph === 'map', 'everyone READY -> back to the star map early');
  for (const x of [b, c, d]) x.send({ t: 'vote', id: b.last.opts[0].id });
  await until(() => b.last.ph === 'mission', 4000);
  await sleep(1500); b.send({ t: 'i', ax: 0, ay: 0, idle: 0, a: ['q'] }); await sleep(800);
  check(b.abs.includes('roll'), `pilot used Q ability -> ${b.abs.join(',')}`);
  check(a.abs.length > 0 || c.abs.length > 0, `bots use abilities too: ${[...new Set(c.abs)].join(',')}`);
  check((a.evs.b || 0) > 20, `lasers fired (public): ${a.evs.b}`); check((a.evs.boom || 0) > 3, `explosions: ${a.evs.boom}`);
  console.log('private event counts:', JSON.stringify(b.evs));
  d.ws.close(); await sleep(800); check(c.last.crew[4][1] === 1, 'Dan left -> bot took the Shield seat');
  const h = await (await fetch(BASE + '/health')).json(); console.log('health', h); check(h.v === 2, 'health reports v2');
  a.ws.close(); b.ws.close(); c.ws.close();
  console.log(ok ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
