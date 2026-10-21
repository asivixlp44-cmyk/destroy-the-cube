# [ASMR] Destroy the Cube!

A multiplayer blaster game for the browser, built with **Three.js** and **Colyseus** for Bloxity. A giant cube of soft, squishy blocks stands in the middle of a sunny arena. Blast it apart with your bubble blaster, collect the little cubes that drop, sell them at the base for **Coins**, upgrade your blaster on the upgrade computer, and **destroy the whole cube**. Every cube you destroy unlocks a bigger, tougher one (ten in all). It clones the Roblox game *[[ASMR] Destroy the Cube!](https://www.roblox.com/games/95423743730589/Destroy-the-Cube)* (see the video in `reference/`).

**There are no in-app purchases.** Everything is bought with Coins or Gems (Gems come from quests, gem blocks, destroying cubes, gifts and daily rewards).

It shares its engine with the other Legion games (server, Bloxity login and avatars, the top games' character animation and lighting, profiles, saves; forked from Escape Angry Head). The cube, the blasters, the arena, the HUD and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player movement and collision with the cube's blocks, the over-the-shoulder / first-person camera, aiming, shooting, bounces, explosions, the hit prediction and its reconciliation with the server, dropped cubes, selling, the guide, other players, network, level warps), `cube.js` (the cube on screen: one instanced mesh of the visible blocks with its own shader, the hidden blocks as dark filler boxes, the dropped cubes, the shards and the balls, all animated on the GPU), `blaster.js` (the blasters, built in code), `world.js` (the arena, the base, the leaderboards, the guide arrow and chevrons, each cube's colours), `lobby.js` (the lobby: the DEPARTURES terminal, the cube pads, the plaza and its shops), `engine.js` (renderer, sky, lights, moods), `fx.js` (quality, particles), `audio.js` (music and sounds), `ui.js` + `index.html` (HUD and panels) |
| `server/` | Colyseus 0.18 server: the `cube` room (`CubeRoom.js`: the lobby (level -1), the cube, hits, bounces, explosions, TNT, drops, the backpack, selling, upgrades, blasters, ammo, passes, boosts, quests, gifts, daily rewards, codes, the clear and its rewards), profiles, leaderboards, play stats |
| `shared/` | `config.js` (the cubes, block tiers, upgrades, blasters, ammo, passes, quests, rewards), `cube.js` (the cube generated from a seed, the voxel ray cast, bounce targets), `arena.js` (where the base, the sell machine and the shops stand), used by both sides |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2667
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5229 (the client talks to the server on port 2667; `VITE_SERVER_URL` overrides that). Dev builds (or a build with `VITE_QA=1`) expose `window.__qa` (teleport, aim, fire, hold fire, first person, warp to a cube, state). Restart the server after changing `shared/`.

## Gameplay

- **The lobby** (every visit starts here, like the reference): a floating island high above a sea of clouds. The big curved **DEPARTURES** terminal stands at the north end; in front of it a ring of ten glowing **cube pads** (a spinning hologram of each cube, how many are playing it, locked ones say what to destroy first) round the big **QUICK PLAY** pad (your newest cube). Stand on a pad for a moment to warp into that cube's room. A rainbow candy walkway leads from the spawn to QUICK PLAY between planters, lamp posts and benches; the upgrade computers and the leaderboards stand to the west, the blaster gallery, ball skins and the gem crystal to the east, the daily-reward gift, a fountain, a giant half-broken rainbow cube, a sky deck with spaceship pods, waterfalls off the edge, balloons and floating islands all round. The console line at the bottom says "GO TO A PAD TO START A GAME!".
- **The arena**: the cube stands in the middle of a pale tiled plaza with a glowing water ring (the reference's). To the south is the **BLASTER BASE**, a curved white-and-blue building open toward the cube: the **SELL machine** in the middle (a green beam of light shows where it is), the **upgrade computer**, the **blaster rack**, the **ball jars**, the **gem machine** and the **ball skins**. The **leaderboards** (most cubes destroyed, most blocks broken, top coins) and the **LOBBY** portal stand outside. A candy-coloured ring runs round the foot of the cube. Round trees, rolling hills, windmills, a rainbow and floating glow cubes all round.
- **The loop** (the reference's tutorial, step by step): *Break cubes (5)* → *Collect dropped cubes (10)* → *Sell cubes (10)* → *Buy an upgrade* → +5 Gems, then two quests at a time on the left, each paying Gems. A bouncing arrow and white chevrons on the ground lead the way during the tutorial (and to the sell machine whenever the backpack is full).
- **Blasting**: each ball hits a block, then **bounces** on to nearby blocks (1 bounce to start). The block under the crosshair glows and shows its name, a health bar and its hit points; hit markers flash on the crosshair (gold when it breaks). Blocks squish, dent and crack as they lose hit points, then burst into bouncing chunks thrown away from the shot and pop into little cubes; their neighbours wobble. A piece of the cube that is no longer held up by anything breaks off and falls (it lands on whatever is below and its blocks drop as little cubes). One block in ten wears one of the cube's two accent colours. The inner blocks are tougher (striped, like the reference's Tier 2 blocks). Special blocks: **gold** (sells for 10x), **gem** (a Gem), **TNT** (blows up its neighbours, chain reactions), **rainbow** (sells for 50x).
- **Dropped cubes** fall, bounce, stack up ("12x") and fly to you when you're in **pickup range**. The **backpack** holds 10 to start ("Inventory Full!": sell at the base, or upgrade it). Stand on the green SELL pad to sell everything.
- **The progress bar** along the top shows how much of the cube is gone. When only 6% is left the last blocks glow; at 1.2% the rest crumbles by itself: **CUBE DESTROYED!** Everyone who broke blocks gets the cube's Coins and Gems (x2 the first time), a win, their time (best time per cube), and the next cube unlocks. Cubes still lying around are sold at half price. A new cube builds itself (the blocks rain down) 9 seconds later.
- **The ten cubes**: Sky (10x10x10, the reference's blue cube), Bubblegum, Lime Jelly, Lava, Frost, Toxic, Golden, Galaxy, Rainbow and the MEGA CUBE (19x19x19, 6,859 blocks). Each has its own colours, sky and neon. Go to any cube you've opened from its pad in the lobby or the CUBES panel: a quick warp to a room playing that cube. The LOBBY button (and the portal) takes you back.
- **Upgrades** (the upgrade computer, the reference's skill tree; Coins, permanent): Damage (10 up to 96,000), Fire Rate (0.25 s down to 0.085 s), Bounces (1 to 6), Backpack (10 to 6,000), Pickup Range (10 to 46 studs), Explosion Size (6 to 16 studs, for Exploding Balls).
- **Blasters** (Shop): Bubble Blaster (free), Twin Blaster (2.5K), Splash Blaster (15K, three balls), Mega Cannon (150K, exploding), Minigun (40 Gems), Plasma Rifle (2.5M, pierces three blocks), Galaxy Blaster (40M).
- **Balls** (the hotbar, 1 / 2 / 3): Bubble Balls (never run out), Bouncy Balls (1K: +3 bounces, 40 max), Exploding Balls (25K: blow up everything nearby, 15 max). The special ones refill by themselves.
- **Gem Shop**: Instant Sell Magnet (12: cubes sell as you pick them up), Super Magnet (8), Giant Backpack (15), Lucky Hands (30), x2 Coins (60); boosts x2 Coins, x2 Damage, Rapid Fire. **Ball skins** for Coins.
- **Rewards**: playtime gifts at 1 to 60 minutes (a chip under the progress bar counts down to the next one), daily rewards for a 7-day streak, codes (`DESTROY`, `CUBE`, `ASMR`, `BLASTER`, `LEGION`, `BLOXITY`, `RELEASE`), Friend Boost (+10% Coins per Bloxity friend in the server, up to +50%).

Pacing (an economy sim of a typical player, `qa/econ.mjs` in the QA notes): Cube 1 takes about 7-8 minutes with the tutorial, Cube 3 is reached around 15 minutes, all ten take 3-4 hours.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Look | Mouse (click the game to lock the mouse; Esc frees it) | Right stick | Drag |
| Aim down the sights | Right click (hold) | LT | |
| Sprint | Shift | L3 | Push the joystick all the way |
| Blast | Left click (hold) | RT | FIRE (hold), or tap a block; AUTO fires whenever you aim at the cube |
| Jump | Space | A | JUMP |
| Ball type | 1 / 2 / 3 | LB / RB | Hotbar |
| Use (computer, shops, portal) | E | X | The prompt |
| Upgrades / Shop / Cubes | Tab / G / C | Start / Y / Back | Buttons on the right |
| First / third person (first person is the default in the arena) | V (or scroll) | D-pad | 👁️ |
| Back to the lobby | | | LOBBY button |
| Auto fire | F | | AUTO |

If the page can't lock the mouse (some embeds don't allow it), it switches to drag-to-look: click a block to blast it, hold to keep blasting.

## Sound

- **Music**, "Cube Pop": an original, bright 112 BPM piece in F major. A woody marimba rolls arpeggios over a warm pad; a soft kick, finger snaps, a shaker and a round bass join in, a bubbly bell sings the tune, it breaks down to the pad and little bubble pops, and comes back an octave up; 64 bars. Menus and the party are calm, blasting brings the full groove.
- All effects synthesized, made to feel nice (ASMR): soft "bloop" shots (the Mega Cannon a deep thump), plastic taps when a block is hit, squishy pops when one breaks, gold chimes, gem sparkles, TNT booms, a pickup blip that climbs with your combo, the sell machine's ka-ching and coin shower, upgrade and quest fanfares, the CUBE DESTROYED! fanfare, squishy footsteps on the blocks.

## Graphics and performance

- **The blocks** are soft rounded cubes (one bevel step, smooth normals). Their shader does the rest: the squish and white flash when hit, cracks that spread as they lose hit points, the stripes of the inner blocks, the gold glint, the gem's glowing diamond, the TNT band, the rainbow, the glow of the last blocks, and the whole cube raining down when it builds. Only the blocks you can see are drawn (one draw call); the hidden ones are plain dark boxes so the grooves between blocks look solid.
- **Dropped cubes, shards, falling chunks and balls** are written once when they start and flown by the GPU (nothing is re-uploaded every frame: per-frame instance uploads stall the GPU on Windows). Each pool only draws while something in it is alive, and only up to its highest slot in use.
- **Shooting feel**: the first-person blaster sways, bobs, kicks back with each shot (the view kicks up and the field of view punches), aims down the sights, lowers while sprinting; a muzzle flash, a glowing ball with a streak, an impact ring on the block's face.
- The **lighting is the top games'** (hemisphere 1.1, ambient 0.45, sun 1.5, PCF shadows, no tone mapping); a cube's mood only tints it. The **character animation is the top games'** (`animator.js`), holding the blaster where you aim.
- **Built for weak PCs and phones**: only matte (Lambert) and unlit materials, no reflections, no environment map, no post-processing. The arena is merged per material. Every shader is compiled and every texture uploaded behind the loading screen (36 shaders; the count stays flat while playing, the lobby included). Phones and weak PCs start on Low (no shadow code, 1x pixel ratio); if the frame rate drops the game steps down by itself.
- Measured (headless Chrome, real GPU): desktop 1080p High 125-144 FPS while blasting, 143 in the lobby; phone size on Low with the CPU slowed 4x 99-106 FPS blasting, 137 in the lobby; desktop Medium with the CPU slowed 4x 61-73 FPS blasting, 72 in the lobby. The lobby draws about 240 draw calls / 140K triangles a frame. Loads in about 2.5 s.

## Multiplayer and saves

- Everyone starts in the **lobby** room (up to 24 players), then warps to a room for the cube they picked. Cube rooms are matched by cube: everyone in a room plays the same cube (up to 8 players, the busiest room first). The pads show how many play each cube (`GET /api/rooms`). Movement is client-side. Hits come in as the chain of blocks one ball touched; the server checks the fire rate, the range, the bounce reach and the ammo, takes the hit points off, breaks blocks, sets off TNT and explosions, and sends what changed to everyone 20 times a second. Your game shows a hit straight away and puts back anything the server didn't agree with. Dropped cubes are yours only; pickups, sales and every purchase are checked on the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally; saved within 1.5 s of purchases and clears and every 10 s.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (locally the stats are open): session lengths (phones and desktop apart), tutorial completion, cubes destroyed, upgrades bought, the best cube reached, FPS.

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/destroy-the-cube-server`, Legion rollout, client upload. Play at https://destroy-the-cube.play.bloxity.io once the app `destroy-the-cube` exists on hosting.bloxity.io and the repo has the `LEGION_DEPLOY_TOKEN` secret.
