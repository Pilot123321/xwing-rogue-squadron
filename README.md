# X-Wing · Rogue Squadron

A web-based **arcade Star Wars space-combat game**. Fly a T-65 X-wing, clear
escalating waves of TIE fighters, manage your shields and laser heat, and lock
targets with the targeting computer — all rendered with Three.js and procedural
audio, no external assets.

> This project started life as a high-fidelity F-16C flight sim. The headless
> 6-DOF F-16 flight-dynamics **core** (`src/core/`) and its test suite are still
> here and still pass — the game just doesn't use them. The browser game runs on
> a purpose-built **arcade space-flight** model (`src/web/ship.ts`) where, as in
> the classic X-Wing / Rogue Squadron games, velocity tracks the nose.

## Quick start

```bash
npm run serve    # build the web bundle and serve at http://localhost:8092
npm test         # (legacy) run the F-16 airframe + FLCS verification suites
```

Open `http://localhost:8092/index.html` in a recent Chrome/Edge.

## Play online

**▶ Play now (single-player):** https://pilot123321.github.io/xwing-rogue-squadron/

- **Single-player** is hosted on **GitHub Pages** from the `gh-pages` branch
  (the contents of `web/`). To republish after changes: `npm run build` then
  `git subtree push --prefix web origin gh-pages`. Share the URL — friends play
  in the browser, no install.
- **Multiplayer** (shared-space dogfight) needs the Node WebSocket server
  (`server.js`) running on a host that supports Node + WebSockets — e.g.
  [Render](https://render.com), [Railway](https://railway.app) or
  [Fly.io](https://fly.io). Deploy the repo with start command `npm start`
  (it serves the client **and** the socket on the same port). Everyone who opens
  that host's URL shares the same battle. The client auto-connects to its own
  origin, so the Pages build is single-player; a Node-hosted build is
  multiplayer.

### Controls

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `W` / `S` | pitch (nose up / down) | `Space` | fire lasers (hold) |
| `A` / `D` | roll | `F` | fire proton torpedo |
| `Q` / `E` | yaw | `T` | lock nearest TIE |
| `Shift` / `Ctrl` | throttle | `X` | S-foils (attack / cruise) |
| `Z` | boost (hold) | `V` | cockpit / chase view |

Gamepad axes (sticks + right trigger for boost) are used automatically when present.

### How to play

- **Shields** absorb hits and regenerate a few seconds after you stop taking fire;
  once they're gone, **hull** damage is permanent until you respawn.
- **Lasers overheat** if you hold the trigger too long — watch the LASER bar.
- The **green lead pip** shows where to aim at your locked target; put your bolts
  on the pip, not the box.
- **Proton torpedoes** home onto your locked TIE — save them for tough angles.
- Clear every TIE in a wave to advance; each wave brings more fighters.

## Architecture

```
src/web/                  (the X-wing game)
  ship.ts     arcade space-flight model for the player (nose-follows-velocity)
  xwing.ts    procedural T-65 X-wing model (animated S-foils + engine glow)
  tie.ts      procedural TIE/ln fighter model
  space.ts    starfield, planet, distant Death Star, Imperial Star Destroyer
  enemies.ts  TIE squadron: spawning, pursuit AI, lead-aimed firing
  lasers.ts   blaster bolts (swept collision) + homing proton torpedoes
  effects.ts  procedural explosions / debris / impact flashes
  scene.ts    game world + renderer + camera + waves/score/shields
  hud.ts      targeting-computer HUD (reticle, target box, lead pip, bars)
  audio.ts    procedural Web Audio: lasers, engine, explosions, warnings
  input.ts    keyboard + gamepad -> flight controls
  main.ts     fixed-step game loop wiring everything together

src/core/     (legacy, unused by the game) tested 6-DOF F-16 flight model + FLCS
test/         F-16 core verification harnesses (run with `node test/<file>.ts`)
```

## A note on assets

Star Wars is a trademark of Lucasfilm/Disney; this is a non-commercial fan tech
demo. **No copyrighted art, models, or audio are used** — every ship, the
starfield, the Death Star, and all sound effects are generated procedurally from
primitive geometry and the Web Audio API.

## Roadmap

- Capital-ship objectives (trench run on the Star Destroyer / Death Star).
- Wingmen and squadron commands.
- Asteroid fields and collision damage.
- Power management (divert energy: lasers / engines / shields).
