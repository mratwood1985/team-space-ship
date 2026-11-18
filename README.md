# TEAM SPACE SHIP

Co-op, real-time browser game. One ship, six stations (Pilot, Port/Starboard Gunners, Shields, Engineer, Repair). Bots crew every empty seat, so the public ship is always running and joinable. Desktop (mouse + keys) and phone (touch) controls.

Live: https://team-space-ship-git.onrender.com (deploys from `main`)

## Run locally
```
npm install
npm start          # http://localhost:8080 (PORT env var overrides)
npm test           # websocket integration test against localhost:8080
```

## Links
- `/` public ship · `/?room=CODE` private ship · `/new` fresh private code
- `/health`, `/rooms` status JSON

## Files
- `server.js`: server-authoritative sim (30 Hz, 15 Hz snapshots), bots, missions, rooms, websocket + static server
- `public/defs.js`: shared game data (roles, skill pyramids, abilities, ship geometry per Mk, ports, enemies, missions, planet kinds), loaded by server and client
- `public/game.js`, `public/index.html`: Canvas 2D client, procedural art (ships, enemies, noise-lit planets), WebAudio SFX/music, HUD, touch controls
- `test/ws-test.js`: integration test (`npm test`; run the server with `DEV_TOOLS=1` to also exercise purchases, ports, Mk upgrades and spawned enemies)
- `test/shot-v3.js`: staged headless screenshots (ship tiers, shield arc, pyramid, docks, planets); `test/shot-flow.js`: play-through screenshots incl. mobile (need Chrome + puppeteer-core)

## What is new in v4 (update number 3)
- **Repair rework**: the Repair player gets a big side panel with the health of the ship and every port. Click a damaged port to start it: it then repairs **automatically**; each station/port type has its own **minigame** (cockpit signal trace, turret bolt sequence, engine fuel pressure, deflector frequency lock, hull seam weld, extra-port wire patch) worth up to +100% speed. **Disabling the drone (G or the panel button) repairs 50% faster**, the panel says so. The drone is out by default, also while the ship is damaged.
- **The Repair Bay is repaired by everyone else**: the Repair player can not fix it, and while it is destroyed they can neither repair ports nor use the drone. All other players see a red alert and a big **CLICK RAPIDLY** button (Space works too). One clicker is slow; the whole crew clicking is normal speed. Players with a destroyed station can still help, and bots in empty seats help slowly. The alert vanishes when it is fixed and comes back if it is destroyed again.
- **Enemy fire**: bullets and lasers fly in one straight line from where they were fired (the client no longer smooths them); homing rockets are unchanged. Enemy bullet damage is 40% lower on levels 1-5 and full from level 6; players get a notice (and star-map cards show it).
- **Upgrades say what they change** with numbers, current -> next, including the limitless upgrades, big purchases and port levels.
- Bigger mission maps (arena 3200 -> 4200, farther jumps, pods and stations), wider field of view, and more graphical detail (hull panel seams/rivets/lights, richer explosions, planet surface detail, beveled HUD bars).

## What is new in v3 (update number 2)
- **Pace**: much tougher enemies (health scales with level), shielded ships (violet bubble: break it first), slower ships, shots and fire rates; income and costs rebalanced so a skill pyramid takes many missions. Mk II costs 10 cores, Mk III 22; after Mk III spare cores convert to credits (15 each per crew member).
- **Skill pyramids**: every role's tree is an inverted pyramid of 6/5/4/3/2 nodes. Pick one node per row; the next row only offers the nodes touching the previous pick (edge pick = 1 choice, middle pick = 2). Edge nodes are ~25% stronger, the last row is the strongest. Shown in the upgrade screen (U).
- **Ports are real hull sections**: Mk II / Mk III add one / two sockets per station and the ship grows. A port choice is permanent; each port (and each gunner turret) has its own upgrade levels and can be destroyed separately (small fire, benefits lost) and repaired by the Repair crew.
- **Shield**: blue only; starts as a 15° arc (+5° per upgrade, max 90°); aimed in world space by the shield player, so turning the ship does not rotate it; blocks every enemy shot until its HP is gone, then 20 s to recharge. Lance / Nova Lance fire the shield as a weapon (then 20 s recharge).
- **Enemies**: warden, lancer, swarm, shield corvette, missile cruiser, carrier, dreadnought plus beefed-up frigate / destroyer / station. Large ships carry shipping docks that keep launching fighters (more docks on bigger ships) until destroyed. Enemy missiles glow green, player missiles red.
- **Bigger view**, 12 planet kinds drawn with lit fractal noise, a distinct hull for Mk I / II / III.

## Controls
Common: Q/E/R abilities (picked in the skill pyramid, U), Tab switch role, H help, M mute, N music. Station destroyed? The Repair player clicks it to repair it. Repair Bay destroyed? Everybody else mashes CLICK RAPIDLY.
- Pilot: aim to steer, click nose laser. Q Barrel Roll (built in), E/R from the pyramid (Lock-On Volley, Battle Cry, Flare Burst, Strafing Run, Rally Point)
- Gunners: aim + click, each gunner fires their own turret and port turrets. Q Rapid Fire, then Flak Screen, Overcharge, Target Paint, Barrage, Deadeye, Suppressive Fire
- Engineer: W/S throttle (only the engineer controls speed), 1/2/3 power pips, 4 reset. Q Reroute Power, then Afterburner, Proton Bomb, Micro-Jump, Seismic Charge, Power Surge
- Shields: aim the arc (it stays where you point it). Q Fortify, then Barrier Bubble, Shield Lance, Energy Vent, Aegis Link, Nova Lance, Emergency Reboot
- Repair: click a damaged port in the side panel (or 1-6 / 0 = hull) to start the automatic repair, play its minigame for a bonus, G toggles the drone (off = +50% repair). Q Spot Weld, then Nano Swarm, Drone Overdrive, Stim Shot, Restoration, Drone Swarm, Field Medic

## Deploy (Render, free web service)
Build `npm install`, start `npm start`, health check `/health`. Player profiles are saved to `data/` (ephemeral on Render free).

Updates: push to `main`, then trigger a manual deploy on Render (auto-deploy needs the Render GitHub app connected, which the public-repo service does not have). `DEV_TOOLS=1` enables test-only staging commands: never set it in production.
