# Asset Provenance

Every production image, font, and audio asset shipped by Bull Rush, its source/creator/license as
far as this migration could establish, and the required action before mainnet launch.

**This document exists because a prior assessment found that this project's production deployment
was serving five gitignored, unlicensed commercial music tracks live at `trybullrush.xyz` despite
those files never being committed to git — the git-ignore only hid them from the repository, not
from players.** That is the failure mode this document and
`scripts/check-forbidden-assets.mjs` exist to prevent from happening silently again.

## Status legend

- ✅ **Documented** — source/license established, safe to keep.
- ⚠️ **Undocumented** — no license record found; must be confirmed or replaced before mainnet.
- 🚫 **Must remove** — confirmed unlicensed for public distribution; must not ship.

## Images

| Asset | Path | Size | Status | Source/provenance | Required action |
|---|---|---|---|---|---|
| Hero image | `public/bull-hero.jpg` | 223 KB | ⚠️ Undocumented | A derivative of `refs/originals/bull-hero.png` (git-ignored, local-only reference); no license or generation record accompanies it | Confirm generation provenance (AI-generated with a commercial-use license? Commissioned? Stock?) or commission/generate a replacement with a documented license before mainnet |
| Logo | `public/logo.png` | 114 KB | ⚠️ Undocumented | Same as above (`refs/originals/logo.png`) | Same as above |
| Skybox | `public/skybox.jpg` | 130 KB | ⚠️ Undocumented | Same as above (`refs/originals/skybox.png`) | Same as above |
| Ground texture | `public/ground.jpg` | 449 KB | ⚠️ Undocumented | Same as above (`refs/originals/ground.png`) | Same as above |
| Building texture | `public/building.jpg` | 360 KB | ⚠️ Undocumented | Same as above (`refs/originals/building.png`) | Same as above |
| Favicon | `public/favicon.png` | 45 KB | ⚠️ Undocumented | No standalone provenance record | Confirm or regenerate from a documented-license source asset |
| OG share card base | `public/og-card.jpg` / `server/assets/card-base.jpg` (identical bytes) | 124 KB | ⚠️ Undocumented | Same underlying image as the hero/logo set | Same as above |

**Why these are ⚠️ and not 🚫:** unlike the music (below), no team member's own words describe
these images as copyrighted third-party material — but the absence of a *positive* license record
is itself not sufficient to ship on a program whose "no unlicensed music remains" launch gate
implies the same standard applies to imagery. Treat as blocked-pending-confirmation, not confirmed-safe.

## Fonts

| Asset | Path | Size | Status | Source/provenance | Required action |
|---|---|---|---|---|---|
| Anton | `server/assets/anton.ttf` | 171 KB | ✅ Documented (per prior project context, not re-verified by this pass) | Google Fonts' Anton, distributed under the SIL Open Font License | Add the actual `OFL.txt` license file alongside `anton.ttf` in `server/assets/` so the license travels with the binary — currently absent |

## Audio — production music (5 tracks)

| Mode label (in-game) | Filename | Size | Status | Real-world source | Required action |
|---|---|---|---|---|---|
| SUPER RUSH | `super-rush.mp3` | 3.98 MB | 🚫 **Must remove** | A real, commercially-released song (title/artist withheld from this document; identifiable via the local, git-ignored `refs/` folder's filenames on the developer's machine) | Remove from every deployed environment; replace with a licensed/commissioned/generated track before any further production deploy |
| BUTTERFLY WAR | `butterfly-war.mp3` | 4.53 MB | 🚫 **Must remove** | Same as above | Same as above |
| NIGHT CLOUD | `night-cloud.mp3` | 2.14 MB | 🚫 **Must remove** | Same as above | Same as above |
| GREEN MOTION | `green-motion.mp3` | 3.51 MB | 🚫 **Must remove** | Same as above | Same as above |
| VAMP CHARGE | `vamp-charge.mp3` | 2.50 MB | 🚫 **Must remove** | Same as above | Same as above |

**Verified during the prior assessment:** these five files were confirmed live (HTTP 200) at
`https://trybullrush.xyz/assets/audio/music/*.mp3` in production, despite being `.gitignore`d and
never committed to this repository. **The git-ignore rule protects the GitHub repo's optics; it
does nothing to protect the live deployment.** This is the concrete incident that motivates the
forbidden-asset build check below.

**Mode labels are safe to keep** — `SUPER RUSH`, `BUTTERFLY WAR`, `NIGHT CLOUD`, `GREEN MOTION`,
`VAMP CHARGE` are original in-game mood-slot names invented for this project, not the underlying
songs' real titles. Only the audio *files themselves* are the legal problem.

**Until replacement tracks exist, ship with music disabled.** The game's SFX are synthesized
in-browser (`src/audio.ts`, `AudioEngine.sfx()`) and do not depend on any external file — the game
is fully playable and has audio feedback with zero music files present.

## Enforcement

`scripts/check-forbidden-assets.mjs` scans `public/` (and, if present, any build output directory)
for the five filenames above and fails the build/deploy with a non-zero exit code and a clear
message if any are found. It is wired into `npm run build`. Wire it into CI (Phase 14) as a
required check once CI exists, so no future deploy — manual or automated — can reintroduce these
files without a human explicitly bypassing a failing build.

## Open items for the project owner

1. Commission, license, or generate five replacement tracks (or fewer — the radio system degrades
   gracefully to however many tracks exist).
2. Confirm or replace the provenance of every ⚠️ image above.
3. Add `server/assets/OFL.txt` (the Anton license) alongside the font file.
