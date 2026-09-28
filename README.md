# NEON//BREACH

**▶ Play in your browser: https://iamnotagentleman.github.io/neon-breach/**

A 3D cyberpunk tower defense game for the browser. Rogue drones, chrome-augmented runners and corporate warframes are pushing toward your data core. Hold three floating districts above a neon megacity for 20 waves each, then see how long you last in Endless mode.

- **3D art**: every tower, enemy, boss and set piece was generated with **Meshy** (AI concept image → image-to-3D, textured PBR), then processed in **Blender**: re-pivoting, turret-head splitting, emissive neon maps, decimation, WebP + Draco compression, rigging and animation.
- **Audio**: soundtrack generated with **ElevenLabs Music**; every sound effect (turret shots, impacts, deaths, abilities, UI, wave cues) generated with **ElevenLabs Sound Effects**, with several variations for rapid-fire sounds. Samples are trimmed and loudness-normalized at load; procedural Web Audio versions remain as a fallback. A mission **handler** (31 lines, **ElevenLabs Text to Speech**, `eleven_v3`) calls out new threats, boss arrivals and phases, stolen data and a failing core, played through a radio filter with the music ducked underneath and a subtitle on screen.
- **Engine**: [three.js](https://threejs.org) r186 (vendored, no build step): PBR with a custom neon reflection environment, bloom, shadows, skeletal animation.
- **VFX**: shader energy beams (white-hot core, flowing glow, tapered ends; railgun shots dissolve from the muzzle and leave an ion corkscrew and smoke), instanced GPU particles (sparks that streak along their motion and cool from white-hot to their color, soft rolling smoke and frost mist), crackling forked lightning that re-strikes while it lives, lens flares, shock rings, scorch marks, and Blender-rendered fireball/energy flipbooks. Enemies crumple into their blast instead of vanishing. Each model's neon is normalized to a shared bloom budget at load time, so no single model outshines the rest.

## Run it

```bash
npm start            # zero-dependency static server
open http://localhost:5173
```

Any static server works; it just needs HTTP (ES modules, fetched models and audio). No install or build step.

## How to play

| Input | Action |
| --- | --- |
| `1`–`6` | Pick a defense, click a pad to deploy (hold `Shift` to place several) |
| Click tower | Inspect · `,` `.` `/` upgrade path 1 / 2 / 3 (`U` = its main path) · `S` sell (70% refund, or everything back if you bought it during this build phase) · `T` cycle targeting (first / last / strong / close) |
| Click enemy | Live intel: hull/shield, armor, speed, bounty, core damage, distance to core, status, counter tip |
| `Space` | Launch the next wave — calling it while enemies are alive pays an early bonus |
| `Q` `W` `E` | EMP Burst · Orbital Strike · Overclock (cooldowns only recharge while a wave is running) |
| Right-drag / arrow keys | Pan the camera (it stays over the board) · right-click without dragging cancels |
| Wheel / pinch | Zoom toward the cursor |
| Middle-drag, `Shift` + right-drag, `Z` / `X` | Turn the camera (`Z` / `X` snap 45°) · `C` resets the view |
| `F` | Cycle speed 1× / 2× / 3× / 4× |
| `A` | Auto-launch: the next wave starts 3 s after the last one clears |
| `H` | Toggle the placement heat map |
| `P` / `Esc` | Pause · `M` mute · ⚙ settings (audio, auto-launch, boss intros, heat map, screen shake, CRT, floating text) |

**Defenses**: Pulse Laser (fast hitscan), Plasma Mortar (lobbed splash, ground only), Tesla Coil (chain lightning, 3× vs shields), Cryo Emitter (area slow, hits cloaked units), Railgun (piercing, ignores armor; each enemy a slug passes through takes 10% less, down to half, except with the Annihilator capstone), Netrunner Uplink (buffs nearby towers, decloaks Phantoms; its Intrusion path firewalls towers against Signal Jammers). The heavy emplacements — Plasma Mortar, Tesla Coil and Railgun — occupy a **2×2** footprint (with a little extra reach); the rest take one pad. City blocks on the board also come in 1×1 and 2×2 lots.

**Upgrades** work like Bloons TD: every defense has **3 upgrade paths × 5 tiers**. You can invest in at most two paths, and only one of them can go past tier 2 (so 5-2-0, 0-3-2, 2-0-4 and so on). Hover an upgrade to preview its stat changes. Towers visibly evolve with their leading path: at tier 3 the tower takes on the path's colors (its neon re-hued, its armor painted), grows a little with every tier, and at tier 5 the whole model is replaced by the path's capstone.

| Defense | Path 1 | Path 2 | Path 3 |
| --- | --- | --- | --- |
| Pulse Laser | **Overdrive** → Photon Storm | Focus → Solar Lance | Hack → Netburn |
| Plasma Mortar | **Payload** → Sunfall | Barrage → Artillery Storm | Tactical → Gravity Well |
| Tesla Coil | **Arc** → Thunderhead | Voltage → Zeus Protocol | Field → Ion Storm |
| Cryo Emitter | **Deep Freeze** → Glacier Core | Frostbite → Permafrost | Coverage → Blizzard |
| Railgun | **Caliber** → Annihilator | Cycle → Gauss Storm | Targeting → Orbital Link |
| Netrunner Uplink | Neural Mesh → Hive Mind | Economy → Corporate Heist | **Intrusion** → Blackwall |

Bold paths are each tower's flagship: its tier-5 form is a dedicated Meshy model. The other two capstones are path-colored variants of it. Photon Storm is a rotary cannon: its six-barrel cluster spins up while it fires and winds down after, and it rattles out tracer rounds from the barrels as they come round instead of a steady beam.

**Placement heat map**: while you place a tower, every pad is tinted by how much road that tower would actually see from there (line of sight included; Uplinks score the towers they would buff), from dim red to green, and the inspector reads out the exact coverage for the spot under the cursor.

**Veterancy**: towers earn XP for the share of each enemy's hull they strip, weighted by its bounty (Cryo also for every enemy it chills; an Uplink takes a quarter of what the towers it buffs earn). Ranks I–V (Blooded, Veteran, Elite, Ace, Legend) each add +5% damage and +3% fire rate. Selling a tower loses its rank; the inspector shows the rank, XP bar and chevrons over the tower.

**Combos**: statuses from different towers react on the same enemy:

| Combo | Trigger | Effect |
| --- | --- | --- |
| Thermal Shock | burning + chilled (either order) | burst for 12% of max hull (4% on bosses), armor cracked open for 3 s |
| Superconduct | Tesla arc through a chilled enemy | +50% damage, the chain jumps on without losing power |
| Overload | Tesla arc through a burning enemy | the rest of the burn detonates at once and splashes its neighbours |
| Exposed | Railgun slug on an armor-stripped enemy (Armor Shred, ICE Breaker, cracked) | ×1.5 critical hit |
| Fracture | Plasma blast on a frozen enemy | double damage, the ice breaks |

**Core integrity**: the core has 100 integrity, and each breach costs what that enemy hits for: Runners 3, Drones 2, Phantoms 4, Patch Drones 5, Heavy Mechs 12, the Titan 35, the Overmind 80. Shields are an extra layer: an Aegis breaching with its shield up costs up to 4 more, the Overmind up to 30 more. A Replicator that breaches also brings its three Nano-Mites, and a Data Courier that escapes with a packet costs 8. The enemy intel panel shows each enemy's current breach cost.

**Streets**: roads wind through each district with rounded bends that enemies sweep through, with painted lane markings and neon curbs.

**Endless mode**: after wave 20, enemy health, group sizes and boss counts keep rising on a logarithmic curve: each wave is harder than the last, by a little less each time. Every endless wave also rolls **mutators** (one from wave 21, two from wave 30), shown in the next-wave panel.

**Variants**: any regular enemy can carry a variant. It wears the variant's color on its neon and a small lettered badge over its head. Late campaign waves field the three resistances; endless mutators draw from the whole list.

| Variant | Effect |
| --- | --- |
| Mirror-Plated (M) | Pulse Lasers deal half damage |
| Insulated (I) | Tesla arcs deal half damage and can't chain on through it |
| Heat-Sinked (T) | immune to chill, freeze and burn (so no fire or ice combos) |
| Hardened (H) | +50% hull, +3 armor |
| Amped (A) | +30% speed |
| Self-Repair (R) | regenerates 4% hull per second after 1.5 s without damage |
| Warded (W) | regenerating shield worth half its hull |
| Ghosted (G) | permanent optical camo |

**Line of sight**: city blocks on each map are placed to break up sight lines. Lasers, tesla arcs (including chain jumps), railgun slugs and cryo pulses can't reach enemies behind a building, and piercing shots stop at walls. Plasma mortars lob over buildings, and the Railgun's Thermal Scope upgrade lets its slugs punch through them. While placing or inspecting a tower, its range area is drawn as the polygon it can actually see: the outline follows the range circle where the view is clear and cuts in along building shadows.

**Hostiles**: Street Runners, Hunter Drones (air), Heavy Mechs (armor), Aegis Units (regenerating shields), Phantoms (permanent optical camo — only camo detection, Uplink fields, EMP or freezes expose them; shown as violet holograms with a ◇ marker), Replicators (split into Nano-Mites), Patch Drones (heal allies), and two new threats:

- **Signal Jammer** (from wave 11): a hovering ECM drone. Every tower within 1.8 tiles goes offline ("JAMMED") until it leaves, dies or is stunned. Out-range it (Railgun, Mortar), stun it (EMP, freezes), or firewall your towers with an Intrusion-path Uplink.
- **Data Courier** (from wave 8): a fast thief that doesn't breach the core. It grabs a data packet and runs back out the way it came, and you lose 8 integrity only if it escapes. Kill it and the packet drops and drifts back along the road to the core, unless another courier snatches it on the way. Carriers are marked with a teal ◇; FIRST targeting prioritises the one closest to escaping.

**Bosses**: the Titan Warframe (waves 10 & 18) and the Overmind (wave 20) have **skulls** on their health bar (a boss bar at the top of the screen shows them too). At each skull the hull locks for a moment and the boss triggers its protocol. The Titan vents an EMP that knocks out every tower within 3 tiles for 3.5 s, then surges forward. The Overmind hijacks your two most valuable towers nearby, then calls a cloaked escort, reboots its shield to 60%, and finally overclocks itself. When a campaign boss arrives, the camera flies down to it for a short, skippable intro (slow motion, name card, handler callout); any building or tower between the camera and the boss is hidden for the shot.

**End-of-run report**: the victory/defeat screen ranks every tower by damage dealt (sold ones included, with the MVP marked), and lists how often each combo fired and how many data packets were stolen, recovered or lost.

## Project layout

```
index.html, style.css      UI shell (HUD, shop, modals) layered over the 3D canvas
src/config.js              tuning data: towers, enemies, maps, waves, abilities
src/game.js                pure simulation (no DOM) — enemies, towers, waves, damage; emits FX events
src/render3d.js            three.js renderer: board, city, models, animation, effects, post-processing
src/vfx.js                 effect building blocks: procedural textures, instanced sparks/smoke, beam shader
src/assets3d.js            GLB loading + per-enemy presentation (size, hover, animation clip)
src/render.js              2D minimaps for the level-select cards
src/audio.js               ElevenLabs music with crossfaded loops, SFX samples + procedural fallback, handler voice over a radio filter
src/voice.js               handler voice lines (text, priority, cooldown) — clips in assets/audio/voice/
src/titlefx.js             synthwave skyline behind the menus
src/main.js                screens, HUD, input, saves, music state machine
assets/models/             game-ready GLBs (Meshy → Blender)
assets/icons/              UI portraits rendered from the models in Blender
assets/vfx/                explosion / energy-burst flipbooks rendered in Blender
assets/audio/              ElevenLabs music and SFX (see PROMPTS.md); voice/ has the handler's lines (see VOICE.md)
concept/                   AI concept art, contact sheets, Meshy task manifest
tools/blender/             asset pipeline scripts (run with Blender in background mode)
tools/sim.mjs              headless balance simulator
tools/sightlines.mjs       level-design aid: per-tile visible-road heat map with buildings blocking sight
vendor/three/              three.js core + the addons the game uses
```

## Asset pipeline

1. **References**: cyberpunk tower-defense, turret, drone and mech concept art from ArtStation informed the style (chunky gunmetal hard-surface turrets on pedestal bases, faction-colored androids, a floating board over a neon grid). They were used only as a private moodboard; nothing from them ships with the game.
2. **Concepts**: an original concept image per asset from Meshy `text-to-image` (`concept/generated/`, overview in `concept/concept_sheet.jpg`).
3. **3D**: Meshy `image-to-3d` (Meshy-7, PBR textures), humanoid enemies auto-rigged by Meshy with walk/run cycles, plus one evolved tier-5 model per tower for its flagship path. Task IDs are in `concept/pipeline.json`.
4. **Blender** (headless, `Blender -b --factory-startup -P <script> -- <args>`):
   - `process_asset.py tools/blender/assets.json` — pivot to base center, face +Z, normalize size, split turret heads at the neck (auto-aimed along the barrel), optionally split a rotary barrel cluster off the head on its own axis (`barrels`, used by Photon Storm), derive emissive maps from the neon pixels, decimate, 1K WebP textures, Draco.
   - `process_rigged.py tools/blender/rigged.json` — restores the PBR maps Meshy's rigger drops, decimates the skinned mesh, exports extra clips as armature-only GLBs.
   - `rig_mech.py` — the Heavy Mech's auto-rig came back broken, so it gets a hand-built 13-bone skeleton fitted to the mesh and a keyframed stomping walk cycle.
   - `rig_spider.py` — six-legged crawlers (Replicator, Nano-Mite): legs detected by clustering the mesh, hip/knee/foot bones placed on each leg, shell locked rigid, alternating-tripod crawl cycle.
   - `recolor_variant.py` — the other two tier-5 capstones of each tower: the flagship model with its neon hue-shifted to the path color and the armor lightly tinted. The tier 3–4 path looks use the same recolor, applied in the shader at load time (`src/assets3d.js`), so they share the base models' geometry and textures instead of shipping as 18 more GLBs.
   - `render_vfx.py` + `tools/build_atlas.py` — procedural fireball and energy-burst flipbooks.
   - `render_icons.py` — neon-rim-lit UI portraits.

## Balance simulator

```bash
npm run sim                          # coverage-optimal player, all maps
STATS=1 npm run sim                  # also print data couriers, tower ranks and combo counts per run
node tools/econ.mjs                  # what each upgrade adds per credit vs. buying another base tower
node tools/econ.mjs flow 6           # credits earned / spent / banked per wave in simulated runs
CASUAL=1 TOP=0.25 npm run sim -- 5   # decent-but-imperfect placement, 5 runs
MAP=2 DIFF=1.2 npm run sim           # try a different difficulty multiplier on one map
```

The simulated player takes each tower's main path to tier 5 and a second path to tier 2, and scores spots only by the road a tower can actually see. A coverage-optimal player clears Sector 7 and Neon Docks and can fall on Core Nexus's late boss waves. A casual player (`CASUAL=1 TOP=0.25`: random spots among the top quarter by visible coverage) wins about 70% of runs on Sector 7, about 25% on Neon Docks and about 6% on Core Nexus; most of its losses come at the boss waves.

```bash
node tools/sightlines.mjs 0          # Sector 7: how much road each tile sees with the buildings in place
BUILDINGS='[[6,4,2],[12,5,2]]' node tools/sightlines.mjs 0   # try a different layout
```

## Performance

The renderer adapts its pixel ratio to hold frame rate, pre-compiles shaders when a map loads, skips optional effects when many are alive, and uses blob shadows for regular enemies (only towers and bosses cast real shadows). On an Apple-silicon Mac it holds ~60 fps with 70+ enemies at 3× speed.

## Credits

- 3D models & concept images: generated with [Meshy](https://www.meshy.ai)
- Music & sound effects: generated with [ElevenLabs](https://elevenlabs.io)
- Asset processing, rigging, VFX and icons: [Blender](https://www.blender.org)
- Rendering: [three.js](https://threejs.org) (MIT, see `vendor/three/LICENSE`)
