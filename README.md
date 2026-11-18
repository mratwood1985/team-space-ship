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

## What is new in v6 (update number 5)
- **Repair drones**: click the map to send them to a spot (they hold it for 10 s, fire from there and grab loot nearby, max 1800 px away); right-click or G returns them to auto. Separation steering plus a hard 34 px minimum distance: they never overlap. Damage 2.6 -> 1.7 dps, speed 340 -> 255 px/s, base HP 5.
- **Engineer**: Energy grid panel now bottom-right. Drain per slot is `2.0/s x [0,1,1.14,1.35,1.65,2.05,2.6,3.3,4.2,5.4,7.0]` (10 slots = 14/s, was 8/s). Each shield slot = +10% recharge, **+10% max shield HP, -3.5% damage taken** (10 slots: 2x HP, -35% damage).
- **Missiles/rockets** brighter with a flickering flame (enemy green, player red). **Starboard gunner bolts red, port gunner bolts orange.**
- **A / S / D** are the ability keys. Engineer throttle moved to Up/Down arrows + wheel. No role has a key clash.
- **Port upgrades are per-port**: 2-4 specific options per port (e.g. twin: Heavy Slugs / Piercing / Extra Barrel; rockets: Warheads / Quick Loader / Seeker Heads; aux: Reactor Boost / Capacitors / Efficient Routing; ...), 5 levels each, cost 60 + 40 x levels bought on that port. Section HP is one option. Generic "Port effect" removed.
- **Gunner ports: 5 options** incl. new **Sniper Turret** (2.6 s cooldown, 1900 px/s bright shot, ~3.4x turret damage, pierce) and a plain **Laser Cannon** (same as the starting cannon).
- **Kamikaze Bomb Ship** from level 6: flashing arming ring (1.15 s), then a 3.4x dash; explodes for 3.2 hull + 1.6 HP to every section within 105 px; a shield facing it absorbs it.
- **Missions past level 10**: new Last Stand (survival timer), Kamikaze Swarm, Twin Fortress Siege, plus extended forms of pirates, flagship, defend, escort, hostages and passengers.
- Tests: `test/v6-test.js` (needs `DEV_TOOLS=1`), `test/botrun-v6.js` (bot soak), `test/shot-v6.js` (screenshots).

## What is new in v5 (update number 4)
- **Engineer power rerouting**: a big panel with 4 options (Engines, Weapons, Shields, Repair), 10 levels each but only **10 slots in total**. Keys 1-4 add a slot, Shift+1-4 remove one, C clears. Each slot gives +1.5% top speed and +8% throttle response / +5% gun fire rate / +10% shield recharge speed / +3% repair speed. Ship energy (start 100) is used only for rerouting: the generator (2.0/s) covers exactly 1 slot, 2 slots drain 0.16/s net, 10 slots drain 8.0/s (generator cap is 6.0/s). Generator upgrades only lengthen how long high levels last. At 0 energy: 20 s lockout, engine thrust capped at 25%, rerouting offline, then energy is full again.
- **Proton Bomb** is the Engineer's innate Q ability from the start: 12 s own cooldown, never uses energy; upgrades add fuses, twin bombs, radius, damage.
- **Repair drone** is a little starship that flies itself: short-range teal laser beam, picks up credits and items, 5 HP (was 3). The Repair player can still recall/launch it (G); recalled = +50% repair speed.
- **Repair port switching fixed**: clicking another port or the hull switches immediately, even mid-repair or mid-minigame (rows are no longer rebuilt under the cursor, no pointer capture, no toggle-off).
- **Credit chips** are much brighter. **Money x1.1** on every payout.
- **Defend missions**: the station has 170+40/level HP (was 90+22) and 4 guns.
- **Enemies only spawn from docks or the map edges** (and run in from the edge); never mid-field.
- **New mission: Passenger Run**: an 8000x1280 corridor full of asteroids with a few enemy ships; fly to the far end, pick up the passengers, bring them back to the start. On the star map and in the main campaign sequence.
- Tests: `test/v5-test.js` (needs `DEV_TOOLS=1`), `test/shot-v5.js` (screenshots).

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
Common: **A / S / D** abilities (were Q/E/R; slot 1/2/3) (picked in the skill pyramid, U), Tab switch role, H help, M mute, N music. Station destroyed? The Repair player clicks it to repair it. Repair Bay destroyed? Everybody else mashes CLICK RAPIDLY.
- Pilot: aim to steer, click nose laser. A Barrel Roll (built in), S/D from the pyramid (Lock-On Volley, Battle Cry, Flare Burst, Strafing Run, Rally Point)
- Gunners: aim + click, each gunner fires their own turret and port turrets. A Rapid Fire, then Flak Screen, Overcharge, Target Paint, Barrage, Deadeye, Suppressive Fire
- Engineer: Up/Down arrows or mouse wheel = throttle (only the engineer controls speed; W/S moved so A/S/D are free), 1-4 add a rerouting slot (Shift removes, C clears). A Proton Bomb, then Afterburner, Micro-Jump, Seismic Charge, Power Surge
- Shields: aim the arc (it stays where you point it). A Fortify, then Barrier Bubble, Shield Lance, Energy Vent, Aegis Link, Nova Lance, Emergency Reboot
- Repair: click a damaged port in the side panel (or 1-6 / 0 = hull) to start the automatic repair, **click anywhere on the map to send the drones there** (right-click = back to auto, they never overlap), play its minigame for a bonus, G recalls/launches the self-flying drone (recalled = +50% repair). A Spot Weld, then Nano Swarm, Drone Overdrive, Stim Shot, Restoration, Drone Swarm, Field Medic

## Deploy (Render, free web service)
Build `npm install`, start `npm start`, health check `/health`. Player profiles are saved to `data/` (ephemeral on Render free).

Updates: push to `main`, then trigger a manual deploy on Render (auto-deploy needs the Render GitHub app connected, which the public-repo service does not have). `DEV_TOOLS=1` enables test-only staging commands: never set it in production.
