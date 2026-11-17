# TEAM SPACE SHIP

Co-op, real-time browser game. One ship, six stations (Pilot, Port/Starboard Gunners, Shields, Engineer, Repair). Bots crew every empty seat, so the public ship is always running and joinable. Desktop (mouse + keys) and phone (touch) controls.

Live: https://team-space-ship.onrender.com

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
- `public/defs.js`: shared game data (roles, skill trees, abilities, enemies, missions), loaded by server and client
- `public/game.js`, `public/index.html`: Canvas 2D client, procedural art, WebAudio SFX/music, HUD, touch controls
- `test/ws-test.js`: integration test; `test/shot-v2.js`: headless screenshots (needs Chrome + puppeteer-core)

## Controls
Common: Q/E/R abilities (unlock in the skill tree, U), F assist repairs, Tab switch role, H help, M mute, N music. Station destroyed? Hold FIRE to self-patch.
- Pilot: aim to steer, click nose laser. Q Barrel Roll · E Lock-On Volley · R Battle Cry
- Gunners: aim + click. Q Overcharge · E Flak Screen · R Target Paint
- Engineer: W/S throttle (only the engineer controls speed), 1/2/3 power pips, 4 reset. Q Reroute Power · E Afterburner · R Proton Bomb
- Shields: aim the arc, Space/right-click flip DEFLECT (green lasers) / KINETIC (missiles, flak). Q Bubble · E Energy Vent · R Aegis Link
- Repair: hold FIRE in the green band, 1-6 pick port, 0 hull. Q Nano Swarm · E Drone Overdrive · R Stim

## Deploy (Render, free web service)
Build `npm install`, start `npm start`, health check `/health`. Player profiles are saved to `data/` (ephemeral on Render free).
