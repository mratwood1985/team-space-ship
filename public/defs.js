// Team Space Ship v5: shared game data for the server (require) and the client (window.DEFS)
(function (root) {
const PI = Math.PI;
const VERSION = 5;
const ARENA = 4200;                       // half-size of the mission map (v4: was 3200)
const EFIRE_WEAK_LV = 5, EFIRE_WEAK = 0.6; // enemy fire does 60% damage on mission levels 1-5, full from level 6
const REPAIR_CFG = { base: 20, drone: 1.5, mgMax: 1.0, clickDiv: 300, botCps: 1.5 }; // repair: base seconds per section, drone-off speed multiplier, minigame max bonus, click strength on the Repair Bay
const MONEY_MULT = 1.1;                   // v5: about 10% more credits for everyone
// v5 power rerouting (Engineer): 10 slots in total over 4 options. Drain per second = base * DRAIN[slots used]; the generator regenerates `base` per second at the start (= exactly 1 slot).
const RR_CFG = { max: 10, base: 2.0, drain: [0, 1, 1.08, 1.2, 1.38, 1.6, 1.9, 2.3, 2.8, 3.4, 4.0], regenCap: 3.0, lock: 20, lockThr: 0.25,
  eng: 0.015, acc: 0.08, wpn: 0.05, shd: 0.10, rep: 0.03 };    // per slot: top speed, throttle response, gun fire rate, shield recharge speed, repair speed
const RR_NAMES = ['ENGINES', 'WEAPONS', 'SHIELDS', 'REPAIR'];
const BOMB_CFG = { cd: 12, rad: 150, dmg: 10 };
const ROLES = ['pilot', 'gunR', 'repair', 'engineer', 'shield', 'gunL'];
const RNAME = ['PILOT', 'STARBOARD GUNNER', 'REPAIR / DRONE', 'ENGINEER', 'SHIELDS', 'PORT GUNNER'];
const RSHORT = ['PLT', 'GUN-S', 'RPR', 'ENG', 'SHD', 'GUN-P'];
const PORT_NAMES = ['Cockpit', 'Starboard Gun Turret', 'Repair Bay', 'Main Engines', 'Deflector Generator', 'Port Gun Turret'];
const TREE_OF = ['pilot', 'gun', 'repair', 'engineer', 'shield', 'gun'];

// ---------- economy (v3: progression over many missions) ----------
const NODE_COST = [60, 120, 220, 360, 560];          // pyramid row 1..5
const infCost = lv => 25 + 12 * lv;                   // limitless small upgrades
const PORT_COST = [250, 400];                         // install a port in slot 1 (Mk II) / slot 2 (Mk III)
const portUpCost = lv => 60 + 40 * lv;                // per-port upgrades
const PORT_MAX_LV = 10;
const MK_COST = [0, 10, 22];                          // crew cores
const MK_NAMES = ['Mk I Corvette', 'Mk II Gunship', 'Mk III Battlecruiser'];
const CORE_RATE = 15;                                 // after Mk III: 1 core -> 15 credits for every crew member
const SHIELD_ARC0 = 15, SHIELD_ARC_MAX = 90, SHIELD_DOWN = 20;

// ---------- ship geometry per Mk (local coords, nose = +x, starboard = +y) ----------
// st: crew station sections (index = role). po[role][slot]: physical extra-port sections.
const GEO = [
  { hr: 30, sr: 70, len: 100, scale: 1, st: [[36, 0], [6, 22], [-20, 15], [-42, 0], [-20, -15], [6, -22]], po: [[], [], [], [], [], []] },
  { hr: 40, sr: 92, len: 140, scale: 1, st: [[54, 0], [14, 26], [-22, 20], [-48, 0], [-22, -20], [14, -26]],
    po: [[[32, 0]], [[-2, 42]], [[-42, 32]], [[-70, 0]], [[-42, -32]], [[-2, -42]]] },
  { hr: 52, sr: 114, len: 180, scale: 1, st: [[74, 0], [22, 30], [-28, 26], [-66, 0], [-28, -26], [22, -30]],
    po: [[[52, 0], [34, 0]], [[-4, 50], [40, 46]], [[-50, 40], [-72, 34]], [[-90, 16], [-90, -16]], [[-50, -40], [-72, -34]], [[-4, -50], [40, -46]]] },
];
// section index: 0..5 = stations, 6 + role*2 + slot = extra port
const secIdx = (role, slot) => 6 + role * 2 + slot;

// ---------- stat labels (node effects are data-driven) ----------
const FX = {
  turn: ['turn rate', '%'], nDmg: ['nose laser damage', '%'], nRate: ['nose fire rate', '%'], nRange: ['nose laser range', '%'], nPierce: ['nose pierce', 'n'],
  graze: ['chance a hit becomes a graze', 'p'], crewRof: ['fire rate for the whole crew', '%'], hull: ['max hull', 'n'], rollInv: ['s of roll invulnerability', 's'],
  dmg: ['turret damage', '%'], rof: ['turret fire rate', '%'], slew: ['turret rotation', '%'], range: ['turret range', '%'], pierce: ['turret pierce', 'n'], pd: ['px point-defense radius', 'n'],
  arcG: ['° turret arc', 'n'], sBreak: ['damage to enemy shields', '%'], crit: ['crit chance (x2 dmg)', 'p'],
  speed: ['top speed', '%'], regen: ['power generator output', '%'], emax: ['power generator capacity', 'n'], pipEff: ['rerouting strength (every slot)', '%'], limp: ['thrust kept when engines are down', 'p'],
  ram: ['afterburner ramming', 'b'], bombDmg: ['bomb damage', '%'], bombRad: ['bomb radius', '%'], bombCd: ['bomb cooldown', 'c'], bombN: ['extra bomb per throw', 'n'], burn: ['s afterburner', 's'],
  shHp: ['shield hit points', 'n'], shRegen: ['shield HP/s regen', 'n'], shArc: ['° shield arc', 'n'], shSpin: ['shield turn speed', '%'], absorb: ['energy from blocks', '%'], reflect: ['chance blocked shots reflect', 'p'], lanceDmg: ['Shield Lance damage', '%'],
  rep: ['automatic repair speed', '%'], dDmg: ['drone damage', '%'], dHp: ['drone armor', 'n'], dRate: ['drone fire rate', '%'], hullRegen: ['hull/s regen', 'n'], selfPatch: ['crew click-repair strength on the Repair Bay', '%'],
  magnet: ['pickup magnet range', '%'], emerg: ['downed sections restart at', 'p'], drones: ['extra drone', 'n'], dMsl: ['drone homing missiles', 'b'], portHp: ['HP on every section', 'n'], band: ['repair minigame tolerance', '%'],
  buff: ['s on your crew buffs', 's'], cdr: ['ability cooldowns', 'c'],
};
function fxText(fx) {
  return Object.keys(fx).map(k => { const L = FX[k] || [k, 'n'], v = fx[k], r = Math.round(v * 100);
    if (L[1] === '%') return (v > 0 ? '+' : '') + r + '% ' + L[0];
    if (L[1] === 'p') return (k === 'emerg' ? L[0] + ' ' + r + '%' : '+' + r + '% ' + L[0]);
    if (L[1] === 'c') return '-' + r + '% ' + L[0];
    if (L[1] === 's') return '+' + (+v.toFixed(2)) + L[0];
    if (L[1] === 'b') return L[0];
    return '+' + (+v.toFixed(2)) + ' ' + L[0];
  }).join(', ');
}

// ---------- abilities. slot Q = innate, E = from pyramid row 2, R = from pyramid row 4 ----------
const ABIL = {
  roll: { n: 'Barrel Roll', cd: 10, d: '0.7s invulnerable sidestep roll' },
  rapid: { n: 'Rapid Fire', cd: 14, d: 'Turret fires 2x faster for 2.5s' },
  fortify: { n: 'Fortify', cd: 18, d: 'Shield takes half damage for 4s' },
  weld: { n: 'Spot Weld', cd: 14, d: 'Instantly restore 1 HP to your current repair target' },
  volley: { n: 'Lock-On Volley', cd: 14, d: '6 homing red darts at nearby enemies' },
  cry: { n: 'Battle Cry', cd: 28, buff: 1, d: 'CREW BUFF: +25% fire rate and repair speed for the whole crew, 5s' },
  flak: { n: 'Flak Screen', cd: 12, d: 'Ring of 18 red flak bolts that shreds incoming shots' },
  overcharge: { n: 'Overcharge', cd: 16, d: '+60% turret damage for 4s' },
  paint: { n: 'Target Paint', cd: 18, buff: 1, d: 'CREW BUFF: enemy nearest your cursor takes +50% damage from everyone for 6s' },
  burner: { n: 'Afterburner', cd: 12, d: '+80% speed for 2.5s' },
  bomb: { n: 'Proton Bomb', cd: 12, d: 'Lob a bomb at your cursor: big blast that erases enemy shots. Own cooldown, costs no ship energy' },
  bubble: { n: 'Barrier Bubble', cd: 20, d: 'Full 360° shield for 2s (costs shield HP per block as normal)' },
  lance: { n: 'Shield Lance', cd: 25, d: 'FIRE THE SHIELD as a blue shock-wave along your aim. Damage grows with remaining shield HP. The shield then drops for its 20s recharge' },
  vent: { n: 'Energy Vent', cd: 15, d: 'Turn 1 shield HP into +35 ship energy' },
  nano: { n: 'Nano Swarm', cd: 22, d: 'Instantly completes 40% of the current repair (or welds 1.5 hull)' },
  droneod: { n: 'Drone Overdrive', cd: 15, d: 'Drones fire 3x faster and fly 50% faster for 4s' },
  stim: { n: 'Stim Shot', cd: 18, buff: 1, d: 'CREW BUFF: crew member whose station is nearest your cursor gets +40% to their station for 5s' },
  flare: { n: 'Flare Burst', cd: 20, d: 'Destroys every enemy missile and flak shell within 360px' },
  strafe: { n: 'Strafing Run', cd: 22, d: 'Nose guns fire 3x faster for 4s' },
  rally: { n: 'Rally Point', cd: 30, buff: 1, d: 'CREW BUFF: +30% fire rate & repair for 5s and +1 hull' },
  barrage: { n: 'Barrage', cd: 24, d: 'Every one of your turrets fires a 7-bolt fan, 3 times' },
  deadeye: { n: 'Deadeye', cd: 22, d: 'Your next 5 shots deal 4x damage and pierce' },
  suppress: { n: 'Suppressive Fire', cd: 26, d: '+60% fire rate and +1 pierce for 5s' },
  warp: { n: 'Micro-Jump', cd: 24, d: 'Jump 380px toward your cursor with 1s invulnerability' },
  seismic: { n: 'Seismic Charge', cd: 30, d: 'Huge 300px blast at your cursor that wrecks capital ship ports' },
  surge: { n: 'Power Surge', cd: 40, buff: 1, d: 'CREW BUFF: every crew cooldown -4s and +40% fire rate for 3s' },
  aegis: { n: 'Aegis Link', cd: 30, buff: 1, d: 'CREW BUFF: no ship section can be knocked out for 4s (the hull still dents)' },
  nova: { n: 'Nova Lance', cd: 40, d: 'FIRE THE SHIELD in all directions as a 360° shock-wave. The shield drops for its 20s recharge' },
  reboot: { n: 'Emergency Reboot', cd: 45, d: 'Instantly restore a broken shield at 60% HP' },
  restore: { n: 'Restoration', cd: 35, d: '+2 hull and +1 HP to every ship section' },
  swarm: { n: 'Drone Swarm', cd: 32, d: '3 temporary attack drones for 8s' },
  medic: { n: 'Field Medic', cd: 34, buff: 1, d: 'CREW BUFF: stim every station for 4s' },
};
const INNATE = { pilot: 'roll', gun: 'rapid', engineer: 'bomb', shield: 'fortify', repair: 'weld' };

// ---------- skill pyramids: rows of 6,5,4,3,2. A pick in row r allows only the adjacent nodes [i-1, i] of row r+1 ----------
// node: [id, name, fx, ability?]. Edge nodes of rows 1-4 get +25% effect (they lead to only one choice). Row 5 = capstones.
const N = (id, n, fx, ab) => ({ id, n, fx: fx || {}, ab: ab || null });
const TREES = {
  pilot: { name: 'Flight', rows: [
    [N('p_ace', 'Ace Reflexes', { graze: 0.1 }), N('p_trim', 'Trim Tabs', { turn: 0.2 }), N('p_lens', 'Focused Lenses', { nDmg: 0.25 }), N('p_cap', 'Rapid Capacitor', { nRate: 0.25 }), N('p_barrel', 'Long Barrel', { nRange: 0.25 }), N('p_cockpit', 'Armored Cockpit', { hull: 2 })],
    [N('p_volley', 'Lock-On Volley', {}, 'volley'), N('p_snap', 'Snap Roll', { rollInv: 0.4, cdr: 0.12 }), N('p_cry', 'Battle Cry', {}, 'cry'), N('p_sync', 'Gun Sync', { crewRof: 0.08 }), N('p_heavy', 'Heavy Nose', { nDmg: 0.35, nRate: -0.1 })],
    [N('p_evade', 'Evasive Flight', { graze: 0.08, turn: 0.15 }), N('p_lance', 'Lance Nose', { nPierce: 1 }), N('p_cmd', 'Command Presence', { buff: 2, crewRof: 0.05 }), N('p_over', 'Overpowered Nose', { nDmg: 0.25, nRate: 0.15 })],
    [N('p_flare', 'Flare Burst', {}, 'flare'), N('p_strafe', 'Strafing Run', {}, 'strafe'), N('p_rally', 'Rally Point', {}, 'rally')],
    [N('p_acefleet', 'Ace of the Fleet', { graze: 0.2, turn: 0.3, nRate: 0.3, nDmg: 0.2 }), N('p_flag', 'Flagship Command', { crewRof: 0.15, buff: 3, hull: 4 })]],
    inf: [['i_turn', 'Trim Tuning', 'turn', 0.02], ['i_nose', 'Nose Coils', 'nDmg', 0.03], ['i_nrate', 'Nose Cycler', 'nRate', 0.02]],
    big: [['b_armor', 'Reinforced Cockpit', 'Cockpit section +1 HP', 450, 0, {}], ['b_tc', 'Targeting Computer', 'Nose laser auto-aims at enemies within 15°', 700, 1, {}]],
    ports: [['twin', 'Wing Cannon', 'A red laser cannon that fires with your nose gun'], ['rockets', 'Rocket Pod', 'A heavy red-glow rocket with every 4th nose shot'], ['scatter', 'Scatter Cannon', '5-bolt red spread every 1.2s while firing']] },
  gun: { name: 'Gunnery', rows: [
    [N('g_cells', 'Power Cells', { dmg: 0.2 }), N('g_cycle', 'Fast Cycler', { rof: 0.2 }), N('g_swivel', 'Swivel Mount', { slew: 0.3 }), N('g_long', 'Long Barrels', { range: 0.25 }), N('g_pd', 'Point Defense', { pd: 14 }), N('g_breaker', 'Shield Breaker', { sBreak: 0.5 })],
    [N('g_flak', 'Flak Screen', {}, 'flak'), N('g_lance', 'Lance Bolts', { pierce: 1 }), N('g_over', 'Overcharge', {}, 'overcharge'), N('g_wide', 'Wide Mount', { arcG: 25 }), N('g_paint', 'Target Paint', {}, 'paint')],
    [N('g_hot', 'Hot Barrels', { rof: 0.2, dmg: 0.1 }), N('g_mark', 'Marksman', { crit: 0.12 }), N('g_track', 'Tracking Computer', { slew: 0.3, range: 0.15 }), N('g_ion', 'Ion Rounds', { sBreak: 0.6, dmg: 0.1 })],
    [N('g_barrage', 'Barrage', {}, 'barrage'), N('g_dead', 'Deadeye', {}, 'deadeye'), N('g_supp', 'Suppressive Fire', {}, 'suppress')],
    [N('g_master', 'Gun Master', { dmg: 0.35, rof: 0.25, crit: 0.1 }), N('g_fort', 'Fortress Turret', { pd: 20, range: 0.3, pierce: 1, sBreak: 0.5 })]],
    inf: [['i_dmg', 'Coil Tuning', 'dmg', 0.03], ['i_rof', 'Cycler', 'rof', 0.02], ['i_rng', 'Barrel Lapping', 'range', 0.02]],
    big: [['b_armor', 'Armored Turret', 'Your turret section +1 HP', 450, 0, {}], ['b_twin', 'Twin-Linked Barrels', 'Every turret shot fires 2 bolts', 750, 1, {}]],
    ports: [['rockets', 'Rocket Turret', 'Slow homing red-glow rockets with splash, fire with your guns'], ['beam', 'Beam Turret', 'Continuous red beam: short range, ignores shot speed'], ['scatter', 'Scatter Turret', '5-bolt red spread, shorter range']] },
  engineer: { name: 'Engineering', rows: [
    [N('e_limp', 'Limp Mode', { limp: 0.35 }), N('e_turbine', 'Tuned Turbines', { speed: 0.12 }), N('e_reactor', 'Reactor Tuning', { regen: 0.3 }), N('e_conduit', 'Power Conduits', { pipEff: 0.3 }), N('e_caps', 'Capacitor Banks', { emax: 30 }), N('e_demo', 'Demolitions', { bombDmg: 0.3 })],
    [N('e_burn', 'Afterburner', {}, 'burner'), N('e_ram', 'Ram Plating', { ram: 1 }), N('e_bomb', 'Bomb Fuses', { bombCd: 0.2, bombRad: 0.15 }), N('e_relay', 'Quick Relays', { cdr: 0.15 }), N('e_ovl', 'Overload Relay', { pipEff: 0.25 })],
    [N('e_damp', 'Inertial Dampers', { burn: 1, speed: 0.08 }), N('e_split', 'Twin Bombs', { bombN: 1 }), N('e_cluster', 'Cluster Payload', { bombRad: 0.3, bombDmg: 0.2 }), N('e_fusion', 'Fusion Core', { regen: 0.3, emax: 20 })],
    [N('e_warp', 'Micro-Jump', {}, 'warp'), N('e_seismic', 'Seismic Charge', {}, 'seismic'), N('e_surge', 'Power Surge', {}, 'surge')],
    [N('e_hyper', 'Hyperdrive Core', { speed: 0.2, regen: 0.5, pipEff: 0.3 }), N('e_master', 'Master Engineer', { cdr: 0.25, buff: 3, bombDmg: 0.4 })]],
    inf: [['i_speed', 'Injector Tune', 'speed', 0.015], ['i_regen', 'Reactor Trim', 'regen', 0.03], ['i_bomb', 'Bomb Charges', 'bombDmg', 0.03]],
    big: [['b_armor', 'Armored Nacelles', 'Engine section +1 HP', 450, 0, {}], ['b_hyper', 'Hyper Reactor', '+40 generator capacity, +40% generator output', 800, 1, { emax: 40, regen: 0.4 }]],
    ports: [['mines', 'Mine Layer', 'Drops a proximity mine behind the ship every 3.5s'], ['tractor', 'Tractor Beam', 'Pulls credits and cores in from 2.5x farther'], ['aux', 'Aux Reactor', '+35% energy regen, +25 max energy']] },
  shield: { name: 'Shields', rows: [
    [N('s_hard', 'Hardened Field', { shHp: 2 }), N('s_emit', 'Fast Emitters', { shSpin: 0.4 }), N('s_absorb', 'Absorber', { absorb: 0.5 }), N('s_regen', 'Field Regen', { shRegen: 0.15 }), N('s_wide', 'Wide Emitter', { shArc: 10 }), N('s_mirror', 'Reflector Plating', { reflect: 0.1 })],
    [N('s_bubble', 'Barrier Bubble', {}, 'bubble'), N('s_layer', 'Layered Field', { shHp: 3 }), N('s_lance', 'Shield Lance', {}, 'lance'), N('s_settle', 'Quick Settle', { shRegen: 0.2 }), N('s_vent', 'Energy Vent', {}, 'vent')],
    [N('s_mirror2', 'Mirror Field', { reflect: 0.15 }), N('s_dense', 'Dense Field', { shHp: 3, shArc: 5 }), N('s_focus', 'Lance Focus', { lanceDmg: 0.5, shHp: 1 }), N('s_overflow', 'Overflow', { absorb: 0.4, shRegen: 0.1 })],
    [N('s_aegis', 'Aegis Link', {}, 'aegis'), N('s_nova', 'Nova Lance', {}, 'nova'), N('s_reboot', 'Emergency Reboot', {}, 'reboot')],
    [N('s_bastion', 'Bastion', { shHp: 6, shArc: 15, shRegen: 0.2 }), N('s_warden', 'Warden of the Fleet', { reflect: 0.25, lanceDmg: 1, buff: 3, shHp: 2 })]],
    inf: [['i_arc', 'Arc Emitter', 'shArc', 5], ['i_shp', 'Field Capacitor', 'shHp', 0.5], ['i_spin', 'Gyro Trim', 'shSpin', 0.03]],
    big: [['b_armor', 'Hardened Generator', 'Deflector section +1 HP', 450, 0, {}], ['b_cap', 'Capacitor Array', '+4 shield HP', 700, 1, { shHp: 4 }]],
    ports: [['rear', 'Rear Emitter', 'A second shield arc (60% width) always faces opposite yours'], ['reflect', 'Reflector Grid', '+25% chance blocked lasers bounce back as red bolts'], ['capbank', 'Capacitor Bank', '+3 shield HP and faster shield regen']] },
  repair: { name: 'Repair', rows: [
    [N('r_quick', 'Quick Hands', { rep: 0.25 }), N('r_dlaser', 'Drone Lasers', { dDmg: 0.3 }), N('r_welder', 'Hull Welder', { hullRegen: 0.03 }), N('r_kits', 'Field Kits', { selfPatch: 1 }), N('r_darmor', 'Drone Armor', { dHp: 3 }), N('r_magnet', 'Salvage Magnet', { magnet: 0.6 })],
    [N('r_nano', 'Nano Swarm', {}, 'nano'), N('r_band', 'Wide Tolerance', { band: 0.35 }), N('r_od', 'Drone Overdrive', {}, 'droneod'), N('r_emerg', 'Emergency Protocol', { emerg: 0.25 }), N('r_stim', 'Stim Shot', {}, 'stim')],
    [N('r_reinf', 'Reinforced Sections', { portHp: 1 }), N('r_twin', 'Twin Drone', { drones: 1 }), N('r_dmsl', 'Drone Missiles', { dMsl: 1, dDmg: 0.1 }), N('r_steady', 'Steady Hands', { rep: 0.2, band: 0.2 })],
    [N('r_restore', 'Restoration', {}, 'restore'), N('r_swarm', 'Drone Swarm', {}, 'swarm'), N('r_medic', 'Field Medic', {}, 'medic')],
    [N('r_chief', 'Chief Engineer', { rep: 0.5, hullRegen: 0.05, portHp: 1 }), N('r_cmdr', 'Drone Commander', { drones: 1, dDmg: 0.5, dRate: 0.5 })]],
    inf: [['i_rep', 'Better Tools', 'rep', 0.03], ['i_ddmg', 'Drone Coils', 'dDmg', 0.03], ['i_hreg', 'Nano Paste', 'hullRegen', 0.005]],
    big: [['b_armor', 'Armored Bay', 'Repair bay section +1 HP', 450, 0, {}], ['b_auto', 'Auto-Repair Matrix', 'Knocked-out sections slowly repair themselves', 800, 1, {}]],
    ports: [['drone2', 'Drone Hangar', 'An extra attack drone'], ['sdrone', 'Shield Drone Bay', 'A drone orbits the ship and blocks shots'], ['welder', 'Auto-Welder', 'Hull regenerates 3x faster']] },
};
const EDGE_BONUS = 1.25;
for (const k in TREES) TREES[k].rows.forEach((row, r) => row.forEach((nd, i) => {
  nd.edge = r < 4 && (i === 0 || i === row.length - 1);
  if (nd.edge) { for (const f in nd.fx) nd.fx[f] = +(nd.fx[f] * EDGE_BONUS).toFixed(3); if (nd.ab) nd.cdm = 0.8; }
  nd.cap = r === 4;
  nd.d = nd.ab ? 'ACTIVE [' + (r < 2 ? 'E' : 'R') + ']: ' + ABIL[nd.ab].d + '. CD ' + Math.round(ABIL[nd.ab].cd * (nd.cdm || 1)) + 's' + (nd.edge ? ' (edge: -20% cooldown)' : '') : fxText(nd.fx) + (nd.edge ? ' (edge bonus +25%)' : '');
}));
// next-row choices allowed by a pyramid path
function pyrAllowed(path, r) {
  if (r === 0) return [0, 1, 2, 3, 4, 5];
  const p = path[r - 1]; if (p == null) return [];
  const n = 6 - r; return [p - 1, p].filter(i => i >= 0 && i < n);
}
// combined stat effects of a profile tree (pyramid picks + infinite + big purchases)
function treeStats(treeKey, P) {
  const T = TREES[treeKey], o = {}; if (!T || !P) return o;
  const add = fx => { for (const k in fx) o[k] = (o[k] || 0) + fx[k]; };
  (P.path || []).forEach((i, r) => { const nd = T.rows[r] && T.rows[r][i]; if (nd) add(nd.fx); });
  for (const x of T.inf) { const lv = (P.i || {})[x[0]] || 0; if (lv) add({ [x[2]]: x[3] * lv }); }
  for (const b of T.big) if ((P.b || {})[b[0]]) add(b[5]);
  if (o.cdr) o.cdr = Math.min(0.5, o.cdr);
  return o;
}

// ---------- upgrade text: every upgrade states what it changes, current -> next ----------
// base value of a stat before any upgrade (some depend on the ship Mk); u = unit label, d = decimals
const ABS = {
  hull: { b: mk => 40 + 12 * mk, u: '', d: 0 }, emax: { b: () => 100, u: '', d: 0 }, shHp: { b: () => 4, u: ' HP', d: 1 }, shArc: { b: () => SHIELD_ARC0, u: '°', d: 0, max: SHIELD_ARC_MAX },
  pd: { b: () => 12, u: ' px', d: 0 }, arcG: { b: () => 110, u: '°', d: 0 }, pierce: { b: () => 0, u: '', d: 0 }, nPierce: { b: () => 0, u: '', d: 0 }, rollInv: { b: () => 0.7, u: ' s', d: 1 },
  burn: { b: () => 2.5, u: ' s', d: 1 }, drones: { b: () => 1, u: '', d: 0 }, dHp: { b: () => 3, u: ' HP', d: 0 }, portHp: { b: () => 3, u: ' HP', d: 1 }, buff: { b: () => 5, u: ' s', d: 0 },
};
// multiplicative stats with a known base: [base, unit]
const ABSX = { nDmg: [1.6, ' dmg'], dmg: [1.6, ' dmg'], nRate: [2.6, ' shots/s'], rof: [2.8, ' shots/s'], speed: [185, ' top speed'], nRange: [600, ' px'], bombDmg: [10, ' dmg'], bombRad: [150, ' px radius'], regen: [1, 'x output'], turn: [1.7, ' rad/s'] };
function fmtN(v, d) { return (+v.toFixed(d)).toString(); }
// one line: "Turret damage 1.6 -> 1.9 dmg (+20% -> +40%)". cur = total bonus now, add = what this upgrade adds
function statLine(k, cur, add, mk) {
  const L = FX[k] || [k, 'n'], name = L[0].replace(/^s /, '').replace(/^px /, '').replace(/^° /, ''), c2 = cur + add, ar = ' \u2192 ';
  const pc = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  if (L[1] === 'b') return name + ': ' + (cur ? 'on' : 'off') + ar + 'on';
  if (ABS[k]) { const a = ABS[k], b0 = a.b(mk || 0), x = b0 + cur, y = Math.min(a.max || 1e9, b0 + c2); return name + ': ' + fmtN(x, a.d) + a.u + ar + fmtN(y, a.d) + a.u + (a.max && x >= a.max ? ' (max)' : ''); }
  if (ABSX[k] && L[1] === '%') { const a = ABSX[k], b0 = a[0] * (k === 'speed' ? (1 - 0.06 * (mk || 0)) : 1); return name + ': ' + fmtN(b0 * (1 + cur), 2) + ar + fmtN(b0 * (1 + c2), 2) + a[1] + ' (' + pc(cur) + ar + pc(c2) + ')'; }
  if (L[1] === '%') return name + ': ' + pc(cur) + ar + pc(c2);
  if (L[1] === 'p') return name + ': ' + Math.round(cur * 100) + '%' + ar + Math.round(c2 * 100) + '%';
  if (L[1] === 'c') return name + ': -' + Math.round(cur * 100) + '%' + ar + '-' + Math.round(Math.min(0.5, c2) * 100) + '%' + (c2 > 0.5 ? ' (max -50%)' : '');
  if (L[1] === 's') return name + ': +' + fmtN(cur, 2) + ' s' + ar + '+' + fmtN(c2, 2) + ' s';
  return name + ': +' + fmtN(cur, 2) + ar + '+' + fmtN(c2, 2);
}
// all the lines for an upgrade adding fx to a profile tree P (P = {path,i,b}); one-time nodes and big purchases pass their fx, infinite upgrades pass {stat: per}
function fxLines(treeKey, P, fx, mk) { const cur = treeStats(treeKey, P); return Object.keys(fx).map(k => statLine(k, cur[k] || 0, fx[k], mk)); }
function infCap(treeKey, id, lv) { return treeKey === 'shield' && id === 'i_arc' ? lv >= (SHIELD_ARC_MAX - SHIELD_ARC0) / 5 : false; }

const BOT_PORTS = [['twin', 'rockets'], ['rockets', 'beam'], ['drone2', 'sdrone'], ['aux', 'mines'], ['capbank', 'rear'], ['scatter', 'rockets']];
const BOT_PATH = { pilot: [3, 2, 2, 1, 1], gun: [1, 1, 1, 1, 0], engineer: [2, 2, 1, 1, 0], shield: [1, 1, 1, 1, 0], repair: [0, 0, 0, 0, 0] };
const DIFFS = [{ n: 'EASY', lv: -1, m: 0.8 }, { n: 'NORMAL', lv: 0, m: 1 }, { n: 'HARD', lv: 2, m: 1.45 }, { n: 'ELITE', lv: 4, m: 2 }];
const MTYPES = {
  pirates: { n: 'Eliminate the Pirates', d: 'Destroy every pirate wave' },
  hostages: { n: 'Rescue the Hostages', d: 'Fly over each hostage pod to tow it to safety. Don\'t let them be destroyed' },
  escort: { n: 'Escort the Convoy', d: 'Keep the freighters alive until they reach the jump point' },
  station: { n: 'Destroy the Enemy Station', d: 'Break its shield, knock out every battery and hangar, then clear the area' },
  defend: { n: 'Defend the Station', d: 'Hold off the waves attacking the friendly station' },
  passengers: { n: 'Passenger Run', d: 'Thread the long asteroid field to the far end, pick up the passengers and bring them back to the start' },
  flagship: { n: 'Flagship Assault', d: 'Fight through the escorts, then destroy every port on the flagship' },
};
// enemy weapons. ALL enemy fire glows neon green. t: 0 laser, 1 missile, 2 flak. sd = damage to the player shield
const WEAP = {
  las: { cd: 2.4, spd: 380, t: 0, r: 5, life: 2.2, sd: 1 },
  msl: { cd: 4.6, spd: 180, t: 1, r: 7, home: 1.4, life: 5, sd: 2 },
  flak: { cd: 3.2, spd: 300, t: 2, r: 5, n: 4, spread: 0.28, life: 1.8, sd: 0.6 },
  ion: { cd: 6.5, spd: 300, t: 0, r: 12, heavy: 1, charge: 1.1, life: 3.5, sd: 3 },
};
const STATION_W = ['las', 'msl', 'flak', 'las', 'ion', 'las', 'msl', 'flak'];
const P_ = (x, y, f, arc, rng, w, n, cap) => ({ x, y, f, arc, rng, w, n, cap });
// sz: 0 small, 1 medium, 2 large, 3 huge. sh = shield HP that must be broken before the hull/ports take damage
const ETYPES = [
  { id: 'probe', n: 'Probe Droid', sz: 0, r: 12, hp: 6, spd: 95, want: 320, minL: 1, cr: 1, g: { w: 'las', arc: 0.7, rng: 520, n: 1 } },
  { id: 'fighter', n: 'Talon Fighter', sz: 0, r: 17, hp: 9, spd: 160, want: 340, minL: 1, cr: 1, g: { w: 'las', arc: 0.35, rng: 560, n: 2 } },
  { id: 'interceptor', n: 'Dagger Interceptor', sz: 0, r: 16, hp: 8, spd: 210, want: 280, minL: 3, cr: 2, g: { w: 'las', arc: 0.3, rng: 540, n: 4, burst: 1 } },
  { id: 'bomber', n: 'Hammer Bomber', sz: 0, r: 21, hp: 18, spd: 100, want: 520, minL: 4, cr: 2, g: { w: 'msl', arc: 1.0, rng: 760, n: 2 } },
  { id: 'raider', n: 'Pirate Raider', sz: 0, r: 19, hp: 12, spd: 140, want: 360, minL: 1, cr: 2, g: { w: 'las', arc: PI, rng: 540, n: 1, turret: 1 } },
  { id: 'mine', n: 'Seeker Mine', sz: 0, r: 13, hp: 8, spd: 120, want: 0, minL: 2, cr: 0 },
  { id: 'gunship', n: 'Gunship', sz: 1, r: 44, hp: 1, spd: 75, want: 480, minL: 3, cr: 8, mp: 1, php: 18, hull: { k: 'ell', a: 44, b: 22 },
    ports: [P_(38, 0, 0, 0.5, 720, 'msl', 'Missile Tube'), P_(0, -22, -PI / 2, 1.3, 600, 'las', 'Port Cannon'), P_(0, 22, PI / 2, 1.3, 600, 'las', 'Starboard Cannon')] },
  { id: 'frigate', n: 'Frigate', sz: 2, r: 86, hp: 1, spd: 48, want: 540, minL: 6, cr: 16, mp: 1, php: 26, hull: { k: 'ell', a: 86, b: 30 },
    ports: [P_(84, 0, 0, 0.6, 540, 'flak', 'Bow Flak'), P_(30, -29, -PI / 2, 1.25, 640, 'las', 'Port Battery'), P_(30, 29, PI / 2, 1.25, 640, 'las', 'Starboard Battery'), P_(-40, -28, -PI / 2 - 0.5, 1.1, 640, 'las', 'Aft Port Cannon'), P_(-40, 28, PI / 2 + 0.5, 1.1, 640, 'las', 'Aft Starboard Cannon'), P_(-84, 0, PI, 0.9, 760, 'msl', 'Stern Missiles'), P_(-6, 30, PI / 2, 0, 0, 'dock', 'Hangar Bay', 3)] },
  { id: 'destroyer', n: 'Star Destroyer', sz: 3, r: 150, hp: 1, sh: 60, spd: 30, want: 600, minL: 10, cr: 30, mp: 1, php: 36, hull: { k: 'tri', p: [[150, 0], [-110, -80], [-110, 80]] },
    ports: [P_(140, 0, 0, 0.35, 700, 'ion', 'Ion Cannon'), P_(60, -38, -PI / 2 + 0.35, 1.1, 680, 'las', 'Port Fore Battery'), P_(60, 38, PI / 2 - 0.35, 1.1, 680, 'las', 'Starboard Fore Battery'), P_(-30, -62, -PI / 2 + 0.35, 1.2, 680, 'msl', 'Port Missile Bank'), P_(-30, 62, PI / 2 - 0.35, 1.2, 680, 'msl', 'Starboard Missile Bank'), P_(-106, -50, -PI + 0.5, 1.0, 560, 'flak', 'Port Aft Flak'), P_(-106, 50, PI - 0.5, 1.0, 560, 'flak', 'Starboard Aft Flak'), P_(-108, 0, PI, 0, 0, 'dock', 'Main Hangar', 5)] },
  { id: 'station', n: 'Battle Station', sz: 3, r: 150, hp: 1, sh: 60, spd: 0, want: 0, minL: 99, cr: 40, mp: 1, php: 40, hull: { k: 'circ', r: 140 },
    ports: STATION_W.map((w, k) => P_(Math.cos(k * PI / 4) * 146, Math.sin(k * PI / 4) * 146, k * PI / 4, 1.2, w === 'flak' ? 520 : w === 'msl' ? 700 : 620, w, 'Battery ' + (k + 1)))
      .concat([1, 5].map(k => P_(Math.cos(k * PI / 4 + PI / 8) * 146, Math.sin(k * PI / 4 + PI / 8) * 146, k * PI / 4 + PI / 8, 0, 0, 'dock', 'Hangar ' + (k === 1 ? 'A' : 'B'), 3))) },
  { id: 'rock', n: 'Asteroid', sz: 0, r: 34, hp: 18, spd: 0, want: 0, minL: 99, cr: 0 },
  { id: 'warden', n: 'Warden Shieldfighter', sz: 0, r: 18, hp: 10, sh: 10, spd: 130, want: 380, minL: 2, cr: 3, g: { w: 'las', arc: 0.4, rng: 560, n: 2 } },
  { id: 'lancer', n: 'Lancer Heavy Fighter', sz: 0, r: 20, hp: 16, spd: 120, want: 600, minL: 4, cr: 3, g: { w: 'ion', arc: 0.25, rng: 740, n: 1 } },
  { id: 'swarm', n: 'Swarm Drone', sz: 0, r: 10, hp: 4, spd: 190, want: 220, minL: 99, cr: 0, g: { w: 'las', arc: 0.5, rng: 420, n: 1 } },
  { id: 'corvette', n: 'Shield Corvette', sz: 1, r: 56, hp: 1, sh: 24, spd: 60, want: 520, minL: 4, cr: 10, mp: 1, php: 20, hull: { k: 'ell', a: 56, b: 20 },
    ports: [P_(54, 0, 0, 0.6, 650, 'las', 'Bow Laser'), P_(0, -20, -PI / 2, 1.3, 620, 'las', 'Port Laser'), P_(0, 20, PI / 2, 1.3, 620, 'las', 'Starboard Laser'), P_(-54, 0, PI, 1.0, 520, 'flak', 'Stern Flak')] },
  { id: 'mcruiser', n: 'Missile Cruiser', sz: 1, r: 64, hp: 1, spd: 55, want: 600, minL: 5, cr: 10, mp: 1, php: 22, hull: { k: 'ell', a: 64, b: 26 },
    ports: [P_(40, -20, -0.7, 1.0, 800, 'msl', 'Port Missile Rack'), P_(40, 20, 0.7, 1.0, 800, 'msl', 'Starboard Missile Rack'), P_(-16, -25, -PI / 2, 1.2, 620, 'las', 'Port Laser'), P_(-16, 25, PI / 2, 1.2, 620, 'las', 'Starboard Laser'), P_(-64, 0, PI, 0, 0, 'dock', 'Launch Bay', 2)] },
  { id: 'carrier', n: 'Carrier', sz: 2, r: 120, hp: 1, sh: 40, spd: 35, want: 650, minL: 7, cr: 22, mp: 1, php: 30, hull: { k: 'ell', a: 120, b: 44 },
    ports: [P_(118, 0, 0, 0.7, 700, 'las', 'Bow Laser'), P_(50, -40, -PI / 2, 1.1, 560, 'flak', 'Port Flak'), P_(50, 40, PI / 2, 1.1, 560, 'flak', 'Starboard Flak'), P_(-70, -36, -PI / 2, 1.2, 650, 'las', 'Aft Port Laser'), P_(-70, 36, PI / 2, 1.2, 650, 'las', 'Aft Starboard Laser'), P_(-10, -44, -PI / 2, 0, 0, 'dock', 'Port Hangar', 3), P_(-10, 44, PI / 2, 0, 0, 'dock', 'Starboard Hangar', 3)] },
  { id: 'dreadnought', n: 'Dreadnought', sz: 3, r: 200, hp: 1, sh: 90, spd: 22, want: 700, minL: 14, cr: 45, mp: 1, php: 44, hull: { k: 'tri', p: [[200, 0], [-150, -110], [-150, 110]] },
    ports: [P_(190, 0, 0, 0.35, 720, 'ion', 'Spinal Ion Lance'), P_(80, -36, -PI / 2 + 0.35, 1.1, 680, 'las', 'Port Fore Battery'), P_(80, 36, PI / 2 - 0.35, 1.1, 680, 'las', 'Starboard Fore Battery'), P_(0, -60, -PI / 2 + 0.35, 1.2, 700, 'msl', 'Port Missile Bank'), P_(0, 60, PI / 2 - 0.35, 1.2, 700, 'msl', 'Starboard Missile Bank'),
      P_(-90, -84, -PI / 2 - 0.4, 1.0, 560, 'flak', 'Port Flak Tower'), P_(-90, 84, PI / 2 + 0.4, 1.0, 560, 'flak', 'Starboard Flak Tower'), P_(-146, -50, PI, 0.9, 650, 'las', 'Port Stern Gun'), P_(-146, 50, PI, 0.9, 650, 'las', 'Starboard Stern Gun'), P_(-40, -72, -PI / 2, 0, 0, 'dock', 'Port Hangar', 4), P_(-40, 72, PI / 2, 0, 0, 'dock', 'Starboard Hangar', 4)] },
];
const PLANET_A = ['Kor', 'Vel', 'Tha', 'Ix', 'Mor', 'Zan', 'Dra', 'Cyr', 'Ul', 'Esk', 'Bes', 'Nar', 'Ord', 'Yav', 'Kes', 'Tal', 'Ryl', 'Sul', 'Ost', 'Mav'];
const PLANET_B = ['a', 'o', 'u', 'e', 'i', 'ae', 'ou', 'y'];
const PLANET_C = ['lis', 'thar', 'nox', 'ria', 'dor', 'vex', ' Prime', 'mir', 'ten', 'gar', 'phos', ' IV', ' VII', 'lune', 'kesh', 'tura', 'zan'];
const PLANET_K = ['rocky', 'ice', 'lava', 'ocean', 'gas', 'desert', 'toxic', 'jungle', 'storm', 'moon', 'ringed', 'city'];
const out = { VERSION, MONEY_MULT, RR_CFG, RR_NAMES, BOMB_CFG, ARENA, EFIRE_WEAK_LV, EFIRE_WEAK, REPAIR_CFG, ABS, ABSX, statLine, fxLines, ROLES, RNAME, RSHORT, PORT_NAMES, TREE_OF, NODE_COST, infCost, PORT_COST, portUpCost, PORT_MAX_LV, MK_COST, MK_NAMES, CORE_RATE, SHIELD_ARC0, SHIELD_ARC_MAX, SHIELD_DOWN,
  GEO, secIdx, FX, fxText, ABIL, INNATE, TREES, pyrAllowed, treeStats, infCap, BOT_PORTS, BOT_PATH, DIFFS, MTYPES, WEAP, ETYPES, PLANET_A, PLANET_B, PLANET_C, PLANET_K };
if (typeof module !== 'undefined' && module.exports) module.exports = out; else root.DEFS = out;
})(this);
