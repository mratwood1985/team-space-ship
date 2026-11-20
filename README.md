# Spacebelts Optional

*Six crew members. An unknown sector. Zero safety standards. Let's do this—what could possibly go wrong?*

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
- `public/story.js`: title, tagline, crew, races, commanders, villain, chapters, cutscene and comm lines (shared by server and client)
- `public/voice/`: 112 voice clips (see v7.1); `tools/`: voice manifest + generator
- `public/img/`: 13 WebP portraits (192x192, ~95 KB in total)
- `public/defs.js`: shared game data (roles, skill pyramids, abilities, ship geometry per Mk, ports, enemies, missions, planet kinds), loaded by server and client
- `public/game.js`, `public/index.html`: Canvas 2D client, procedural art (ships, enemies, noise-lit planets), WebAudio SFX/music, HUD, touch controls
- `test/ws-test.js`: integration test (`npm test`; run the server with `DEV_TOOLS=1` to also exercise purchases, ports, Mk upgrades and spawned enemies)
- `test/shot-v3.js`: staged headless screenshots (ship tiers, shield arc, pyramid, docks, planets); `test/shot-flow.js`: play-through screenshots incl. mobile (need Chrome + puppeteer-core)

## What is new in v10 (update number 9)
- **Ports can be destroyed again.** A v8 typo in `emerg()` called itself when a section hit 0 HP, which crashed the sim tick and left every port (stations and the v8/v9 extra ports) un-destroyable in combat. The Repair Bay still starts a repair when you click a damaged port; the per-port minigame and a recalled drone (+50%) still speed it up; other players still get **CLICK RAPIDLY** when the Repair Bay itself is down. Destroyed ports still show fire on the hull and health in the repair panel.
- **Engine reroute also turns the ship faster** (about +3% turn rate per engine slot). The engineer label now says so.
- **Shield reroute** already raised shield HP and regen and sped up the 20 s reboot; it now also shortens the ion bolt cooldown (about +6% per shield slot). The engineer label spells out HP, regen, the 20 s reboot and ion recharge.
- **Energy Siphon:** a new uncapped shield upgrade. Each level turns more of the lasers and ion bolts your shield blocks into energy for the engineer's reroute pool. A yellow "+N ⚡" popup appears on the block, and the engineer energy bar flashes.

## What is new in v9 (update number 8)
- **Fresh runs:** every new run (a new ship, or a restart) starts every player at **0 credits** with a blank skill pyramid. Reconnecting to the same running ship keeps your progress.
- **Ship browser:** LAUNCH opens a list of the ships flying right now (players, names, level, phase) with Join, **Create a new ship** and Join the public ship. Invite links (`?room=` / `?ship=`) skip it.
- **Every ship starts in the character lobby**, the public ship too.
- **Restart vote:** Menu → Restart Game starts a vote (instant if you are alone). The others get a Yes / No banner. A majority of the humans aboard sends everyone back to the lobby for a fresh run. The vote fails on a No majority or after 30 s.
- **Empty ships are removed:** when only bots are left, the ship freezes and is deleted after a 45 s grace period (`ROOM_GRACE_MS`), so the next start begins from scratch.
- **No timers between missions:** the star map launches only when every human has voted, and the upgrade bay moves on only when every human is Ready (bots are always ready). One vote each; a tie goes to the human pilot's pick.
- **Ports:** a third choice in every slot for the pilot (Needle Gun, Swarm Pod, Gyro Thrusters), engineer (Coolant Loop, EMP Projector, Flywheel Drive), shield (Regen Coil, Shield Pulse, Hardened Emitter) and repair (Regen Matrix, Scrap Collector, Reinforced Bulkheads). Gunners pick from the same 5 guns (Laser, Sniper, Rockets, Scatter, Flak) in every slot, repeats allowed. Port 3 guns can take **★ Double Barrel**, which fires twice as many rounds.
- **Pilot:** new uncapped **Strafe Thrusters** upgrade (+8% strafe power per level). The ability bar shows "Z / X strafe · Thrusters Lv N".
- **Engineer:** the engines spool slowly toward the set throttle. Throttle above 40% drains the reroute power pool, up to 3.2/s at 100%. The panel shows a 40% mark, the actual engine output, a label and a tooltip, plus a one-time voiced tip from Mort. Reroute drain is steeper (10 slots = 25.6/s).
- **Radiation:** 1.5 hull/s (was 0.6). Zones get a shimmering, smoky look with rippling rings.
- **Voices:** the six crew voices are about 10% faster (Szarkath unchanged). Finn's hull-50% and hull-critical calls have 4 variants each, the Mireth care package has 3.
- Tests: `node test/v9-test.js http://localhost:8091`. Screenshots: `node test/shot-v9.js http://localhost:8091/ <dir>`.

## What is new in v8 (update number 7)
`/health` reports `v:8`. Tests: `test/v8-test.js` (needs `DEV_TOOLS=1`), screenshots: `test/shot-v8.js` (needs Chrome).
- **Final boss, the Drowned Throne:** now 2.1x bigger with 33 destroyable ports (lances, batteries, flak, missile racks, docks, shield projectors), a bigger shield and three phases.
- **Esc menu** (Resume / Restart Game / Help / Sound / Music / Leave). Restart resets the campaign, upgrades, ports and credits and returns a private ship to the lobby (the public ship only restarts when you are alone on it).
- **Lobby + arrival cutscene (private ships):** up to 6 players pick characters (no duplicates), empty seats are bots, Start launches together, then a short voiced story scene about arriving in the unknown Hollow Reach before mission 1. The public ship skips the lobby and plays the scene once for a fresh run.
- **Bigger enemies at higher levels** (ships grow with level, up to 1.5x; stations, rocks, mines and kamikazes keep their size). **Portless fighters fly in squadrons of 3-6** (V, or a triangle for six).
- **Left-side text feed** replaces the repair crew's spoken "port destroyed" calls. **Radar** (upper right) shows enemies (red) and friendlies (blue/green/yellow), hazard zones and wells.
- **Strafe thrusters (pilot, Z / X):** weak, slow sideways shift, not a port, cannot be destroyed, off when the engines are down.
- **Engineer rerouting:** each filled square gives a stronger effect, costs more energy per square; the reroute upgrades improve the trade.
- **Port upgrades:** Port 1, 2 and 3 now each offer their own two options per role (no repeats across slots). New ports: Homing Missiles, Pulse Array, Lance Cannon (pilot); Flak Turret (gunners); Surge Coupler, Flare Dispenser, Booster Nozzles (engineer); Arc Lens, Ion Capacitor, Ablative Plating (shield); Repair Nanites, Emergency Foam, Magnet Drones (repair). Scatter Turrets get a Range upgrade.
- **Hazard zones:** radioactive (damage over time) and cold (slows). The pilot explains each type only the first time per run. **Gravity wells:** black-and-purple dot with a clearly drawn circular area (300 px). They pull and swallow missiles, rockets, mines, bombs and drones (not lasers, ion bolts or ships). New mission *Gravity Trap* (station ringed by wells; wells never overlap a station).
- **More stations:** asteroid fortress, ring, cross, spindle (plus 3 friendly outpost looks) and the new mission *Twin Outposts* (defend two stations in different areas).
- **Pilot weapons are bright yellow** (nose lasers, rockets, missiles, Lance). **Homing Missiles:** fast, long range, arc around to hit from behind, fired 45 degrees off the nose alternating left/right; slower than the main guns, faster than the rocket turret, slightly weaker than rockets.
- Dev ops added: `squad`. Voice: the port-down clips were removed; `pz_*` hazard briefings and the cutscene lines were added.

## v7.1: human voices + HUD portrait
- **Prerecorded neural voices** (`public/voice/*.mp3`, 112 clips, ~1.3 MB, mono 24 kHz / 24 kbps MP3). Generated on a box with **edge-tts** (Microsoft neural voices, free, no key) by `tools/voice-manifest.js | python3 tools/gen-voice.py`, then a light radio filter (gentle band limit + soft compression). Lazy-loaded on first use (the Finn callouts are prefetched when the first mission starts) and played through WebAudio, so they follow the game volume and mute.
- **Voices:** Finn en-US-Andrew (warm, friendly, natural rate, no pitch-down); Skids en-US-Emma; Boomer en-AU-William; Mort en-US-Eric; Ophelia en-GB-Libby; Ember en-US-Jenny; Tavi en-US-Ana; Ishkara en-AU-Natasha; Command en-US-Roger (tinny radio); Kraal en-US-Guy; Durmok en-GB-Thomas; Grakk en-CA-Liam; Admiral Sskarra en-GB-Sonia; lieutenants en-US-Steffan. **Szarkath:** the deepest authoritative neural voice available (en-US-Christopher, lowest pitch of every English male voice), slowed 14%, pitched down ~3 semitones with formant-shifting (rubberband) to ~90 Hz, low shelf + a touch of reverb. Not a clone of anyone.
- **Voiced:** Finn's "<station/port> is down" (every station and port name), "Hull at fifty percent", "Hull critical"; all 13 villain taunts, 5 reinforcement lines, 4 boss lines; each named commander's intro and death line (lieutenants: all 10); Tavi/Ishkara comms; and the short (65 characters or fewer) cutscene lines of the crew, cats, commanders and villain. Longer cutscene lines stay text-only.
- **Fallback** (no clip, or it failed to load): speechSynthesis with the most natural installed voice (names with Natural / Neural / Online / Google first), pitch 1, rate 1. Rate limits (7.5 s, 3 s urgent) and the below-10% hull alarm are unchanged. A first callout within 7.5 s of page load is no longer swallowed.
- **HUD portrait:** your character's framed portrait with name, role and animal sits on top of the hull panel (bottom-left); it docks beside the panel on short screens and the crew list hides on short landscape phones. `/health` reports `v:7.1`.
- Tests: `test/voice-test.js` (needs `DEV_TOOLS=1` + Chrome), `test/shot-hud.js` (HUD screenshots).

## What is new in v7 (update number 6): Spacebelts Optional
The game is now **Spacebelts Optional** (title screen, lobby, page title, this README). `/health` reports `v:7`.

**Story.** A war rages at the galactic center, so the military cannot spare a single ship. They send six misfits to explore a sector nobody has entered for thousands of years, in exchange for a top-of-the-line Chimera-class shift cruiser. They named her the **Voided Warranty**. Crew cores are now **Morph Metal**. Twelve chapters (`public/story.js`): pirates, hostages, escort, refugees, station, defense, flagship, siege, survival, bomb run, the Admiral's last orders, and the finale. Past chapter 12 the campaign keeps going with the usual extended missions.
- **Crew** (shown on the opening page before you join, click a card to pick that seat): Skids Vantail (Red Flying Squirrel, F, Pilot), Boomer Hopkins (Kangaroo, M, Starboard Gunner), Finn Halloran (Arctic Fox, M, Repair), Mort Gazewell (Basilisk Lizard, M, Engineer), Ophelia Quill (Owl, F, Shields), Ember Ashmaw (Dragon, F, Port Gunner). Bots use the same names.
- **Vorrakh** (croc war-clan, the enemy). Commanders: Kraal Skullchain, Durmok the Veiled, Grakk Ironjaw, Admiral Sskarra Venomtongue, plus lieutenants. Each sits on a named ship or station that you must destroy (name label + intro/death comm).
- **Mireth** (friendly desert cats): Ishkara and Tavi chat during missions and send one care package per mission (+6 hull, some credits).
- **Szarkath, the Drowned King** (overarching villain): taunts every 30-44 s from chapter 2, sends extra waves from chapter 3, and is only fought in chapter 12 as **The Drowned Throne**: 14 hard-points, 420 shield (x2.3 at level 12), 60 HP ports, three phases (45% and 80% of ports destroyed), +3 Morph Metal on the win.
- **Cutscenes** before and after each main chapter are dialogue panels over the live game: nothing pauses, they auto-advance, click = next, Esc/Skip = skip (local only, so bots and votes never wait for them). The briefing plays once per chapter per room; the debrief only after a win. Villain and commander comm popups appear in missions.

**Ion bolts.** Blue, speed 400 px/s, 4.2 s life (~1680 px range), 10 s base cooldown. A hit **stuns for 3 s**: no firing, no steering, thrust at minimum; on the ship the hull damage is x0.6 and it drains 7 shield hit points (rapid shield loss). Works on players and enemies (enemies move at 25% and cannot fire; capital ships stun 1.5 s, the final boss 1 s with a 6 s immunity). Enemies use them rarely: one port on destroyer, dreadnought, station and boss, plus the uncommon Lancer fighter (spawn weight 0.35). Clear stun effect: blue arcs on the ship, "STUNNED" overlay and a timer. **Shield player: click fires an ion bolt** (costs 1.5 shield HP, 7 s cooldown, needs >2 shield HP; drains an enemy shield by max(12, 50% of its max) and stuns it).

**Finn (Repair) speaks.** Web Speech API with a low male voice (pitch 0.78) and a comm beep + popup: "Port down" and "Hull below 50%" announcements, heard by everybody, rate-limited (7.5 s, 3 s when urgent). Hull bar is bigger (18 px, 50% and 10% ticks). **Below 10% hull a ship alarm** (siren + red screen edge) plays for everyone until the hull is above 10% or the ship is destroyed.

**Mk IV Leviathan (Voided Warranty).** New bigger sprite, hull 40 + 12 x Mk (76), costs **45 Morph Metal** (Mk II 10, Mk III 22), **one more port per player** (4th/elite port 750 c): its effect is x1.6, port upgrades give x1.5, +2 max levels and +1.5 section HP. After Mk IV every spare Morph Metal is either **sold for 15 c x1.1 per crew member** or poured into the hull as **+1 max hull HP** (permanent, survives ship resets).

**Skill pyramid row 2.** The 2nd and 4th node have no ability, so each now carries a small bonus: pilot graze +4% / nose fire rate +6%; gunners turret damage +6% / turret fire rate +6%; engineer rerouting +6% / bomb cooldown -8%; shields regen +0.06 hp/s +3 hp / +0.2 regen +1 hp; repair drone damage +8% / drone armor +1.

Tests: `test/v7-test.js` (needs `DEV_TOOLS=1`), `test/shot-v7.js` (screenshots, `screens/v7-*.jpg`).

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
Common: **Esc** menu (Resume / Restart Game), **A / S / D** abilities (were Q/E/R; slot 1/2/3) (picked in the skill pyramid, U), Tab switch role, H help, M mute, N music. Station destroyed? The Repair player clicks it to repair it. Repair Bay destroyed? Everybody else mashes CLICK RAPIDLY.
- Pilot: aim to steer, click nose laser (yellow), **Z / X strafe thrusters**. A Barrel Roll (built in), S/D from the pyramid (Lock-On Volley, Battle Cry, Flare Burst, Strafing Run, Rally Point)
- Gunners: aim + click, each gunner fires their own turret and port turrets. A Rapid Fire, then Flak Screen, Overcharge, Target Paint, Barrage, Deadeye, Suppressive Fire
- Engineer: Up/Down arrows or mouse wheel = throttle (only the engineer controls speed; W/S moved so A/S/D are free), 1-4 add a rerouting slot (Shift removes, C clears). A Proton Bomb, then Afterburner, Micro-Jump, Seismic Charge, Power Surge
- Shields: aim the arc (it stays where you point it). A Fortify, then Barrier Bubble, Shield Lance, Energy Vent, Aegis Link, Nova Lance, Emergency Reboot
- Repair: click a damaged port in the side panel (or 1-6 / 0 = hull) to start the automatic repair, **click anywhere on the map to send the drones there** (right-click = back to auto, they never overlap), play its minigame for a bonus, G recalls/launches the self-flying drone (recalled = +50% repair). A Spot Weld, then Nano Swarm, Drone Overdrive, Stim Shot, Restoration, Drone Swarm, Field Medic

## Deploy (Render, free web service)
Build `npm install`, start `npm start`, health check `/health`. Player profiles are saved to `data/` (ephemeral on Render free).

Updates: push to `main`, then trigger a manual deploy on Render (auto-deploy needs the Render GitHub app connected, which the public-repo service does not have). `DEV_TOOLS=1` enables test-only staging commands: never set it in production.
