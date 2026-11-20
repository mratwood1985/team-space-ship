// prints the voiced line manifest [{id, voice, text}] from story.js / defs.js (the client uses the same ids: see voiceId helpers in game.js)
const S = require('../public/story.js'), D = require('../public/defs.js');
const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const L = [];
// v8: the repair crew no longer announces destroyed ports by voice (a text feed on the left of the screen does that); the pilot explains each hazard zone type once
for (const k of ['rad', 'cold', 'well']) L.push({ id: 'pz_' + k, who: 'skids', text: S.ZONE_LINES[k] });
S.FINN_VAR.half.forEach((t, i) => L.push({ id: 'finn_half_' + i, who: 'finn', text: t }));   // v9 variants
S.FINN_VAR.low.forEach((t, i) => L.push({ id: 'finn_low_' + i, who: 'finn', text: t }));
L.push({ id: 'mort_thr', who: 'mort', text: S.THR_TIP });
S.TAUNTS.forEach((t, i) => L.push({ id: 'vt' + i, who: 'szarkath', text: t }));
S.SENDS.forEach((t, i) => L.push({ id: 'vs' + i, who: 'szarkath', text: t }));
for (const k of ['open', 'p2', 'p3', 'kill']) L.push({ id: 'vb_' + k, who: 'szarkath', text: S.BOSS_LINES[k] });
const dots = t => t.replace(/\.\.\./g, '... ');
for (const who of ['kraal', 'durmok', 'grakk', 'sskarra']) { L.push({ id: 'ci_' + who, who, text: S.CMD_INTRO[S.CMD_INTRO_BY[who]] }); L.push({ id: 'cd_' + who, who, text: dots(S.CMD_DEATH[S.CMD_DEATH_BY[who]]) }); }
S.CMD_INTRO.forEach((t, i) => L.push({ id: 'ci_lt' + i, who: 'lt', text: t })); S.CMD_DEATH.forEach((t, i) => L.push({ id: 'cd_lt' + i, who: 'lt', text: dots(t) }));
for (const [id, who, text] of S.csLines()) if (text.length <= S.VOICE_MAX) L.push({ id, who, text: dots(text) });   // short cutscene lines only
S.CAT_COMMS.forEach((c, i) => L.push({ id: 'cat' + i, who: c[0], text: c[1] }));
S.CARE_VAR.forEach((t, i) => L.push({ id: 'cat_care_' + i, who: 'tavi', text: t }));
console.log(JSON.stringify(L));
