# NEON//BREACH

**▶ Play in your browser: https://iamnotagentleman.github.io/neon-breach/**

A 3D cyberpunk tower defense game for the browser. Rogue drones, chrome-augmented runners and corporate warframes are pushing toward your data core. Hold three floating districts above a neon megacity for 20 waves each, then see how long you last in Endless mode.

- **3D art**: every tower, enemy, boss and set piece was generated with **Meshy** (AI concept image → image-to-3D, textured PBR), then processed in **Blender**: re-pivoting, turret-head splitting, emissive neon maps, decimation, WebP + Draco compression, rigging and animation.
- **Audio**: soundtrack generated with **ElevenLabs Music**; every sound effect (turret shots, impacts, deaths, abilities, UI, wave cues) generated with **ElevenLabs Sound Effects**, with several variations for rapid-fire sounds. Samples are trimmed and loudness-normalized at load; procedural Web Audio versions remain as a fallback.
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
| Click tower | Inspect · `,` `.` `/` upgrade path 1 / 2 / 3 (`U` = its main path) · `S` sell (70% refund) · `T` cycle targeting (first / last / strong / close) |
| Click enemy | Live intel: hull/shield, armor, speed, bounty, core damage, distance to core, status, counter tip |
| `Space` | Launch the next wave — calling it while enemies are alive pays an early bonus |
| `Q` `W` `E` | EMP Burst · Orbital Strike · Overclock |
| Right-drag / arrow keys | Pan the camera (it stays over the board) · right-click without dragging cancels |
| Wheel / pinch | Zoom toward the cursor |
| Middle-drag, `Shift` + right-drag, `Z` / `X` | Turn the camera (`Z` / `X` snap 45°) · `C` resets the view |
| `F` | Cycle speed 1× / 2× / 3× |
| `P` / `Esc` | Pause · `M` mute |

**Defenses**: Pulse Laser (fast hitscan), Plasma Mortar (lobbed splash, ground only), Tesla Coil (chain lightning, 3× vs shields), Cryo Emitter (area slow, hits cloaked units), Railgun (piercing, ignores armor), Netrunner Uplink (buffs nearby towers, decloaks Phantoms). The heavy emplacements — Plasma Mortar, Tesla Coil and Railgun — occupy a **2×2** footprint (with a little extra reach); the rest take one pad. City blocks on the board also come in 1×1 and 2×2 lots.

**Upgrades** work like Bloons TD: every defense has **3 upgrade paths × 5 tiers**. You can invest in at most two paths, and only one of them can go past tier 2 (so 5-2-0, 0-3-2, 2-0-4 and so on). Hover an upgrade to preview its stat changes. Towers visibly evolve with their leading path: at tier 3 the tower takes on the path's colors (its neon re-hued, its armor painted), grows a little with every tier, and at tier 5 the whole model is replaced by the path's capstone.

| Defense | Path 1 | Path 2 | Path 3 |
| --- | --- | --- | --- |
| Pulse Laser | **Overdrive** → Photon Storm | Focus → Solar Lance | Hack → Netburn |
| Plasma Mortar | **Payload** → Sunfall | Barrage → Artillery Storm | Tactical → Gravity Well |
| Tesla Coil | **Arc** → Thunderhead | Voltage → Zeus Protocol | Field → Ion Storm |
| Cryo Emitter | **Deep Freeze** → Glacier Core | Frostbite → Permafrost | Coverage → Blizzard |
| Railgun | **Caliber** → Annihilator | Cycle → Gauss Storm | Targeting → Orbital Link |
| Netrunner Uplink | Neural Mesh → Hive Mind | Economy → Corporate Heist | **Intrusion** → Blackwall |

Bold paths are each tower's flagship: its tier-5 form is a dedicated Meshy model. The other two capstones are path-colored variants of it.

**Hostiles**: Street Runners, Hunter Drones (air), Heavy Mechs (armor), Aegis Units (regenerating shields), Phantoms (flickering optical camo — shown as violet holograms with a ◇ marker while untargetable), Replicators (split into Nano-Mites), Patch Drones (heal allies), and two bosses: the Titan Warframe (waves 10 & 18) and the Overmind (wave 20).

## Project layout

```
index.html, style.css      UI shell (HUD, shop, modals) layered over the 3D canvas
src/config.js              tuning data: towers, enemies, maps, waves, abilities
src/game.js                pure simulation (no DOM) — enemies, towers, waves, damage; emits FX events
src/render3d.js            three.js renderer: board, city, models, animation, effects, post-processing
src/vfx.js                 effect building blocks: procedural textures, instanced sparks/smoke, beam shader
src/assets3d.js            GLB loading + per-enemy presentation (size, hover, animation clip)
src/render.js              2D minimaps for the level-select cards
src/audio.js               ElevenLabs music with crossfaded loops + procedural SFX
src/titlefx.js             synthwave skyline behind the menus
src/main.js                screens, HUD, input, saves, music state machine
assets/models/             game-ready GLBs (Meshy → Blender)
assets/icons/              UI portraits rendered from the models in Blender
assets/vfx/                explosion / energy-burst flipbooks rendered in Blender
assets/audio/              ElevenLabs music and SFX (see PROMPTS.md)
concept/                   AI concept art, contact sheets, Meshy task manifest
tools/blender/             asset pipeline scripts (run with Blender in background mode)
tools/sim.mjs              headless balance simulator
vendor/three/              three.js core + the addons the game uses
```

## Asset pipeline

1. **References**: cyberpunk tower-defense, turret, drone and mech concept art from ArtStation informed the style (chunky gunmetal hard-surface turrets on pedestal bases, faction-colored androids, a floating board over a neon grid). They were used only as a private moodboard; nothing from them ships with the game.
2. **Concepts**: an original concept image per asset from Meshy `text-to-image` (`concept/generated/`, overview in `concept/concept_sheet.jpg`).
3. **3D**: Meshy `image-to-3d` (Meshy-7, PBR textures), humanoid enemies auto-rigged by Meshy with walk/run cycles, plus one evolved tier-5 model per tower for its flagship path. Task IDs are in `concept/pipeline.json`.
4. **Blender** (headless, `Blender -b --factory-startup -P <script> -- <args>`):
   - `process_asset.py tools/blender/assets.json` — pivot to base center, face +Z, normalize size, split turret heads at the neck (auto-aimed along the barrel), derive emissive maps from the neon pixels, decimate, 1K WebP textures, Draco.
   - `process_rigged.py tools/blender/rigged.json` — restores the PBR maps Meshy's rigger drops, decimates the skinned mesh, exports extra clips as armature-only GLBs.
   - `rig_mech.py` — the Heavy Mech's auto-rig came back broken, so it gets a hand-built 13-bone skeleton fitted to the mesh and a keyframed stomping walk cycle.
   - `rig_spider.py` — six-legged crawlers (Replicator, Nano-Mite): legs detected by clustering the mesh, hip/knee/foot bones placed on each leg, shell locked rigid, alternating-tripod crawl cycle.
   - `recolor_variant.py` — the other two tier-5 capstones of each tower: the flagship model with its neon hue-shifted to the path color and the armor lightly tinted. The tier 3–4 path looks use the same recolor, applied in the shader at load time (`src/assets3d.js`), so they share the base models' geometry and textures instead of shipping as 18 more GLBs.
   - `render_vfx.py` + `tools/build_atlas.py` — procedural fireball and energy-burst flipbooks.
   - `render_icons.py` — neon-rim-lit UI portraits.

## Balance simulator

```bash
npm run sim                          # coverage-optimal player, all maps
CASUAL=1 TOP=0.25 npm run sim -- 5   # decent-but-imperfect placement, 5 runs
MAP=2 DIFF=1.2 npm run sim           # try a different difficulty multiplier on one map
```

The simulated player takes each tower's main path to tier 5 and a second path to tier 2. A coverage-optimal player clears every district flawlessly. A casual player (`CASUAL=1 TOP=0.25`: random spots among the top quarter by coverage) wins roughly a third of runs. Almost every loss is the Overmind breaching on wave 20; waves 1–19 are usually clean.

## Performance

The renderer adapts its pixel ratio to hold frame rate, pre-compiles shaders when a map loads, skips optional effects when many are alive, and uses blob shadows for regular enemies (only towers and bosses cast real shadows). On an Apple-silicon Mac it holds ~60 fps with 70+ enemies at 3× speed.

## Credits

- 3D models & concept images: generated with [Meshy](https://www.meshy.ai)
- Music & sound effects: generated with [ElevenLabs](https://elevenlabs.io)
- Asset processing, rigging, VFX and icons: [Blender](https://www.blender.org)
- Rendering: [three.js](https://threejs.org) (MIT, see `vendor/three/LICENSE`)
