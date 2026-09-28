# Handler voice-over

Voice lines for the mission "handler" in NEON//BREACH. There is one MP3 per key in [`lines.json`](lines.json), named `<key>.mp3`.

- **Voice:** Jerry B. - Military Commander | Gruff, Gritty Authority (ElevenLabs voice library)
- **Voice ID:** `TxWZERZ5Hc6h9dGxVmXa`
- **Model:** `eleven_v3` (ElevenLabs v3). `eleven_v4` is listed but this workspace can't use it.
- **Output:** MP3, 128 kbps, 44.1 kHz, mono
- **Delivery:** every line starts with a v3 audio tag. Lines ending in `!` use `[urgent]`; all other lines use `[calm]`. The tag is a direction only and isn't spoken.
- **Generation:** 1 take per line, generated once (no retries), via the ElevenLabs Creative MCP (`creative_generate_speech`). Flow: https://elevenlabs.io/app/flows/aafjGgvh3rN1uG3oryhD
- **Generated:** 2026-09-28

## Credits per line

The Credits column is the `price.credits` value from the run status. The one `estimate_only` call (85 credits quoted for `start`) didn't charge anything.

| Key | Delivery | Duration (s) | Credits |
|---|---|---:|---:|
| `start` | calm | 5.44 | 85 |
| `wave_start_1` | calm | 1.60 | 24 |
| `wave_start_2` | calm | 2.32 | 44 |
| `wave_start_3` | calm | 2.00 | 39 |
| `wave_clear_1` | calm | 1.92 | 24 |
| `wave_clear_2` | calm | 2.32 | 41 |
| `core_critical` | urgent | 3.44 | 66 |
| `victory` | calm | 3.04 | 45 |
| `defeat` | calm | 2.88 | 52 |
| `endless` | calm | 5.12 | 72 |
| `boss_titan` | calm | 5.68 | 82 |
| `boss_overmind` | calm | 5.92 | 86 |
| `phase_titan` | urgent | 4.56 | 67 |
| `phase_overmind` | urgent | 2.24 | 46 |
| `threat_runner` | calm | 5.36 | 76 |
| `threat_drone` | calm | 3.52 | 57 |
| `threat_brute` | calm | 6.48 | 84 |
| `threat_aegis` | calm | 5.20 | 84 |
| `threat_phantom` | calm | 6.08 | 78 |
| `threat_splitter` | calm | 4.80 | 59 |
| `threat_medic` | calm | 4.96 | 77 |
| `threat_jammer` | calm | 7.84 | 99 |
| `threat_courier` | calm | 8.72 | 99 |
| `data_stolen` | urgent | 3.52 | 73 |
| `data_escaped` | calm | 2.88 | 47 |
| `data_recovered` | calm | 2.48 | 24 |
| `jammed` | urgent | 1.60 | 37 |
| `variant_mirror` | calm | 3.68 | 67 |
| `variant_insulated` | calm | 3.12 | 60 |
| `variant_thermal` | calm | 3.20 | 60 |
| `mutators` | calm | 2.72 | 56 |
| **Total (31 clips)** | | **124.64** | **1910** |

Total cost: 1910 credits (about $0.70 USD at the reported rate).
