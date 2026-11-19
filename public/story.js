// Spacebelts Optional v7: cast, story and dialogue (shared by the server (require) and the client (window.STORY)). Text only: the server sends compact event ids.
(function (root) {
const TITLE = 'Spacebelts Optional';
const TAGLINE = 'Six crew members. An unknown sector. Zero safety standards. Let\u2019s do this\u2014what could possibly go wrong?';
const SHIP = 'Voided Warranty';
// crew in ROLES order: pilot, gunR, repair, engineer, shield, gunL
const CREW = [
  { id: 'skids', name: 'Skids Vantail', role: 'PILOT', animal: 'Red Flying Squirrel', sex: 'F', col: '#ff9a4a', img: 'skids', blurb: 'Steers with the mouse, fires the nose laser and calls the big plays. Ex-courier pilot whose licence was revoked for \u201Ccreative interpretation of traffic law\u201D. Talks faster than she flies.' },
  { id: 'boomer', name: 'Boomer Hopkins', role: 'STARBOARD GUNNER', animal: 'Kangaroo', sex: 'M', col: '#e0a060', img: 'boomer', blurb: 'Aims the starboard turret (red bolts). Demolitions contractor fired for \u201Cunsolicited demolition\u201D. Believes every problem is a smaller problem after an explosion.' },
  { id: 'finn', name: 'Finn Halloran', role: 'REPAIR / DRONE', animal: 'Arctic Fox', sex: 'M', col: '#9fe8ff', img: 'finn', blurb: 'Fixes sections and hull, flies the attack drones, and announces every disaster in the same calm voice. Discharged medic who once patched a general\u2019s flagship with the general\u2019s own jacket.' },
  { id: 'mort', name: 'Mort Gazewell', role: 'ENGINEER', animal: 'Basilisk Lizard', sex: 'M', col: '#7fe07f', img: 'mort', blurb: 'Throttle, power rerouting and bombs. Reactor inspector sacked after \u201Cthe incident\u201D. Wears goggles so he does not petrify the equipment. Talks to the reactor. It sometimes answers.' },
  { id: 'ophelia', name: 'Ophelia Quill', role: 'SHIELDS', animal: 'Owl', sex: 'F', col: '#d9b38a', img: 'ophelia', blurb: 'Sweeps the shield and now fires ion bolts. Academy valedictorian dismissed for \u201Cexcessive caution\u201D and a 400-page safety report. Is the only one who read the manual. Nobody else has.' },
  { id: 'ember', name: 'Ember Ashmaw', role: 'PORT GUNNER', animal: 'Dragon', sex: 'F', col: '#ff6a4a', img: 'ember', blurb: 'Aims the port turret (orange bolts). Retired arena gladiator, banned from three arenas for \u201Cexcess enthusiasm\u201D. Sarcastic, short-tempered and absolutely thrilled to be here.' },
];
const RACES = {
  vorrakh: { name: 'The Vorrakh', blurb: 'Anthropomorphic crocodiles. A conquering war-clan fleet that has the galactic center burning and now raids the Hollow Reach. Ruled by an ancient king who has not been seen in ten thousand years.' },
  mireth: { name: 'The Mireth', blurb: 'Anthropomorphic desert cats, the natives of the Hollow Reach. Star-weavers who invented Morph Metal, the living alloy that remembers the shapes it wants to be.' },
};
// named croc commanders (portraits) + lieutenants (no portrait)
const CMDRS = [
  { id: 'kraal', name: 'Kraal Skullchain', title: 'Raider King', img: 'kraal' },
  { id: 'durmok', name: 'Durmok the Veiled', title: 'Station Warden', img: 'durmok' },
  { id: 'grakk', name: 'Grakk Ironjaw', title: 'Warlord', img: 'grakk' },
  { id: 'sskarra', name: 'Admiral Sskarra Venomtongue', title: 'Fleet Admiral', img: 'sskarra' },
];
const LTS = ['Lt. Skrill', 'Lt. Thessk', 'Lt. Vorg', 'Lt. Nass', 'Lt. Ruk', 'Lt. Skarn', 'Lt. Brisk'];   // commander index 5..11
const cmdInfo = i => i >= 1 && i <= 4 ? CMDRS[i - 1] : i >= 5 ? { id: 'lt', name: LTS[(i - 5) % LTS.length], title: 'Vorrakh Lieutenant', img: '' } : null;
const VILLAIN = { id: 'szarkath', name: 'Szarkath, the Drowned King', img: 'szarkath', col: '#4dffb0' };
const CATS = { ishkara: { id: 'ishkara', name: 'Ishkara', title: 'Mireth Star-Weaver', img: 'ishkara', col: '#c9a0ff' }, tavi: { id: 'tavi', name: 'Tavi', title: 'Mireth Scout', img: 'tavi', col: '#ffb860' } };
const WHO = {};
for (const c of CREW) WHO[c.id] = { name: c.name.split(' ')[0], img: c.img, col: c.col };
for (const c of CMDRS) WHO[c.id] = { name: c.name, img: c.img, col: '#ff7a5a' };
WHO.szarkath = { name: VILLAIN.name, img: 'szarkath', col: VILLAIN.col };
WHO.ishkara = { name: 'Ishkara', img: 'ishkara', col: CATS.ishkara.col }; WHO.tavi = { name: 'Tavi', img: 'tavi', col: CATS.tavi.col };
WHO.cmd = { name: 'Command', img: '', col: '#9ab' };
// commander ships per chapter: cmd index, ship type (ETYPES index), spawn time (s). Big ships that spawn on their own are named from `roster`.
const CHAPTERS = [null,
 { n: 1, title: 'Terms and Conditions', type: 'pirates', cs: { cmd: 5, type: 6, t: 16 }, roster: [5],
   pre: [['cmd', 'Spacebelts Optional crew, you have your cruiser. Do not scratch it. The Chimera-class shift cruiser is on loan for one job: find out what is hiding in the Hollow Reach.'], ['skids', 'It is gorgeous. I am naming her the Voided Warranty. Mort already voided the warranty. Just now. With a wrench.'], ['mort', 'In my defence, she was making a sound.'], ['ophelia', 'There is a hostile fleet on the scopes. Pirates. Vorrakh crocodiles. I did not read about them in the briefing, which means nobody wrote a briefing.'], ['ember', 'Good. I have been awake for four hours without hitting anything.']],
   post: [['boomer', 'That is how it is done. Two seconds of explosions, zero seconds of paperwork.'], ['finn', 'Hull is at four percent of the ugly, which is the good part. Nobody else is bleeding.'], ['szarkath', 'Little ship. Little crew. Little mistake. Come further in.'], ['skids', 'Was that the radio? Who is that? Hello? Rude.']] },
 { n: 2, title: 'Hostage Situation', type: 'hostages', cs: { cmd: 6, type: 6, t: 18 }, roster: [6],
   pre: [['tavi', 'Hey! Big loud ship! The croc slavers grabbed our scout pods. Ours. Fur and all. Can you get them back?'], ['skids', 'A cat. In a pod. Out here. This sector is so weird.'], ['finn', 'Pods are fragile. Fly over them to tow them out. Do not shoot them. That is my one request.'], ['tavi', 'I am Tavi. Mireth scout. You smell like Old Metal. That is either a compliment or a threat.']],
   post: [['tavi', 'You saved my cousins. I owe you. The Mireth always pay. Sometimes with shiny things.'], ['mort', 'She said Old Metal. She means the hull. The hull is alive. I knew it.'], ['szarkath', 'You steal my captives and call it mercy. I will teach you what mercy costs.']] },
 { n: 3, title: 'Cat Herding', type: 'escort', cs: { cmd: 1, type: 15, t: 26 }, roster: [1],
   pre: [['tavi', 'My people are moving three freighters to the jump point. The big croc Kraal wants them. Get them there alive.'], ['ophelia', 'Escorts have a ninety percent casualty rate. I wrote that down. In the report.'], ['kraal', 'Cat-lovers! I will hang your pretty ship on my wall next to the last one.'], ['ember', 'He has a wall? I want to see the wall. After.']],
   post: [['tavi', 'Kraal is gone and the freighters are home. My mother says come to the Dust Run. She wants to meet the ship.'], ['boomer', 'Meet the ship? Is that a metaphor? Is there a cake?'], ['szarkath', 'Kraal was a loud animal. I have quieter ones.']] },
 { n: 4, title: 'Dust and Refugees', type: 'passengers', cs: null, roster: [],
   pre: [['ishkara', 'I am Ishkara, Star-Weaver of the Mireth. Our elders are stranded at the far end of the Dust Run. Fly the asteroid corridor, take them aboard, and fly them back.'], ['skids', 'A narrow asteroid corridor. My favourite. Everybody tighten your belts.'], ['mort', 'We do not have belts.'], ['skids', 'Then nobody falls out.']],
   post: [['ishkara', 'The metal you carry is ours. We made it ten thousand years ago to be a ship that listens. The Drowned King wants it. Do not let him have it.'], ['finn', 'The Drowned King? Is that the voice on the radio?'], ['szarkath', 'Ishkara. You still smell of that old lie. Keep the crew close. Soon they will be mine.']] },
 { n: 5, title: 'Station Etiquette', type: 'station', cs: null, roster: [2],
   pre: [['ishkara', 'A Vorrakh battle station squats on our trade lane. The warden Durmok. It must come down.'], ['durmok', 'The sky is mine, and I do not take visitors. I take scrap.'], ['ophelia', 'It has eight batteries and one ion cannon. The ion bolt will lock us down. Keep the shield facing it.'], ['boomer', 'It also has a lot of surface area. I am smiling.']],
   post: [['durmok', 'Impossible... He said you were... only... a rumour...'], ['szarkath', 'Durmok served long and failed quickly. I will not repeat the mistake. Warlord Grakk, rise.']] },
 { n: 6, title: 'Home Defense', type: 'defend', cs: { cmd: 7, type: 16, t: 34 }, roster: [7],
   pre: [['tavi', 'The Starloom, our shrine-ship, is under attack. It cannot move. It cannot fight. It is a very pretty target.'], ['ishkara', 'Hold the croc fleet away until the loom completes the Weaving. It will take what time it takes.'], ['skids', 'Defend the shrine. Got it. Defending is just attacking while standing still.']],
   post: [['ishkara', 'The Weaving completes. More Morph Metal for the ship. Use it to grow the ship. She remembers larger shapes.'], ['mort', 'Grow? Like, bigger? Can we? How much larger can she get?'], ['finn', 'I will start measuring. For the repair bay.']] },
 { n: 7, title: 'The Warlord Pays a Visit', type: 'flagship', cs: null, roster: [3],
   pre: [['grakk', 'I am Grakk Ironjaw. I have crushed ten fleets. I will crush your little cat-ship and eat the pieces.'], ['ember', 'I like him. He is the first one who has said anything interesting.'], ['szarkath', 'Grakk. Make it hurt. I want to hear it.'], ['ophelia', 'A warship. Two waves, then the flagship itself. Please do not fly at it.']],
   post: [['grakk', 'Hrrk. They fight like... like they do not know they are doomed...'], ['szarkath', 'Interesting. You are more than a rumour. Come to the Hollow Gate. I have been waiting ten thousand years.'], ['skids', 'Oh good. A gate. With a king. At the end. It is going so well.']] },
 { n: 8, title: 'Double Trouble', type: 'siege', cs: null, roster: [8, 9],
   pre: [['ishkara', 'Two stations ring our homeworld. Take them both down and the Reach is free.'], ['tavi', 'Two. Count them. Two. That is how many holes I will have in my fur if you fail.'], ['mort', 'Reactor at one hundred and ten percent. That is a normal number for me.']],
   post: [['szarkath', 'The little ship bites. How wonderful.'], ['ishkara', 'The Tidegate is stirring. Our oracles say it will open in days. We are running out of time.']] },
 { n: 9, title: 'Hold Out', type: 'survival', cs: { cmd: 10, type: 8, t: 42 }, roster: [10],
   pre: [['ishkara', 'The Tidegate flares. Our weavers need time to close the first lock. Survive until they finish.'], ['szarkath', 'Survive? Of course. But I never promised how.'], ['finn', 'I have been logging your injuries. It has been a very long list. I stopped at lunch.'], ['skids', 'Survive. Easy. I have been doing it badly for years.']],
   post: [['tavi', 'First lock closed. Barely. The gate is still hungry.'], ['szarkath', 'You close a lock. I open ten.']] },
 { n: 10, title: 'Bomb Squad', type: 'bombrun', cs: { cmd: 11, type: 7, t: 30 }, roster: [11],
   pre: [['ishkara', 'The Vorrakh have turned their own ships into bombs. They are flying them straight at us. Hold the line.'], ['ophelia', 'Bomb ships. Dozens. Please remember that the shield is a hundred percent more useful when you face it toward the bombs.'], ['ember', 'I want to shoot every one of them. Personally.']],
   post: [['mort', 'We are down to the last few layers of paint. The Warranty has never looked better.'], ['sskarra', 'Impressive. I will be taking your ship home as a trophy, little cat-friends.'], ['szarkath', 'My admiral comes. She is less forgiving than I am.']] },
 { n: 11, title: 'The Admiral\u2019s Last Orders', type: 'flagship', cs: null, roster: [4],
   pre: [['sskarra', 'I am Admiral Sskarra. My fleet has silenced the galactic center. Your cat-scrap will not outlive the hour.'], ['skids', 'Admiral! Big boss! Boomer, we are doing the thing.'], ['boomer', 'Which thing?'], ['skids', 'The big thing.'], ['finn', 'The big thing is very, very big. All stations, please check your safety belts. Optional. Strongly.']],
   post: [['sskarra', 'The gate... will... open... without me...'], ['szarkath', 'Now only I remain. Come to the gate, little crew. Bring the ship. Bring everything. I will eat it all.'], ['ishkara', 'This is it. The Drowned King himself. Be ready. We are all with you.']] },
 { n: 12, title: 'The Drowned King', type: 'finale', cs: null, roster: [], boss: 1,
   pre: [['szarkath', 'At last. The Voided Warranty. You are the first thing in ten thousand years to reach my gate.'], ['skids', 'Hi! We heard you were the one sending all the crocs.'], ['szarkath', 'I send the tide. They are merely the foam.'], ['ophelia', 'His throne has an ion lance and a lot of everything else. The shield will not hold. Plan accordingly.'], ['finn', 'I have a lot of bandages. Not enough. Nobody say anything.']],
   post: [['szarkath', 'The tide... the tide... was never... mine...'], ['ishkara', 'It is done. The gate is closed. The Hollow Reach is free. Thank you, Voided Warranty.'], ['tavi', 'You are the Mireth\u2019s friends forever. Now go and cause trouble somewhere else.'], ['ember', 'We saved a galaxy. Do we get a medal?'], ['mort', 'We get to keep the ship. She is ours now. Really.'], ['finn', 'The warranty is still void. But I think she likes us.']] },
];
const EPILOGUE = [['cmd', 'The war at the galactic center has ended with the Vorrakh fleets recalled. Command offers the crew a permanent posting. They decline. The Voided Warranty flies on.'], ['skids', 'Where next?'], ['mort', 'Anywhere with a reactor.'], ['ophelia', 'Anywhere with a safety manual.'], ['ember', 'Anywhere with enemies.']];
// in-mission villain taunts (any chapter) and chapter-flavoured extras
const TAUNTS = [
  'You steer through my sector like children through a graveyard.', 'Every shot you fire echoes in my halls.', 'I can smell the metal of your ship. It remembers me.', 'Run. It makes the hunt more interesting.', 'Do you hear the tide? It hears you.',
  'You are a small, bright spark in a very large dark.', 'Ten thousand years I waited. I can wait a minute more for your ship to burn.', 'Your crew bickers. Mine obeys. That is the difference.', 'The cat-folk make sweet allies. They also make sweet snacks.', 'Fight harder. I would hate for this to be boring.',
  'How many sections can you lose before the ship screams?', 'I will keep your portrait. The one with the owl.', 'Come closer. I have a surprise.',
];
const SENDS = ['Let me send you a few friends.', 'Reinforcements. Do try to enjoy them.', 'A gift from the deep. Open it with your guns.', 'More teeth for the little ship.', 'The tide sends its regards.'];
const CAT_COMMS = [['tavi', 'Hey, you are doing great! Do not stop shooting!'], ['tavi', 'Dropping you a care package. Do not tell the elders.'], ['ishkara', 'The metal sings when you win. Keep it singing.'], ['tavi', 'I am sending sensor data. There are more of them behind that rock.'], ['ishkara', 'The Weavers are with you.']];
const CMD_INTRO = ['Prepare to die, little ship.', 'The Vorrakh do not lose.', 'You will make a fine ornament.', 'Scrap. All of you. Scrap.', 'Break formation! All guns on the cat-ship!'];
const CMD_DEATH = ['Hrrk... Szarkath... will not forgive...', 'Impossible...', 'My fleet... is... not finished...', 'At least... you are... memorable...', 'Tell the King... I did not flee...'];
const BOSS_LINES = { p2: 'You hurt my throne? Very well. The tide rises.', p3: 'Enough! I will drown you where you float.', kill: 'It cannot be... I am the Drowned King...', open: 'Behold the Drowned Throne. Ten thousand years in the making.' };
// voice announcements by the repair officer (Finn). Lines are [spoken, shown]
const FINN_LINES = {
  port: ['{} is down. Somebody hand me a wrench.', '{} destroyed.'],
  half: ['Hull at fifty percent. We are halfway to a very bad day.', 'Hull below 50%.'],
  low: ['Hull critical. Everybody say a quiet thing.', 'Hull below 10%.'],
};
// story helpers
const chapterOf = n => n >= 1 && n <= 12 ? CHAPTERS[n] : null;
const SEQ12 = CHAPTERS.slice(1).map(c => c.type);
// v7.1 voices (public/voice/*.mp3): the clip id of a cutscene line (only short lines are voiced, long ones stay text-only), and which fixed commander line each named commander says
const VOICE_MAX = 65;
const csId = (ch, k, i) => 'cs_' + ch + '_' + k + '_' + i;
const csLines = () => { const L = []; for (let c = 1; c <= 12; c++) for (const k of ['pre', 'post']) (CHAPTERS[c][k] || []).forEach((l, i) => L.push([csId(c, k, i), l[0], l[1]])); EPILOGUE.forEach((l, i) => L.push([csId('ep', 'e', i), l[0], l[1]])); return L; };
const CMD_INTRO_BY = { kraal: 0, durmok: 1, grakk: 3, sskarra: 4 }, CMD_DEATH_BY = { kraal: 4, durmok: 0, grakk: 1, sskarra: 3 };
const cmdLine = (key, kind, r) => { const by = kind === 'i' ? CMD_INTRO_BY : CMD_DEATH_BY, n = kind === 'i' ? CMD_INTRO.length : CMD_DEATH.length; return key in by ? by[key] : (r || 0) % n; };
const out = { VOICE_MAX, csId, csLines, CMD_INTRO_BY, CMD_DEATH_BY, cmdLine, TITLE, TAGLINE, SHIP, CREW, RACES, CMDRS, LTS, cmdInfo, VILLAIN, CATS, WHO, CHAPTERS, EPILOGUE, TAUNTS, SENDS, CAT_COMMS, CMD_INTRO, CMD_DEATH, BOSS_LINES, FINN_LINES, chapterOf, SEQ12 };
if (typeof module !== 'undefined' && module.exports) module.exports = out; else root.STORY = out;
})(typeof window !== 'undefined' ? window : globalThis);
