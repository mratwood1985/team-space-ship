// Spacebelts Optional v8: shared game data for the server (require) and the client (window.DEFS)
(function (root) {
const PI = Math.PI;
const VERSION = 8;
const ARENA = 4200;                       // half-size of the mission map (v4: was 3200)
const EFIRE_WEAK_LV = 5, EFIRE_WEAK = 0.6; // enemy fire does 60% damage on mission levels 1-5, full from level 6
const REPAIR_CFG = { base: 20, drone: 1.5, mgMax: 1.0, clickDiv: 300, botCps: 1.5 }; // repair: base seconds per section, drone-off speed multiplier, minigame max bonus, click strength on the Repair Bay
const MONEY_MULT = 1.1;                   // v5: about 10% more credits for everyone
// v5 power rerouting (Engineer): 10 slots in total over 4 options. Drain per second = base * DRAIN[slots used]; the generator regenerates `base` per second at the start (= exactly 1 slot).
const RR_CFG = { max: 10, base: 2.0, drain: [0, 1, 1.54, 1.82, 2.23, 2.77, 3.51, 4.46, 5.67, 7.29, 9.45], regenCap: 3.0, lock: 20, lockThr: 0.25,
  eng: 0.0225, acc: 0.12, wpn: 0.075, shd: 0.15, rep: 0.045, shHp: 0.15, shDr: 0.05 };   // v8: every filled square is 1.5x stronger but drains 1.35x more energy (see drain[]); Conduits / Efficient Routing / the Surge Coupler port improve the deal
   // v6: steeper drain curve (10 slots = 14/s). shd = recharge speed per slot; shHp = +max shield HP per slot; shDr = shield damage reduction per slot    // per slot: top speed, throttle response, gun fire rate, shield recharge speed, repair speed
const RR_NAMES = ['ENGINES', 'WEAPONS', 'SHIELDS', 'REPAIR'];
const ION_STUN = 3, ION_COST = 1.5, ION_CD = 7;   // v7: stun seconds; shield-player ion bolt: shield HP it costs, cooldown
const BOMB_CFG = { cd: 12, rad: 150, dmg: 10 };
const ROLES = ['pilot', 'gunR', 'repair', 'engineer', 'shield', 'gunL'];
const RNAME = ['PILOT', 'STARBOARD GUNNER', 'REPAIR / DRONE', 'ENGINEER', 'SHIELDS', 'PORT GUNNER'];
const RSHORT = ['PLT', 'GUN-S', 'RPR', 'ENG', 'SHD', 'GUN-P'];
const PORT_NAMES = ['Cockpit', 'Starboard Gun Turret', 'Repair Bay', 'Main Engines', 'Deflector Generator', 'Port Gun Turret'];
const TREE_OF = ['pilot', 'gun', 'repair', 'engineer', 'shield', 'gun'];

// ---------- economy (v3: progression over many missions) ----------
const NODE_COST = [60, 120, 220, 360, 560];          // pyramid row 1..5
const infCost = lv => 25 + 12 * lv;                   // limitless small upgrades
const PORT_COST = [250, 400, 750];                         // install a port in slot 1 (Mk II) / slot 2 (Mk III) / slot 3 (Mk IV, Elite)
const portUpCost = lv => 60 + 40 * lv;                // per-port upgrades: lv = total upgrade levels already bought on that port
const PORT_MAX_LV = 5;                                // v6: max level of EACH port upgrade option
const MK_COST = [0, 10, 22, 45];                      // Morph Metal (v7: Mk IV costs 45)
const MK_NAMES = ['Mk I Chimera Corvette', 'Mk II Gunship', 'Mk III Battlecruiser', 'Mk IV Leviathan'];
const HULL_PER_METAL = 1;                             // v7: after Mk IV each spare Morph Metal can be spent on +1 max hull (= 0.25 of a 4-hull-point 'section hit')
const ELITE = { eff: 1.6, per: 1.5, maxLv: 2, secHp: 1.5 };   // v7: the 4th (Mk IV) port is an Elite version: 1.6x effect, upgrades 1.5x stronger, +2 max levels, +1.5 section HP
const CORE_RATE = 15;                                 // after Mk IV: sell 1 Morph Metal -> 15 credits for every crew member (or spend it on +1 max hull)
const SHIELD_ARC0 = 15, SHIELD_ARC_MAX = 90, SHIELD_DOWN = 20;

// ---------- ship geometry per Mk (local coords, nose = +x, starboard = +y) ----------
// st: crew station sections (index = role). po[role][slot]: physical extra-port sections.
const GEO = [
  { hr: 30, sr: 70, len: 100, scale: 1, st: [[36, 0], [6, 22], [-20, 15], [-42, 0], [-20, -15], [6, -22]], po: [[], [], [], [], [], []] },
  { hr: 40, sr: 92, len: 140, scale: 1, st: [[54, 0], [14, 26], [-22, 20], [-48, 0], [-22, -20], [14, -26]],
    po: [[[32, 0]], [[-2, 42]], [[-42, 32]], [[-70, 0]], [[-42, -32]], [[-2, -42]]] },
  { hr: 52, sr: 114, len: 180, scale: 1, st: [[74, 0], [22, 30], [-28, 26], [-66, 0], [-28, -26], [22, -30]],
    po: [[[52, 0], [34, 0]], [[-4, 50], [40, 46]], [[-50, 40], [-72, 34]], [[-90, 16], [-90, -16]], [[-50, -40], [-72, -34]], [[-4, -50], [40, -46]]] },
  { hr: 62, sr: 138, len: 250, scale: 1, st: [[96, 0], [30, 38], [-34, 34], [-86, 0], [-34, -34], [30, -38]],
    po: [[[70, 0], [50, 0], [30, 0]], [[-4, 62], [52, 58], [24, 70]], [[-60, 50], [-90, 44], [-74, 62]], [[-112, 20], [-112, -20], [-124, 0]], [[-60, -50], [-90, -44], [-74, -62]], [[-4, -62], [52, -58], [24, -70]]] },
];
// section index: 0..5 = stations, 6 + role*2 + slot = extra ports 1-2, 18 + role = the 4th (Mk IV) port. 24 = the hull (repair target)
const NSEC = 24, HULL_T = 24;
const secIdx = (role, slot) => slot < 2 ? 6 + role * 2 + slot : 18 + role;
const secRole = k => k < 6 ? k : k < 18 ? (k - 6) >> 1 : k - 18, secSlot = k => k < 6 ? -1 : k < 18 ? (k - 6) & 1 : 2;
const secLocal = (G, k) => k < 6 ? G.st[k] : (G.po[secRole(k)][secSlot(k)] || G.st[secRole(k)]);

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
    ports: [['twin', 'Wing Cannon', 'A bright yellow laser cannon that fires with your nose gun'], ['rockets', 'Rocket Pod', 'A heavy yellow-glow rocket with every 4th nose shot'], ['scatter', 'Scatter Cannon', '5-bolt yellow spread every 1.2s while firing'],
      ['hmsl', 'Homing Missiles', 'Long-range fast yellow missiles fired 45° off the nose, alternating sides; they arc around and hit from behind'], ['pulse', 'Pulse Array', 'A rapid stream of light yellow pulses beside the nose gun'], ['lance', 'Lance Cannon', 'A slow, heavy yellow lance bolt that pierces everything in its path']] },
  gun: { name: 'Gunnery', rows: [
    [N('g_cells', 'Power Cells', { dmg: 0.2 }), N('g_cycle', 'Fast Cycler', { rof: 0.2 }), N('g_swivel', 'Swivel Mount', { slew: 0.3 }), N('g_long', 'Long Barrels', { range: 0.25 }), N('g_pd', 'Point Defense', { pd: 14 }), N('g_breaker', 'Shield Breaker', { sBreak: 0.5 })],
    [N('g_flak', 'Flak Screen', {}, 'flak'), N('g_lance', 'Lance Bolts', { pierce: 1 }), N('g_over', 'Overcharge', {}, 'overcharge'), N('g_wide', 'Wide Mount', { arcG: 25 }), N('g_paint', 'Target Paint', {}, 'paint')],
    [N('g_hot', 'Hot Barrels', { rof: 0.2, dmg: 0.1 }), N('g_mark', 'Marksman', { crit: 0.12 }), N('g_track', 'Tracking Computer', { slew: 0.3, range: 0.15 }), N('g_ion', 'Ion Rounds', { sBreak: 0.6, dmg: 0.1 })],
    [N('g_barrage', 'Barrage', {}, 'barrage'), N('g_dead', 'Deadeye', {}, 'deadeye'), N('g_supp', 'Suppressive Fire', {}, 'suppress')],
    [N('g_master', 'Gun Master', { dmg: 0.35, rof: 0.25, crit: 0.1 }), N('g_fort', 'Fortress Turret', { pd: 20, range: 0.3, pierce: 1, sBreak: 0.5 })]],
    inf: [['i_dmg', 'Coil Tuning', 'dmg', 0.03], ['i_rof', 'Cycler', 'rof', 0.02], ['i_rng', 'Barrel Lapping', 'range', 0.02]],
    big: [['b_armor', 'Armored Turret', 'Your turret section +1 HP', 450, 0, {}], ['b_twin', 'Twin-Linked Barrels', 'Every turret shot fires 2 bolts', 750, 1, {}]],
    ports: [['rockets', 'Rocket Turret', 'Slow homing red-glow rockets with splash, fire with your guns'], ['beam', 'Beam Turret', 'Continuous red beam: short range, ignores shot speed'], ['scatter', 'Scatter Turret', '5-bolt red spread, shorter range'], ['sniper', 'Sniper Turret', 'Slow, very fast, bright high-damage rail shot that pierces armor'], ['laser', 'Laser Cannon', 'Just another laser cannon, identical to your starting one'], ['flak', 'Flak Turret', 'Fast flak shells that burst in a wide cloud of shrapnel; great against fighter squadrons']] },
  engineer: { name: 'Engineering', rows: [
    [N('e_limp', 'Limp Mode', { limp: 0.35 }), N('e_turbine', 'Tuned Turbines', { speed: 0.12 }), N('e_reactor', 'Reactor Tuning', { regen: 0.3 }), N('e_conduit', 'Power Conduits', { pipEff: 0.3 }), N('e_caps', 'Capacitor Banks', { emax: 30 }), N('e_demo', 'Demolitions', { bombDmg: 0.3 })],
    [N('e_burn', 'Afterburner', {}, 'burner'), N('e_ram', 'Ram Plating', { ram: 1 }), N('e_bomb', 'Bomb Fuses', { bombCd: 0.2, bombRad: 0.15 }), N('e_relay', 'Quick Relays', { cdr: 0.15 }), N('e_ovl', 'Overload Relay', { pipEff: 0.25 })],
    [N('e_damp', 'Inertial Dampers', { burn: 1, speed: 0.08 }), N('e_split', 'Twin Bombs', { bombN: 1 }), N('e_cluster', 'Cluster Payload', { bombRad: 0.3, bombDmg: 0.2 }), N('e_fusion', 'Fusion Core', { regen: 0.3, emax: 20 })],
    [N('e_warp', 'Micro-Jump', {}, 'warp'), N('e_seismic', 'Seismic Charge', {}, 'seismic'), N('e_surge', 'Power Surge', {}, 'surge')],
    [N('e_hyper', 'Hyperdrive Core', { speed: 0.2, regen: 0.5, pipEff: 0.3 }), N('e_master', 'Master Engineer', { cdr: 0.25, buff: 3, bombDmg: 0.4 })]],
    inf: [['i_speed', 'Injector Tune', 'speed', 0.015], ['i_regen', 'Reactor Trim', 'regen', 0.03], ['i_bomb', 'Bomb Charges', 'bombDmg', 0.03]],
    big: [['b_armor', 'Armored Nacelles', 'Engine section +1 HP', 450, 0, {}], ['b_hyper', 'Hyper Reactor', '+40 generator capacity, +40% generator output', 800, 1, { emax: 40, regen: 0.4 }]],
    ports: [['mines', 'Mine Layer', 'Drops a proximity mine behind the ship every 3.5s'], ['tractor', 'Tractor Beam', 'Pulls credits and cores in from 2.5x farther'], ['aux', 'Aux Reactor', '+35% energy regen, +25 max energy'], ['surge', 'Surge Coupler', 'Rerouting squares get +20% stronger and drain 8% less energy'], ['flare', 'Flare Dispenser', 'Point defence: shoots down enemy missiles that come close, every few seconds'], ['boost', 'Booster Nozzles', '+12% top speed and faster throttle response']] },
  shield: { name: 'Shields', rows: [
    [N('s_hard', 'Hardened Field', { shHp: 2 }), N('s_emit', 'Fast Emitters', { shSpin: 0.4 }), N('s_absorb', 'Absorber', { absorb: 0.5 }), N('s_regen', 'Field Regen', { shRegen: 0.15 }), N('s_wide', 'Wide Emitter', { shArc: 10 }), N('s_mirror', 'Reflector Plating', { reflect: 0.1 })],
    [N('s_bubble', 'Barrier Bubble', {}, 'bubble'), N('s_layer', 'Layered Field', { shHp: 3 }), N('s_lance', 'Shield Lance', {}, 'lance'), N('s_settle', 'Quick Settle', { shRegen: 0.2 }), N('s_vent', 'Energy Vent', {}, 'vent')],
    [N('s_mirror2', 'Mirror Field', { reflect: 0.15 }), N('s_dense', 'Dense Field', { shHp: 3, shArc: 5 }), N('s_focus', 'Lance Focus', { lanceDmg: 0.5, shHp: 1 }), N('s_overflow', 'Overflow', { absorb: 0.4, shRegen: 0.1 })],
    [N('s_aegis', 'Aegis Link', {}, 'aegis'), N('s_nova', 'Nova Lance', {}, 'nova'), N('s_reboot', 'Emergency Reboot', {}, 'reboot')],
    [N('s_bastion', 'Bastion', { shHp: 6, shArc: 15, shRegen: 0.2 }), N('s_warden', 'Warden of the Fleet', { reflect: 0.25, lanceDmg: 1, buff: 3, shHp: 2 })]],
    inf: [['i_arc', 'Arc Emitter', 'shArc', 5], ['i_shp', 'Field Capacitor', 'shHp', 0.5], ['i_spin', 'Gyro Trim', 'shSpin', 0.03]],
    big: [['b_armor', 'Hardened Generator', 'Deflector section +1 HP', 450, 0, {}], ['b_cap', 'Capacitor Array', '+4 shield HP', 700, 1, { shHp: 4 }]],
    ports: [['rear', 'Rear Emitter', 'A second shield arc (60% width) always faces opposite yours'], ['reflect', 'Reflector Grid', '+25% chance blocked lasers bounce back as red bolts'], ['capbank', 'Capacitor Bank', '+3 shield HP and faster shield regen'], ['arclens', 'Arc Lens', 'The main shield arc is 25% wider'], ['ioncap', 'Ion Capacitor', 'Ion bolts cost less shield HP and recharge faster'], ['ablate', 'Ablative Plating', 'Hits that get through the shield do 15% less damage to the hull']] },
  repair: { name: 'Repair', rows: [
    [N('r_quick', 'Quick Hands', { rep: 0.25 }), N('r_dlaser', 'Drone Lasers', { dDmg: 0.3 }), N('r_welder', 'Hull Welder', { hullRegen: 0.03 }), N('r_kits', 'Field Kits', { selfPatch: 1 }), N('r_darmor', 'Drone Armor', { dHp: 3 }), N('r_magnet', 'Salvage Magnet', { magnet: 0.6 })],
    [N('r_nano', 'Nano Swarm', {}, 'nano'), N('r_band', 'Wide Tolerance', { band: 0.35 }), N('r_od', 'Drone Overdrive', {}, 'droneod'), N('r_emerg', 'Emergency Protocol', { emerg: 0.25 }), N('r_stim', 'Stim Shot', {}, 'stim')],
    [N('r_reinf', 'Reinforced Sections', { portHp: 1 }), N('r_twin', 'Twin Drone', { drones: 1 }), N('r_dmsl', 'Drone Missiles', { dMsl: 1, dDmg: 0.1 }), N('r_steady', 'Steady Hands', { rep: 0.2, band: 0.2 })],
    [N('r_restore', 'Restoration', {}, 'restore'), N('r_swarm', 'Drone Swarm', {}, 'swarm'), N('r_medic', 'Field Medic', {}, 'medic')],
    [N('r_chief', 'Chief Engineer', { rep: 0.5, hullRegen: 0.05, portHp: 1 }), N('r_cmdr', 'Drone Commander', { drones: 1, dDmg: 0.5, dRate: 0.5 })]],
    inf: [['i_rep', 'Better Tools', 'rep', 0.03], ['i_ddmg', 'Drone Coils', 'dDmg', 0.03], ['i_hreg', 'Nano Paste', 'hullRegen', 0.005]],
    big: [['b_armor', 'Armored Bay', 'Repair bay section +1 HP', 450, 0, {}], ['b_auto', 'Auto-Repair Matrix', 'Knocked-out sections slowly repair themselves', 800, 1, {}]],
    ports: [['drone2', 'Drone Hangar', 'An extra attack drone'], ['sdrone', 'Shield Drone Bay', 'A drone orbits the ship and blocks shots'], ['welder', 'Auto-Welder', 'Hull regenerates 3x faster'], ['nanites', 'Repair Nanites', 'All automatic repairs run 25% faster'], ['foam', 'Emergency Foam', 'Knocked-out sections restart with more HP'], ['magdr', 'Magnet Drones', 'Credits and cores are pulled in from 60% farther']] },
};
// v7: the 2nd and 4th node of pyramid row 2 give no ability, so they carry a small bonus on top of their stat
const ROW2_BONUS = { pilot: [{ graze: 0.04 }, { nRate: 0.06 }], gun: [{ dmg: 0.06 }, { rof: 0.06 }], engineer: [{ pipEff: 0.06 }, { bombCd: 0.08 }], shield: [{ shRegen: 0.06 }, { shHp: 1 }], repair: [{ dDmg: 0.08 }, { dHp: 1 }] };
for (const k in ROW2_BONUS) [1, 3].forEach((i, q) => { const nd = TREES[k].rows[1][i]; for (const f in ROW2_BONUS[k][q]) nd.fx[f] = +((nd.fx[f] || 0) + ROW2_BONUS[k][q][f]).toFixed(3); nd.sac = 1; });
const EDGE_BONUS = 1.25;
for (const k in TREES) TREES[k].rows.forEach((row, r) => row.forEach((nd, i) => {
  nd.edge = r < 4 && (i === 0 || i === row.length - 1);
  if (nd.edge) { for (const f in nd.fx) nd.fx[f] = +(nd.fx[f] * EDGE_BONUS).toFixed(3); if (nd.ab) nd.cdm = 0.8; }
  nd.cap = r === 4;
  nd.d = nd.ab ? 'ACTIVE [' + (r < 2 ? 'S' : 'D') + ']: ' + ABIL[nd.ab].d + '. CD ' + Math.round(ABIL[nd.ab].cd * (nd.cdm || 1)) + 's' + (nd.edge ? ' (edge: -20% cooldown)' : '') : fxText(nd.fx) + (nd.edge ? ' (edge bonus +25%)' : '') + (nd.sac ? ' · bonus for giving up an ability' : '');
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
  burn: { b: () => 2.5, u: ' s', d: 1 }, drones: { b: () => 1, u: '', d: 0 }, dHp: { b: () => 5, u: ' HP', d: 0 }, portHp: { b: () => 3, u: ' HP', d: 1 }, buff: { b: () => 5, u: ' s', d: 0 },
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

// ---------- v6 port upgrades: every port type has its own upgrade options (each up to PORT_MAX_LV levels) that change what that port does; Section HP is always one of them ----------
// t: pct = +x%, n = +x, cd = -x%, p = +x percentage points
const PU = (o, n, d, per, t, max) => ({ o, n, d, per, t: t || 'pct', max: max || 5 });
const PU_HP = PU('hp', 'Section HP', 'Tougher port section: +0.8 HP per level', 0.8, 'n');
const PORT_UPS = {
  'pilot.twin': [PU('dmg', 'Heavy Slugs', 'Wing cannon bolts hit harder', 0.18), PU('pierce', 'Piercing Rounds', 'Bolts punch through enemies', 1, 'n', 3), PU('barrels', 'Extra Barrel', 'Fires more bolts per shot', 1, 'n', 2), PU_HP],
  'pilot.rockets': [PU('dmg', 'Warheads', 'Rocket damage', 0.2), PU('loader', 'Quick Loader', 'Fewer nose shots between rockets', 1, 'n', 2), PU('seeker', 'Seeker Heads', 'Rockets curve toward enemies', 1, 'n', 3), PU_HP],
  'pilot.scatter': [PU('dmg', 'Hot Pellets', 'Scatter damage', 0.15), PU('range', 'Long Barrels', 'Pellets travel farther before they fade', 0.25), PU('fan', 'Wide Fan', 'Two more pellets per blast', 2, 'n', 2), PU('cycle', 'Quick Cycle', 'Shorter pause between blasts', 0.12, 'cd', 4), PU_HP],
  'gun.rockets': [PU('dmg', 'Warheads', 'Rocket damage', 0.2), PU('reload', 'Fast Reload', 'Shorter pause between rockets', 0.12, 'cd', 4), PU('blast', 'Big Blast', 'Larger splash radius', 0.2), PU_HP],
  'gun.beam': [PU('dmg', 'Hot Lens', 'Beam damage per second', 0.2), PU('range', 'Long Focus', 'Beam reaches farther', 0.15), PU('cutter', 'Shield Cutter', 'Extra damage to enemy shields', 0.3), PU_HP],
  'gun.scatter': [PU('dmg', 'Hot Pellets', 'Scatter damage', 0.15), PU('range', 'Long Barrels', 'Pellets travel farther before they fade', 0.25), PU('fan', 'Wide Fan', 'Two more pellets per blast', 2, 'n', 2), PU('cycle', 'Quick Cycle', 'Shorter pause between blasts', 0.12, 'cd', 4), PU_HP],
  'gun.sniper': [PU('dmg', 'Hollow-Point', 'Sniper shot damage', 0.25), PU('reload', 'Fast Bolt Action', 'Shorter pause between shots', 0.08, 'cd'), PU('pierce', 'Rail Piercing', 'The shot passes through more enemies', 1, 'n', 3), PU('crit', 'Deadeye Optics', 'Chance for a double-damage shot', 0.1, 'p'), PU_HP],
  'gun.laser': [PU('dmg', 'Power Cells', 'Laser cannon damage', 0.15), PU('rof', 'Overclock', 'Laser cannon fire rate', 0.12), PU('twin', 'Twin Link', 'Fires a second parallel bolt', 1, 'n', 1), PU('range', 'Long Barrel', 'Bolts fly farther', 0.15), PU_HP],
  'engineer.mines': [PU('dmg', 'Heavy Charge', 'Mine damage', 0.25), PU('rate', 'Rapid Layer', 'Mines are dropped more often', 0.1, 'cd'), PU('life', 'Long Fuse', 'Mines stay armed longer', 0.3), PU_HP],
  'engineer.tractor': [PU('range', 'Wide Beam', 'Pull range for credits and cores', 0.3), PU('salvage', 'Salvage Rights', 'More credits from every pickup', 0.06), PU_HP],
  'engineer.aux': [PU('regen', 'Reactor Boost', 'Power generator output', 0.12), PU('cap', 'Capacitors', 'Bigger energy store', 10, 'n'), PU('eff', 'Efficient Routing', 'Every rerouting slot drains less', 0.04, 'cd'), PU_HP],
  'shield.rear': [PU('width', 'Wide Rear Arc', 'The rear arc covers more angle', 0.12), PU('guard', 'Rear Plating', 'More shield HP', 0.8, 'n'), PU_HP],
  'shield.reflect': [PU('chance', 'Mirror Grid', 'More blocked lasers bounce back', 0.08, 'p'), PU('rdmg', 'Hot Reflect', 'Reflected bolts hit harder', 0.3), PU_HP],
  'shield.capbank': [PU('cap', 'Bigger Bank', 'More shield HP', 0.8, 'n'), PU('regen', 'Trickle Charger', 'Shield HP/s regeneration', 0.1, 'n'), PU('reset', 'Quick Reset', 'Shield comes back sooner after going down', 0.06, 'cd'), PU_HP],
  'repair.drone2': [PU('dmg', 'Pulse Cells', 'All drones hit harder', 0.15), PU('plating', 'Armor Plating', 'More drone armor', 1, 'n'), PU('thrust', 'Thrusters', 'Faster drones', 0.08), PU_HP],
  'repair.sdrone': [PU('armor', 'Bulwark', 'The shield drone takes more hits', 1, 'n'), PU('respawn', 'Fast Respawn', 'It returns sooner after being shot down', 0.12, 'cd'), PU_HP],
  'pilot.hmsl': [PU('dmg', 'Shaped Charge', 'Missile damage', 0.2), PU('reload', 'Quick Racks', 'Shorter pause between missiles', 0.1, 'cd', 4), PU('turn', 'Vectored Fins', 'Missiles turn harder', 0.12), PU('range', 'Fuel Tanks', 'Missiles fly farther', 0.2), PU_HP],
  'pilot.pulse': [PU('dmg', 'Hot Pulses', 'Pulse damage', 0.2), PU('rate', 'Fast Cycler', 'Faster pulse fire', 0.12), PU('range', 'Long Pulses', 'Pulses fly farther', 0.15), PU_HP],
  'pilot.lance': [PU('dmg', 'Plasma Lance', 'Lance damage', 0.2), PU('rate', 'Quick Charge', 'Shorter pause between lances', 0.1, 'cd', 4), PU('pierce', 'Deep Lance', 'Pierces more targets', 1, 'n', 3), PU_HP],
  'gun.flak': [PU('dmg', 'Dense Shrapnel', 'Flak damage', 0.18), PU('reload', 'Autoloader', 'Shorter pause between shells', 0.1, 'cd', 4), PU('blast', 'Wide Burst', 'Larger burst radius', 0.15), PU('range', 'Long Fuse', 'Shells fly farther', 0.15), PU_HP],
  'engineer.surge': [PU('str', 'Stronger Coupling', 'Rerouting squares are stronger', 0.1), PU('eff', 'Heat Exchanger', 'Rerouting squares drain less energy', 0.03, 'cd'), PU_HP],
  'engineer.flare': [PU('rate', 'Fast Reload', 'Flares are dispensed more often', 0.1, 'cd', 4), PU('range', 'Wide Cloud', 'Larger point-defence radius', 0.15), PU_HP],
  'engineer.boost': [PU('speed', 'Hot Nozzles', 'Even more top speed', 0.04), PU('burn', 'Afterburn Mix', 'Afterburner and throttle changes are punchier', 0.1), PU_HP],
  'shield.arclens': [PU('width', 'Wider Lens', 'The main arc gets still wider', 0.1), PU('focus', 'Focus Crystals', 'More shield HP', 0.6, 'n'), PU_HP],
  'shield.ioncap': [PU('cost', 'Efficient Ions', 'Ion bolts cost less shield HP', 0.12, 'cd', 4), PU('cd', 'Fast Capacitors', 'Ion bolts recharge faster', 0.08, 'cd', 4), PU_HP],
  'shield.ablate': [PU('soak', 'Thicker Plating', 'Even less hull damage', 0.04), PU('shock', 'Shock Layer', 'More shield damage reduction', 0.04), PU_HP],
  'repair.nanites': [PU('speed', 'Swarm Size', 'Repairs run faster', 0.06), PU('hull', 'Hull Nanites', 'Hull regeneration', 0.2), PU_HP],
  'repair.foam': [PU('restart', 'Dense Foam', 'Restarted sections come back with more HP', 0.06, 'p'), PU('heal', 'Foam Mist', 'Damaged sections heal a little over time', 0.01, 'n'), PU_HP],
  'repair.magdr': [PU('range', 'Strong Magnets', 'Pickup range', 0.2), PU('salvage', 'Salvage Rights', 'More credits from every pickup', 0.05), PU_HP],
  'repair.welder': [PU('hull', 'Hull Weld', 'Hull regeneration', 0.3), PU('mend', 'Nanite Mist', 'Every damaged section slowly heals itself', 0.02, 'n'), PU_HP],
};
function puVal(def, lv) { const v = def.per * lv; if (def.t === 'pct' || def.t === 'p') return '+' + Math.round(v * 100) + '%'; if (def.t === 'cd') return '-' + Math.round(v * 100) + '%'; return '+' + (+v.toFixed(2)); }

// v8: each extra-port slot (Port 1 / Port 2 / Port 3) offers its OWN pair of choices, with no repeats across a role's three slots
const PORT_SLOTS = { pilot: [['twin', 'hmsl'], ['rockets', 'pulse'], ['scatter', 'lance']], gun: [['laser', 'sniper'], ['rockets', 'beam'], ['scatter', 'flak']], engineer: [['mines', 'surge'], ['tractor', 'flare'], ['aux', 'boost']], shield: [['rear', 'arclens'], ['reflect', 'ioncap'], ['capbank', 'ablate']], repair: [['drone2', 'nanites'], ['sdrone', 'foam'], ['welder', 'magdr']] };
const BOT_PORTS = [['twin', 'rockets', 'scatter'], ['sniper', 'beam', 'scatter'], ['drone2', 'sdrone', 'welder'], ['mines', 'tractor', 'aux'], ['rear', 'reflect', 'capbank'], ['laser', 'rockets', 'scatter']];
const BOT_PATH = { pilot: [3, 2, 2, 1, 1], gun: [1, 1, 1, 1, 0], engineer: [2, 2, 1, 1, 0], shield: [1, 1, 1, 1, 0], repair: [0, 0, 0, 0, 0] };
const DIFFS = [{ n: 'EASY', lv: -1, m: 0.8 }, { n: 'NORMAL', lv: 0, m: 1 }, { n: 'HARD', lv: 2, m: 1.45 }, { n: 'ELITE', lv: 4, m: 2 }];
const MTYPES = {
  pirates: { n: 'Eliminate the Pirates', d: 'Destroy every pirate wave' },
  hostages: { n: 'Rescue the Hostages', d: 'Fly over each hostage pod to tow it to safety. Don\'t let them be destroyed' },
  escort: { n: 'Escort the Convoy', d: 'Keep the freighters alive until they reach the jump point' },
  station: { n: 'Destroy the Enemy Station', d: 'Break its shield, knock out every battery and hangar, then clear the area' },
  defend: { n: 'Defend the Station', d: 'Hold off the waves attacking the friendly station' },
  passengers: { n: 'Passenger Run', d: 'Thread the long asteroid field to the far end, pick up the passengers and bring them back to the start' },
  survival: { n: 'Last Stand', d: 'Level 10+: hold out against endless, growing waves until the timer runs out', adv: 1 },
  bombrun: { n: 'Kamikaze Swarm', d: 'Level 10+: bomb ships pour in from every edge. Shoot them down before they ram you', adv: 1 },
  siege: { n: 'Twin Fortress Siege', d: 'Level 10+: two enemy battle stations. Break both shields, silence every battery and hangar', adv: 1 },
  flagship: { n: 'Flagship Assault', d: 'Fight through the escorts, then destroy every port on the flagship' },
  wellstation: { n: 'Gravity Trap', d: 'Destroy the enemy station ringed by gravity wells. Wells swallow missiles, mines, bombs and drones, but lasers and ships fly straight through', minL: 3 },
  defend2: { n: 'Twin Outposts', d: 'Defend two friendly stations at opposite ends of the map. Lose either one and the mission fails', minL: 2 },
  finale: { n: 'The Drowned Throne', d: 'Final battle: destroy every hard-point of Szarkath\'s flagship. Expect ion bolts, three phases and no mercy', adv: 1, story: 1 },
};
// enemy weapons. ALL enemy fire glows neon green. t: 0 laser, 1 missile, 2 flak. sd = damage to the player shield
const WEAP = {
  las: { cd: 2.4, spd: 380, t: 0, r: 5, life: 2.2, sd: 1 },
  msl: { cd: 4.6, spd: 180, t: 1, r: 7, home: 1.4, life: 5, sd: 2 },
  flak: { cd: 3.2, spd: 300, t: 2, r: 5, n: 4, spread: 0.28, life: 1.8, sd: 0.6 },
  ion: { cd: 10, spd: 400, t: 3, r: 12, heavy: 1, charge: 1.1, life: 4.2, sd: 7 },   // v7 ION BOLT: blue, medium speed, long range (~1700 px), very slow fire; a hit stuns for ION_STUN s and rapidly drains shields
  pion: { cd: 7, spd: 560, life: 2.6, sd: 0 },
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
  { id: 'kamikaze', n: 'Kamikaze Bomb Ship', sz: 0, r: 17, hp: 11, spd: 150, want: 0, minL: 6, cr: 3 },
  // v7 FINAL BOSS (index 19, appended): Szarkath's flagship. v8: HUGE (sc 2.1 = 500px radius) with 33 hard-points: batteries, flak towers, missile vaults, docks that keep launching ships, three phases (see server finale logic)
  { id: 'overlord', n: 'The Drowned Throne', sz: 3, r: 240, sc: 2.1, hp: 1, sh: 420, spd: 24, want: 780, minL: 99, cr: 300, mp: 1, php: 42, hull: { k: 'tri', p: [[250, 0], [-190, -150], [-190, 150]] },
    ports: [P_(240, 0, 0, 0.3, 900, 'ion', 'Drowned Lance'), P_(110, -46, -PI / 2 + 0.35, 1.1, 720, 'las', 'Port Fore Battery'), P_(110, 46, PI / 2 - 0.35, 1.1, 720, 'las', 'Starboard Fore Battery'),
      P_(30, -80, -PI / 2 + 0.3, 1.2, 740, 'msl', 'Port Missile Bank'), P_(30, 80, PI / 2 - 0.3, 1.2, 740, 'msl', 'Starboard Missile Bank'), P_(-40, -104, -PI / 2, 1.2, 700, 'las', 'Port Mid Battery'), P_(-40, 104, PI / 2, 1.2, 700, 'las', 'Starboard Mid Battery'),
      P_(-110, -120, -PI / 2 - 0.4, 1.0, 580, 'flak', 'Port Flak Tower'), P_(-110, 120, PI / 2 + 0.4, 1.0, 580, 'flak', 'Starboard Flak Tower'), P_(-182, -60, PI, 0.9, 680, 'las', 'Port Stern Gun'), P_(-182, 60, PI, 0.9, 680, 'las', 'Starboard Stern Gun'),
      P_(-90, -40, -PI / 2, 0, 0, 'dock', 'Port Tide Hangar', 4), P_(-90, 40, PI / 2, 0, 0, 'dock', 'Starboard Tide Hangar', 4), P_(-30, 0, 0, 1.4, 760, 'flak', 'Throne Flak'),
      // v8 additions
      P_(176, -26, -0.5, 0.9, 700, 'las', 'Lance Guard Port'), P_(176, 26, 0.5, 0.9, 700, 'las', 'Lance Guard Starboard'),
      P_(70, -58, -PI / 2 + 0.2, 1.1, 560, 'flak', 'Port Fore Flak'), P_(70, 58, PI / 2 - 0.2, 1.1, 560, 'flak', 'Starboard Fore Flak'),
      P_(-60, -70, -PI / 2 + 0.5, 1.2, 760, 'msl', 'Port Inner Missile Rack'), P_(-60, 70, PI / 2 - 0.5, 1.2, 760, 'msl', 'Starboard Inner Missile Rack'),
      P_(-150, -112, -PI / 2 - 0.3, 1.1, 680, 'las', 'Port Rear Battery'), P_(-150, 112, PI / 2 + 0.3, 1.1, 680, 'las', 'Starboard Rear Battery'),
      P_(-132, -30, PI - 0.5, 1.0, 560, 'flak', 'Port Engine Flak'), P_(-132, 30, -PI + 0.5, 1.0, 560, 'flak', 'Starboard Engine Flak'),
      P_(-188, 0, PI, 1.0, 700, 'las', 'Tail Gun'), P_(-128, 0, PI, 1.1, 780, 'msl', 'Rear Missile Vault'), P_(-62, 0, 0, 1.2, 820, 'las', 'Core Battery'),
      P_(22, -24, -0.4, 1.1, 640, 'las', 'Port Bridge Gun'), P_(22, 24, 0.4, 1.1, 640, 'las', 'Starboard Bridge Gun'),
      P_(-150, -66, -PI / 2, 0, 0, 'dock', 'Port Drowned Hangar', 4), P_(-150, 66, PI / 2, 0, 0, 'dock', 'Starboard Drowned Hangar', 4),
      P_(-10, -58, -PI / 2, 1.2, 700, 'las', 'Port Gallery Gun'), P_(-10, 58, PI / 2, 1.2, 700, 'las', 'Starboard Gallery Gun')] },
  // v8 SPACE STATION VARIETY (indices 20-23). Every enemy station type is listed in STATION_TYPES (index 9 is the original round Battle Station)
  { id: 'rockfort', n: 'Rock Fortress', sz: 3, r: 190, hp: 1, sh: 60, spd: 0, want: 0, minL: 99, cr: 40, mp: 1, php: 40, hull: { k: 'circ', r: 168 }, look: 'rock',
    ports: [[0.1, 160, 'las'], [0.95, 150, 'msl'], [1.75, 165, 'flak'], [2.55, 150, 'ion'], [3.35, 160, 'las'], [4.15, 150, 'msl'], [4.95, 165, 'las'], [5.65, 150, 'flak']].map(([a, d, w], k) => P_(Math.cos(a) * d, Math.sin(a) * d, a, 1.2, w === 'flak' ? 520 : w === 'msl' ? 700 : 640, w, 'Rock Battery ' + (k + 1)))
      .concat([[1.35, 150], [4.55, 150]].map(([a, d], k) => P_(Math.cos(a) * d, Math.sin(a) * d, a, 0, 0, 'dock', 'Cave Hangar ' + 'AB'[k], 3))) },
  { id: 'ringstation', n: 'Halo Ring Station', sz: 3, r: 175, hp: 1, sh: 60, spd: 0, want: 0, minL: 99, cr: 40, mp: 1, php: 40, hull: { k: 'circ', r: 160 }, look: 'ring',
    ports: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => { const a = k * PI / 5, w = ['las', 'flak', 'msl', 'las', 'ion', 'las', 'flak', 'msl', 'las', 'flak'][k]; return P_(Math.cos(a) * 158, Math.sin(a) * 158, a, 1.2, w === 'flak' ? 520 : w === 'msl' ? 700 : 620, w, 'Ring Battery ' + (k + 1)); })
      .concat([0.5, 2.6, 4.1].map((a, k) => P_(Math.cos(a) * 158, Math.sin(a) * 158, a, 0, 0, 'dock', 'Ring Dock ' + 'ABC'[k], 3))) },
  { id: 'crossstation', n: 'Cross Citadel', sz: 3, r: 215, hp: 1, sh: 60, spd: 0, want: 0, minL: 99, cr: 40, mp: 1, php: 40, look: 'cross',
    hull: { k: 'poly', p: [[200, -40], [40, -40], [40, -200], [-40, -200], [-40, -40], [-200, -40], [-200, 40], [-40, 40], [-40, 200], [40, 200], [40, 40], [200, 40]] },
    ports: [P_(204, 0, 0, 1.1, 700, 'msl', 'East Missiles'), P_(0, -204, -PI / 2, 1.1, 720, 'ion', 'North Ion'), P_(-204, 0, PI, 1.1, 700, 'msl', 'West Missiles'), P_(0, 204, PI / 2, 1.1, 620, 'las', 'South Laser'),
      P_(120, -42, -PI / 2, 1.2, 620, 'las', 'East Port Laser'), P_(120, 42, PI / 2, 1.2, 620, 'las', 'East Starboard Laser'), P_(-120, -42, -PI / 2, 1.2, 620, 'flak', 'West Port Flak'), P_(-120, 42, PI / 2, 1.2, 620, 'flak', 'West Starboard Flak'),
      P_(-42, -120, PI, 1.2, 520, 'flak', 'North Port Flak'), P_(42, -120, 0, 1.2, 620, 'las', 'North Starboard Laser'), P_(-42, 120, PI, 1.2, 620, 'las', 'South Port Laser'), P_(42, 120, 0, 1.2, 520, 'flak', 'South Starboard Flak'),
      P_(0, 0, 0, 0, 0, 'dock', 'Central Hangar', 4), P_(-170, 0, PI, 0, 0, 'dock', 'West Hangar', 3)] },
  { id: 'spindle', n: 'Spindle Platform', sz: 3, r: 205, hp: 1, sh: 60, spd: 0, want: 0, minL: 99, cr: 40, mp: 1, php: 40, hull: { k: 'ell', a: 195, b: 64 }, look: 'spindle',
    ports: [P_(196, 0, 0, 1.0, 780, 'ion', 'Bow Ion'), P_(-196, 0, PI, 1.0, 700, 'msl', 'Stern Missiles'), P_(120, -60, -PI / 2, 1.2, 640, 'las', 'Fore Port Laser'), P_(120, 60, PI / 2, 1.2, 640, 'las', 'Fore Starboard Laser'),
      P_(0, -64, -PI / 2, 1.2, 520, 'flak', 'Mid Port Flak'), P_(0, 64, PI / 2, 1.2, 520, 'flak', 'Mid Starboard Flak'), P_(-120, -60, -PI / 2, 1.2, 700, 'msl', 'Aft Port Missiles'), P_(-120, 60, PI / 2, 1.2, 700, 'msl', 'Aft Starboard Missiles'),
      P_(60, 0, 0, 1.3, 620, 'las', 'Spine Laser'), P_(-60, 0, PI, 1.3, 620, 'las', 'Spine Laser Aft'), P_(60, -38, -PI / 2, 0, 0, 'dock', 'Port Dock', 3), P_(-60, 38, PI / 2, 0, 0, 'dock', 'Starboard Dock', 3)] },
];
const STATION_TYPES = [9, 20, 21, 22, 23];
const isStation = t => STATION_TYPES.includes(t);
// v8 hazards: zones are circles. Radiation burns the hull (hull points per second); cold slows the ship; gravity wells (aoe radius R, deadly core) swallow physical projectiles only
const HAZ = { rad: { n: 'Radioactive cloud', dps: 0.6, col: '120,255,60' }, cold: { n: 'Cold nebula', slow: 0.42, col: '110,200,255' } };
const WELL = { R: 300, core: 26, pull: 640 };
const PLANET_A = ['Kor', 'Vel', 'Tha', 'Ix', 'Mor', 'Zan', 'Dra', 'Cyr', 'Ul', 'Esk', 'Bes', 'Nar', 'Ord', 'Yav', 'Kes', 'Tal', 'Ryl', 'Sul', 'Ost', 'Mav'];
const PLANET_B = ['a', 'o', 'u', 'e', 'i', 'ae', 'ou', 'y'];
const PLANET_C = ['lis', 'thar', 'nox', 'ria', 'dor', 'vex', ' Prime', 'mir', 'ten', 'gar', 'phos', ' IV', ' VII', 'lune', 'kesh', 'tura', 'zan'];
const PLANET_K = ['rocky', 'ice', 'lava', 'ocean', 'gas', 'desert', 'toxic', 'jungle', 'storm', 'moon', 'ringed', 'city'];
const out = { ION_STUN, ION_COST, ION_CD, NSEC, HULL_T, secRole, secSlot, secLocal, HULL_PER_METAL, ELITE, PORT_UPS, PU_HP, PORT_SLOTS, STATION_TYPES, isStation, HAZ, WELL, puVal, VERSION, MONEY_MULT, RR_CFG, RR_NAMES, BOMB_CFG, ARENA, EFIRE_WEAK_LV, EFIRE_WEAK, REPAIR_CFG, ABS, ABSX, statLine, fxLines, ROLES, RNAME, RSHORT, PORT_NAMES, TREE_OF, NODE_COST, infCost, PORT_COST, portUpCost, PORT_MAX_LV, MK_COST, MK_NAMES, CORE_RATE, SHIELD_ARC0, SHIELD_ARC_MAX, SHIELD_DOWN,
  GEO, secIdx, FX, fxText, ABIL, INNATE, TREES, pyrAllowed, treeStats, infCap, BOT_PORTS, BOT_PATH, DIFFS, MTYPES, WEAP, ETYPES, PLANET_A, PLANET_B, PLANET_C, PLANET_K };
if (typeof module !== 'undefined' && module.exports) module.exports = out; else root.DEFS = out;
})(this);
