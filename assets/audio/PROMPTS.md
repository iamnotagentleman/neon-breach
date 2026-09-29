# Audio generation prompts

All files in this folder were generated with ElevenLabs (via the ElevenLabs MCP creative flow tools).
Music: `eleven_music_v2`, instrumental. SFX: `eleven_text_to_sound_v2`, prompt influence ~0.6.

| File | Length | Prompt |
| --- | --- | --- |
| `music_menu.mp3` | 60 s | Moody dark synthwave / cyberpunk ambient, slow 90 BPM, lush analog pads, arpeggiated synth, distant rain-city atmosphere, Blade Runner vibes, instrumental. |
| `music_battle.mp3` | 120 s | Driving cyberpunk darksynth / industrial electronic, 128 BPM, aggressive distorted bass, punchy drums, retro-futuristic synth leads, relentless energy for a tower defense battle, instrumental. |
| `music_boss.mp3` | 90 s | Intense cyberpunk boss battle, 140 BPM, heavy glitchy distorted synth bass, pounding drums, alarm-like synth stabs, menacing and epic, instrumental. |


Music prompts also asked for steady energy with no fade-out and an ending on the same groove as the start, so the tracks loop cleanly.

## Sound effects (`sfx/<name>_<n>.mp3`)

Rapid-fire sounds have several variations; the engine picks one at random (never the same twice in a row), trims leading silence, peak-normalizes, and applies per-sound mix levels (`SFX` table in `src/audio.js`).

| Name | Variations | Length | Prompt |
| --- | --- | --- | --- |
| laser | 3 | 0.5 s | Sci-fi pulse laser turret shot, short punchy energy zap with bright electric attack and fast decay, cyberpunk weapon |
| plasma_launch | 2 | 0.8 s | Heavy sci-fi plasma mortar launch, deep thump and rising electric whoosh as a glowing plasma shell is fired |
| plasma_hit | 2 | 1.2 s | Plasma shell impact, sizzling energy explosion with deep boom and crackling sparks, sci-fi |
| tesla | 3 | 0.7 s | Tesla coil lightning discharge, sharp crackling electric arc zap with buzzing high-voltage snap |
| cryo | 2 | 1.0 s | Cryogenic freeze pulse, icy hissing burst of coolant gas with crystalline frost crackle, sci-fi |
| rail | 2 | 1.4 s | Railgun shot, electromagnetic charge snap and supersonic crack with metallic ring, powerful sci-fi weapon |
| pop | 3 | 0.6 s | Small combat robot destroyed, quick electric pop and light metal debris clatter, sci-fi enemy death |
| explosion | 3 | 1.2 s | Sci-fi robot explosion, punchy electric blast with metal debris and sparks, clean game sound |
| bossdeath | 1 | 3.5 s | Giant war mech destroyed, massive sci-fi explosion with collapsing metal and electrical sparks, epic |
| shieldbreak | 1 | 0.8 s | Energy shield shattering, glassy electric break with dissipating hum, sci-fi |
| shieldhit | 3 | 0.5 s | Bullet hitting an energy force-field shield, bright resonant electric ping with a shimmering hum, sci-fi deflection, short, clean game sound |
| build | 2 | 0.8 s | Hologram tower deploy, quick digital materialize shimmer with a mechanical servo clunk, cyberpunk |
| upgrade | 1 | 1.2 s | Futuristic weapon upgrade power-up, rising synth chime with mechanical servo lock-in, cyberpunk UI |
| sell | 1 | 0.8 s | Digital credits payout, quick futuristic coin chime with holographic dissolve, cyberpunk UI |
| emp | 1 | 1.8 s | EMP blast, deep electromagnetic pulse wave with electric distortion and power-down whine, sci-fi |
| orbital | 1 | 1.2 s | Orbital laser strike charging, rising high-pitched energy build-up descending from the sky, sci-fi |
| orbitalhit | 1 | 2.2 s | Orbital laser strike impact, huge energy beam blast with thunderous boom and sizzling aftermath |
| overclock | 1 | 1.5 s | Systems overclock activation, turbine spin-up with electric surge and quick digital beeps, cyberpunk |
| leak | 1 | 1.0 s | Base core damaged alarm, harsh digital warning buzz with electric crackle, sci-fi |
| error | 1 | 0.5 s | Futuristic UI error, short low double buzz, denied |
| click | 1 | 0.5 s | Crisp futuristic UI button click, short clean digital tick |
| wave_start | 2 | 1.5 s | Subtle futuristic wave-incoming cue, soft low synth swell rising into a gentle digital double chime, cyberpunk HUD notification, not harsh, no siren, no alarm |
| wave_clear | 1 | 1.2 s | Wave cleared confirmation, short uplifting futuristic synth chime, soft and satisfying, cyberpunk HUD |
| boss_warning | 1 | 3.0 s | Ominous boss approaching cue, deep cinematic sci-fi braam with low sub pulse and faint digital glitch, no siren |
| game_over | 1 | 3.0 s | System failure, digital glitch shutdown with descending power-down synth, dramatic and short, cyberpunk |
| victory | 1 | 3.0 s | Triumphant cyberpunk victory stinger, bright synthwave chord swell with sparkling arpeggio, short |
| hero_shot | 3 | 0.5 s | Twin heavy autocannon shot from a four-legged combat mech, punchy mechanical bang with a crisp metallic kick and a short electric tail, cyberpunk war robot weapon, short clean game sound |
| hero_hack | 2 | 0.9 s | Netrunner hack intrusion, glitchy digital data burst with a rising electronic chirp and static crackle, cyberpunk hacking zap, clean game sound |
| hero_hijack | 1 | 1.4 s | Enemy robot hijacked, stuttering digital glitch and data corruption resolving into a low reprogrammed power-up hum, cyberpunk takeover, clean game sound |
| trap_set | 2 | 0.6 s | Proximity mine thrown down, heavy metal disc landing with a clunk followed by two quick electronic arming beeps, sci-fi, short |
| mine_blast | 2 | 1.0 s | Proximity mine detonation, sharp explosive crack with metallic shrapnel and a low boom, sci-fi game sound |
| emp_trap | 1 | 0.9 s | Small EMP mine going off, sharp electric pop with a descending power-drain whine and crackle, sci-fi |
| missile_salvo | 2 | 1.0 s | Micro-missile salvo launched from a war mech's back pods, rapid rippling whooshes of several small rockets firing in quick succession, sci-fi |
| hero_hit | 2 | 0.5 s | Bullets hitting heavy robot armor plating, sharp metallic ricochet pings and clanks, short game sound |
| hero_down | 1 | 2.0 s | Heavy four-legged combat robot knocked out, electrical overload with sparks, servo whine powering down, metal legs collapsing with a heavy clang |
| hero_reboot | 1 | 1.8 s | Combat mech rebooting, rising power-up whine with servo motors spinning up, digital boot beeps and a confident mechanical lock-in, cyberpunk |
| hero_deploy | 1 | 1.5 s | War mech drop deployment, heavy metallic landing thud with a hydraulic hiss and servo whir, brief digital hologram shimmer, cyberpunk |
| hero_move | 1 | 0.5 s | Mech acknowledging a move order, short servo whirr with a crisp digital chirp, cyberpunk UI, subtle |

The hero war bot's sounds (the `hero_*`, `trap_set`, `mine_blast`, `emp_trap` and `missile_salvo` rows) were added on 2026-09-29, 58.7 credits in total.

The first wave-start cue was a siren; it was replaced by the softer cue above (spectral centroid 3.8 kHz → ~0.6–1.2 kHz).
