#!/usr/bin/env python3
"""Generates public/voice/*.mp3 with Microsoft neural voices (edge-tts, free, no key). Usage: node tools/voice-manifest.js | python3 tools/gen-voice.py [outdir]
Each clip: neural TTS -> light 'comm' filter (gentle band limit + soft compression, a touch of echo for the villain) -> mono 24 kHz MP3."""
import asyncio, json, os, subprocess, sys, edge_tts
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'voice')
BR = os.environ.get('VBR', '32k')
COMM = 'highpass=f=120,lowpass=f=7400,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=120'
V = {  # who: (voice, rate, pitch, ffmpeg filter chain). v9: the six player characters speak ~10% faster; Szarkath unchanged
  'finn':     ('en-US-AndrewNeural',       '+10%',  '+0Hz',  COMM),                                   # warm, friendly male (Arctic Fox repair guy)
  'skids':    ('en-US-EmmaNeural',         '+18%',  '+2Hz',  COMM),                                   # fast, cheerful pilot
  'boomer':   ('en-AU-WilliamMultilingualNeural', '+10%', '-2Hz', COMM),                            # Aussie kangaroo
  'mort':     ('en-US-EricNeural',         '+8%',  '-2Hz',  COMM),                                   # dry, rational engineer
  'ophelia':  ('en-GB-LibbyNeural',        '+7%',  '+0Hz',  COMM),                                   # precise British owl
  'ember':    ('en-US-JennyNeural',        '+14%',  '-3Hz',  COMM),                                   # sarcastic dragon gladiator
  'cmd':      ('en-US-RogerNeural',        '-2%',  '+0Hz',  'highpass=f=200,lowpass=f=5200,acompressor=threshold=-22dB:ratio=3'),   # tinny HQ radio
  # Szarkath: the deepest authoritative neural voice found (lowest f0 of every English male voice), slowed, then pitched down with rubberband (formants shifted down = bigger voice),
  # a low shelf, a bit less presence and a touch of reverb. Natural, not a clone of anyone.
  'szarkath': ('en-US-ChristopherNeural',  '-14%', '-8Hz',  'rubberband=pitch=0.82:formant=shifted:transients=smooth,equalizer=f=110:t=q:w=1.0:g=4,equalizer=f=3200:t=q:w=1.2:g=-2,lowpass=f=6500,aecho=0.8:0.45:80|170:0.18|0.10'),
  'kraal':    ('en-US-GuyNeural',          '+4%',  '-6Hz',  COMM),
  'durmok':   ('en-GB-ThomasNeural',       '-6%',  '-4Hz',  COMM + ',aecho=0.8:0.4:45:0.15'),
  'grakk':    ('en-CA-LiamNeural',         '-8%',  '-12Hz', COMM),
  'sskarra':  ('en-GB-SoniaNeural',        '-4%',  '-4Hz',  COMM),
  'lt':       ('en-US-SteffanNeural',      '+2%',  '-2Hz',  COMM),
  'tavi':     ('en-US-AnaNeural',          '+4%',  '+0Hz',  'highpass=f=150,lowpass=f=7800'),
  'ishkara':  ('en-AU-NatashaNeural',      '-6%',  '+0Hz',  'highpass=f=130,lowpass=f=7600,aecho=0.8:0.35:55:0.12'),
}
async def one(sem, c):
    vo, rate, pitch, flt = V[c['who']]; mp3 = os.path.join(OUT, c['id'] + '.mp3'); raw = '/tmp/_v_' + c['id'] + '.mp3'
    async with sem:
        for t in range(4):
            try:
                await edge_tts.Communicate(c['text'], vo, rate=rate, pitch=pitch).save(raw); break
            except Exception as e:
                if t == 3: raise
                await asyncio.sleep(1.5)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af', flt + ',loudnorm=I=-18:TP=-2:LRA=9', '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', BR, mp3], check=True)
    os.remove(raw)
async def main():
    os.makedirs(OUT, exist_ok=True); L = json.load(sys.stdin); sem = asyncio.Semaphore(4)
    await asyncio.gather(*[one(sem, c) for c in L])
    json.dump({c['id']: c['who'] for c in L}, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
    print(len(L), 'clips', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)), 'bytes')
asyncio.run(main())
