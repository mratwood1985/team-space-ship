// Shared game data for server (require) and client (window.DEFS)
(function (root) {
const PI = Math.PI;
const ROLES = ['pilot', 'gunR', 'repair', 'engineer', 'shield', 'gunL']; // clockwise hit sectors from the nose
const RNAME = ['PILOT', 'STARBOARD GUNNER', 'REPAIR / DRONE', 'ENGINEER', 'SHIELDS', 'PORT GUNNER'];
const RSHORT = ['PLT', 'GUN-S', 'RPR', 'ENG', 'SHD', 'GUN-P'];
const PORT_NAMES = ['Cockpit', 'Starboard Gun Turret', 'Repair Bay', 'Main Engines', 'Deflector Generator', 'Port Gun Turret'];
const TREE_OF = ['pilot', 'gun', 'repair', 'engineer', 'shield', 'gun'];
const NODE_COST = [12, 22, 36, 55, 80];
const infCost = lv => 8 + 4 * lv;
// node: [id, name, desc, abilityId|null, shipMkRequired]
const TREES = {
  pilot: { name: 'Flight', br: [
    { n: 'Evasion', k: 'Q', nodes: [['p_roll', 'Barrel Roll', 'ACTIVE: 0.7s invulnerable roll and sidestep. CD 8s', 'roll'], ['p_agile', 'Agile Frame', '+15% turn rate'], ['p_roll2', 'Snap Roll', 'Roll CD -3s, +0.3s invulnerability'], ['p_slip', 'Slipstream', 'After a roll: +40% ship speed for 2s'], ['p_ace', 'Ace Reflexes', '15% of hits on the ship become harmless grazes', null, 1]] },
    { n: 'Gunnery', k: 'E', nodes: [['p_lens', 'Focused Lenses', '+25% nose laser damage'], ['p_volley', 'Lock-On Volley', 'ACTIVE: 6 homing red darts at nearby enemies. CD 11s', 'volley'], ['p_cap', 'Rapid Capacitor', '+30% nose laser fire rate'], ['p_volley2', 'Full Salvo', 'Volley fires +4 darts'], ['p_pierce', 'Lance Nose', 'Nose lasers pierce one extra target', null, 1]] },
    { n: 'Command', k: 'R', nodes: [['p_cry', 'Battle Cry', 'ACTIVE, CREW BUFF: +25% fire rate and repair speed for the whole crew, 5s. CD 26s', 'cry'], ['p_steady', 'Steady Flight', 'Gunners rotate turrets 20% faster'], ['p_long', 'Long Orders', 'Your crew buffs last +2s'], ['p_rally', 'Rally', 'Battle Cry also restores 20 energy'], ['p_inspire', 'Inspiring Leader', 'Battle Cry CD -8s', null, 1]] }],
    inf: [['i_turn', 'Trim Tabs', '+3% turn rate'], ['i_nose', 'Nose Coils', '+4% nose damage'], ['i_nrate', 'Nose Cycler', '+3% nose fire rate']],
    big: [['b_armor', 'Armored Cockpit', 'Cockpit takes 3 hits to knock out (was 2)', 260, 0], ['b_tc', 'Targeting Computer', 'Nose laser auto-aims at enemies within 15°', 320, 2]],
    ports: [['twin', 'Twin Wing Cannons', '2 extra red lasers fire with your nose gun'], ['rockets', 'Rocket Pod', 'A heavy rocket with every 4th nose shot'], ['scatter', 'Scatter Cannon', 'Adds a 5-bolt spread once a second while firing']] },
  gun: { name: 'Gunnery', br: [
    { n: 'Firepower', k: 'Q', nodes: [['g_over', 'Overcharge', 'ACTIVE: double fire rate for 3s. CD 12s', 'overcharge'], ['g_coils', 'Heavy Coils', '+20% laser damage'], ['g_over2', 'Sustained Charge', 'Overcharge lasts +2s'], ['g_pierce', 'Piercing Bolts', 'Lasers pierce one extra target'], ['g_tri', 'Tri-Fire', 'During Overcharge every shot fires 3 bolts', null, 1]] },
    { n: 'Defense', k: 'E', nodes: [['g_flak', 'Flak Screen', 'ACTIVE: a ring of 18 red flak bolts shreds incoming shots. CD 10s', 'flak'], ['g_pd', 'Point-Defense AI', 'Your lasers pop enemy shots from twice as far'], ['g_flak2', 'Hot Flak', 'Flak bolts deal full damage to enemies'], ['g_cover', 'Covering Fire', '+30% fire rate while the shields are down or vented'], ['g_flak3', 'Double Ring', 'Flak fires two rings, CD -4s', null, 1]] },
    { n: 'Teamwork', k: 'R', nodes: [['g_paint', 'Target Paint', 'ACTIVE, CREW BUFF: mark the enemy nearest your cursor. The whole crew deals +50% damage to it for 6s. CD 15s', 'paint'], ['g_swivel', 'Swivel Mount', '+25% turret rotation speed'], ['g_paint2', 'Long Paint', 'Paint lasts +3s'], ['g_spot', 'Spotter', 'Painted enemies drop double credits'], ['g_spread', 'Spread Paint', 'Paint marks 3 enemies', null, 1]] }],
    inf: [['i_dmg', 'Coil Tuning', '+4% laser damage'], ['i_rof', 'Cycler', '+3% fire rate'], ['i_slew', 'Servo Grease', '+4% turret rotation']],
    big: [['b_armor', 'Armored Turret', 'Your turret takes 3 hits to knock out', 240, 0], ['b_twin', 'Twin-Linked Barrels', 'Every laser shot fires 2 bolts', 320, 1]],
    ports: [['rockets', 'Rocket Launcher', 'Slow heavy rockets with splash damage, fire with your guns'], ['beam', 'Beam Emitter', 'Continuous red beam: low damage, slower turn, short range'], ['scatter', 'Scatter Laser', '5-bolt red spread: slower rate, shorter range']] },
  engineer: { name: 'Engineering', br: [
    { n: 'Power Grid', k: 'Q', nodes: [['e_reroute', 'Reroute Power', 'ACTIVE, CREW BUFF: send 50% engine power to the gunner on your cursor side: +50% fire rate, +50% turret turn, +30% damage for 5s (ship slows). CD 14s', 'reroute'], ['e_conduit', 'Efficient Conduits', 'Power-routing effects are 30% stronger'], ['e_long', 'Extended Bus', 'Your crew buffs last +2s'], ['e_split', 'Split Feed', 'Reroute also feeds the other gunner at half strength'], ['e_overload', 'Overload', 'Reroute damage bonus +30% more, CD -4s', null, 1]] },
    { n: 'Thrusters', k: 'E', nodes: [['e_burn', 'Afterburner', 'ACTIVE: +80% speed for 2.5s. CD 9s', 'burner'], ['e_turbine', 'Tuned Turbines', '+12% top speed'], ['e_ram', 'Ram Plating', 'While afterburning, rams cost no hull and hit enemies 3x harder'], ['e_limp', 'Limp Mode', 'Destroyed engines keep 35% thrust instead of stalling'], ['e_damp', 'Inertial Dampers', 'Afterburner CD -4s, plus 1s of invulnerability', null, 1]] },
    { n: 'Demolitions', k: 'R', nodes: [['e_bomb', 'Proton Bomb', 'ACTIVE: lob a bomb at your cursor. Huge blast that erases enemy shots. CD 12s', 'bomb'], ['e_yield', 'Bigger Yield', '+25% blast radius'], ['e_cluster', 'Cluster Charge', 'Bomb splits into 3 extra blasts'], ['e_reactor', 'Reactor Tuning', '+30% ship energy regen'], ['e_seismic', 'Seismic Charge', '+60% bomb damage, CD -4s', null, 1]] }],
    inf: [['i_speed', 'Injector Tune', '+2% top speed'], ['i_regen', 'Reactor Trim', '+4% energy regen'], ['i_cdr', 'Quick Relays', 'Your ability cooldowns -2% (max -40%)']],
    big: [['b_armor', 'Armored Nacelles', 'Engines take 3 hits to knock out', 260, 0], ['b_hyper', 'Hyperdrive Core', '+40% energy regen and +25 max energy', 340, 1]],
    ports: [['mines', 'Mine Layer', 'Drops a proximity mine behind the ship every 3s'], ['tractor', 'Tractor Beam', 'Pulls credits and cores in from 3x farther'], ['aux', 'Aux Reactor', '+35% energy regen']] },
  shield: { name: 'Shields', br: [
    { n: 'Barrier', k: 'Q', nodes: [['s_bubble', 'Bubble Shield', 'ACTIVE: a full 360° shield that blocks ALL shot types for 2s. CD 16s', 'bubble'], ['s_wide', 'Wide Emitters', '+15° barrier width'], ['s_bubble2', 'Long Bubble', 'Bubble lasts +1s'], ['s_spin', 'Gyro Spin', '+30% barrier rotation'], ['s_mirror', 'Mirror Bubble', 'Bubble reflects lasers back as red bolts, CD -6s', null, 1]] },
    { n: 'Energy', k: 'E', nodes: [['s_vent', 'Energy Vent', 'ACTIVE: drop the barrier for 2s to gain +30 energy. CD 12s', 'vent'], ['s_absorb', 'Absorber', '+50% energy from blocked shots'], ['s_cap', 'Supercapacitor', '+25 max ship energy'], ['s_vent2', 'Deep Vent', 'Vent gives +20 more energy'], ['s_overflow', 'Overflow', 'Above 90% energy, blocked shots also weld the hull', null, 1]] },
    { n: 'Protector', k: 'R', nodes: [['s_aegis', 'Aegis Link', 'ACTIVE, CREW BUFF: no crew station can be knocked out for 4s (the hull still dents). CD 20s', 'aegis'], ['s_long', 'Long Link', 'Your crew buffs last +2s'], ['s_smart', 'Smart Deflector', 'The barrier auto-flips to match the closest incoming shot'], ['s_partial', 'Reinforced Field', 'Wrong-type shots hitting the barrier are still blocked 40% of the time'], ['s_rally', 'Shield Rally', 'Aegis also gives the crew +25% fire rate', null, 1]] }],
    inf: [['i_arc', 'Emitter Trim', '+2° barrier width'], ['i_spin', 'Gyro Trim', '+4% barrier rotation'], ['i_abs', 'Collector', '+5% energy from blocks']],
    big: [['b_armor', 'Hardened Generator', 'Deflector takes 3 hits to knock out', 240, 0], ['b_dual', 'Dual Projector', 'A second barrier (60% width) always faces behind yours', 320, 1]],
    ports: [['rear', 'Rear Projector', 'A small extra barrier always faces opposite yours'], ['reflect', 'Reflector Grid', 'Blocked lasers bounce back as red bolts'], ['capbank', 'Capacitor Bank', '+50 max energy, +20% regen']] },
  repair: { name: 'Repair', br: [
    { n: 'Engineering', k: 'Q', nodes: [['r_quick', 'Quick Hands', '+25% repair task speed'], ['r_nano', 'Nano Swarm', 'ACTIVE: instantly completes 40% of the current repair (or welds 1.5 hull). CD 18s', 'nano'], ['r_band', 'Wide Tolerance', 'Green repair band is 35% wider'], ['r_hull', 'Hull Welder', 'Passive hull regen x2'], ['r_kits', 'Field Kits', 'Crew self-patch twice as fast', null, 1]] },
    { n: 'Drone', k: 'E', nodes: [['r_dlaser', 'Drone Lasers', '+30% drone damage'], ['r_od', 'Drone Overdrive', 'ACTIVE: drone fires 3x faster and flies 50% faster for 4s. CD 12s', 'droneod'], ['r_darmor', 'Drone Armor', '+2 drone armor'], ['r_magnet', 'Salvage Magnet', 'Drone grabs pickups from 3x farther'], ['r_dmsl', 'Drone Missiles', 'Drone fires a homing missile every 3s', null, 1]] },
    { n: 'Support', k: 'R', nodes: [['r_stim', 'Stim Boost', 'ACTIVE, CREW BUFF: the crew member whose station is nearest your cursor gets +40% to their station for 5s. CD 15s', 'stim'], ['r_long', 'Long Stims', 'Your crew buffs last +2s'], ['r_emerg', 'Emergency Protocol', 'Knocked-out ports start their repair at 25%'], ['r_stimfix', 'Stim Patch', 'Stim also restores 1 station hit point'], ['r_medbay', 'Med Bay', 'Stim CD -5s and it boosts a second crew member', null, 1]] }],
    inf: [['i_rep', 'Better Tools', '+4% repair speed'], ['i_ddmg', 'Drone Coils', '+5% drone damage'], ['i_darm', 'Drone Plating', '+0.3 drone armor']],
    big: [['b_armor', 'Armored Bay', 'Repair bay takes 3 hits to knock out', 240, 0], ['b_auto', 'Auto-Repair Matrix', 'Knocked-out ports slowly repair themselves', 320, 1]],
    ports: [['drone2', 'Second Drone', 'An extra attack drone'], ['sdrone', 'Shield Drone', 'A drone orbits the ship and blocks shots'], ['welder', 'Auto-Welder', 'Hull regenerates 3x faster']] },
};
const ABIL = {
  roll: { n: 'Barrel Roll', cd: 8 }, volley: { n: 'Lock-On Volley', cd: 11 }, cry: { n: 'Battle Cry', cd: 26, buff: 1 },
  overcharge: { n: 'Overcharge', cd: 12 }, flak: { n: 'Flak Screen', cd: 10 }, paint: { n: 'Target Paint', cd: 15, buff: 1 },
  reroute: { n: 'Reroute Power', cd: 14, buff: 1 }, burner: { n: 'Afterburner', cd: 9 }, bomb: { n: 'Proton Bomb', cd: 12 },
  bubble: { n: 'Bubble Shield', cd: 16 }, vent: { n: 'Energy Vent', cd: 12 }, aegis: { n: 'Aegis Link', cd: 20, buff: 1 },
  nano: { n: 'Nano Swarm', cd: 18 }, droneod: { n: 'Drone Overdrive', cd: 12 }, stim: { n: 'Stim Boost', cd: 15, buff: 1 },
};
const BOT_PORTS = [['twin', 'rockets'], ['rockets', 'beam'], ['drone2', 'sdrone'], ['tractor', 'mines'], ['rear', 'reflect'], ['scatter', 'rockets']];
const MK_COST = [0, 5, 12];
const MK_NAMES = ['Mk I Corvette', 'Mk II Gunship', 'Mk III Battlecruiser'];
const DIFFS = [{ n: 'EASY', lv: -1, m: 0.8 }, { n: 'NORMAL', lv: 0, m: 1 }, { n: 'HARD', lv: 2, m: 1.45 }, { n: 'ELITE', lv: 4, m: 2 }];
const MTYPES = {
  pirates: { n: 'Eliminate the Pirates', d: 'Destroy every pirate wave' },
  hostages: { n: 'Rescue the Hostages', d: 'Fly over each hostage pod to tow it to safety. Don\'t let them be destroyed' },
  escort: { n: 'Escort the Convoy', d: 'Keep the freighters alive until they reach the jump point' },
  station: { n: 'Destroy the Enemy Station', d: 'Knock out every gun port on the station, then clear the area' },
  defend: { n: 'Defend the Station', d: 'Hold off the waves attacking the friendly station' },
  flagship: { n: 'Flagship Assault', d: 'Fight through the escorts and destroy the flagship\'s gun ports' },
};
// enemy weapons (all lasers are neon green; t: 0 = laser (energy), 1 = missile (kinetic), 2 = flak (kinetic))
const WEAP = { las: { cd: 1.7, spd: 560, t: 0, r: 5 }, msl: { cd: 3.4, spd: 250, t: 1, r: 7, home: 1.7 }, flak: { cd: 2.4, spd: 430, t: 2, r: 5, n: 4, spread: 0.28, life: 1.35 }, ion: { cd: 4.8, spd: 440, t: 0, r: 12, heavy: 1, charge: 0.9 } };
const STATION_W = ['las', 'msl', 'flak', 'las', 'ion', 'las', 'msl', 'flak'];
const ETYPES = [
  { id: 'probe', n: 'Probe Droid', r: 12, hp: 2, spd: 140, want: 320, minL: 1, cr: 2, g: { w: 'las', arc: 0.7, rng: 560, n: 1 } },
  { id: 'fighter', n: 'Talon Fighter', r: 17, hp: 3, spd: 240, want: 340, minL: 1, cr: 3, g: { w: 'las', arc: 0.35, rng: 650, n: 2 } },
  { id: 'interceptor', n: 'Dagger Interceptor', r: 16, hp: 3, spd: 320, want: 280, minL: 3, cr: 4, g: { w: 'las', arc: 0.3, rng: 620, n: 4, burst: 1 } },
  { id: 'bomber', n: 'Hammer Bomber', r: 21, hp: 6, spd: 150, want: 540, minL: 4, cr: 5, g: { w: 'msl', arc: 1.0, rng: 920, n: 2 } },
  { id: 'raider', n: 'Pirate Raider', r: 19, hp: 4, spd: 210, want: 360, minL: 1, cr: 4, g: { w: 'las', arc: PI, rng: 600, n: 1, turret: 1 } },
  { id: 'mine', n: 'Seeker Mine', r: 13, hp: 3, spd: 175, want: 0, minL: 2, cr: 1 },
  { id: 'gunship', n: 'Gunship', r: 44, hp: 1, spd: 110, want: 480, minL: 5, cr: 18, mp: 1, php: 6, hull: { k: 'ell', a: 44, b: 22 },
    ports: [{ x: 38, y: 0, f: 0, arc: 0.5, rng: 880, w: 'msl', n: 'Missile Tube' }, { x: 0, y: -22, f: -PI / 2, arc: 1.3, rng: 720, w: 'las', n: 'Port Cannon' }, { x: 0, y: 22, f: PI / 2, arc: 1.3, rng: 720, w: 'las', n: 'Starboard Cannon' }] },
  { id: 'frigate', n: 'Frigate', r: 86, hp: 1, spd: 70, want: 520, minL: 7, cr: 30, mp: 1, php: 8, hull: { k: 'ell', a: 86, b: 30 },
    ports: [{ x: 84, y: 0, f: 0, arc: 0.6, rng: 620, w: 'flak', n: 'Bow Flak' }, { x: 30, y: -29, f: -PI / 2, arc: 1.25, rng: 760, w: 'las', n: 'Port Battery' }, { x: 30, y: 29, f: PI / 2, arc: 1.25, rng: 760, w: 'las', n: 'Starboard Battery' }, { x: -40, y: -28, f: -PI / 2 - 0.5, arc: 1.1, rng: 760, w: 'las', n: 'Aft Port Cannon' }, { x: -40, y: 28, f: PI / 2 + 0.5, arc: 1.1, rng: 760, w: 'las', n: 'Aft Starboard Cannon' }, { x: -84, y: 0, f: PI, arc: 0.9, rng: 900, w: 'msl', n: 'Stern Missiles' }] },
  { id: 'destroyer', n: 'Star Destroyer', r: 150, hp: 1, spd: 45, want: 560, minL: 10, cr: 60, mp: 1, php: 12, hull: { k: 'tri', p: [[150, 0], [-110, -80], [-110, 80]] },
    ports: [{ x: 140, y: 0, f: 0, arc: 0.35, rng: 1000, w: 'ion', n: 'Ion Cannon' }, { x: 60, y: -38, f: -PI / 2 + 0.35, arc: 1.1, rng: 800, w: 'las', n: 'Port Fore Battery' }, { x: 60, y: 38, f: PI / 2 - 0.35, arc: 1.1, rng: 800, w: 'las', n: 'Starboard Fore Battery' }, { x: -30, y: -62, f: -PI / 2 + 0.35, arc: 1.2, rng: 850, w: 'msl', n: 'Port Missile Bank' }, { x: -30, y: 62, f: PI / 2 - 0.35, arc: 1.2, rng: 850, w: 'msl', n: 'Starboard Missile Bank' }, { x: -106, y: -50, f: -PI + 0.5, arc: 1.0, rng: 650, w: 'flak', n: 'Port Aft Flak' }, { x: -106, y: 50, f: PI - 0.5, arc: 1.0, rng: 650, w: 'flak', n: 'Starboard Aft Flak' }] },
  { id: 'station', n: 'Battle Station', r: 150, hp: 1, spd: 0, want: 0, minL: 99, cr: 80, mp: 1, php: 14, hull: { k: 'circ', r: 140 },
    ports: STATION_W.map((w, k) => ({ x: Math.cos(k * PI / 4) * 146, y: Math.sin(k * PI / 4) * 146, f: k * PI / 4, arc: 1.2, rng: w === 'flak' ? 650 : 900, w, n: 'Battery ' + (k + 1) })) },
  { id: 'rock', n: 'Asteroid', r: 34, hp: 6, spd: 0, want: 0, minL: 99, cr: 1 },
];
const PLANET_A = ['Kor', 'Vel', 'Tha', 'Ix', 'Mor', 'Zan', 'Dra', 'Cyr', 'Ul', 'Esk', 'Bes', 'Nar', 'Ord', 'Yav', 'Kes', 'Tal'];
const PLANET_B = ['vos', 'ara', 'ion', 'eth', 'ix', 'ona', 'uun', 'is', 'adar', 'oth', 'ia', 'ek'];
const PLANET_C = ['', '', '', ' Prime', ' IV', ' II', ' Minor', ' VII'];
const PLANET_K = ['rocky', 'ice', 'lava', 'ocean', 'gas', 'desert', 'toxic'];
const D = { ROLES, RNAME, RSHORT, PORT_NAMES, TREE_OF, NODE_COST, infCost, TREES, ABIL, BOT_PORTS, MK_COST, MK_NAMES, DIFFS, MTYPES, WEAP, ETYPES, PLANET_A, PLANET_B, PLANET_C, PLANET_K };
if (typeof module !== 'undefined' && module.exports) module.exports = D; else root.DEFS = D;
})(this);
