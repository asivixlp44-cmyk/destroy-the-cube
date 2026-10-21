// The LOBBY (the reference's terminal plaza): a floating island high above a sea of clouds. The big
// curved DEPARTURES terminal with its coloured roof panels stands at the north end; in front of it a
// ring of ten glowing CUBE PADS (one per cube, a spinning hologram of it, how many are playing it)
// round the big QUICK PLAY pad; the upgrade computers and the leaderboards to the west; the blaster
// gallery (glowing display cases), the ball skins and the gem crystal to the east; the daily-reward
// gift, a fountain, a sky deck with spaceship pods up a flight of stairs, trees round the rim,
// waterfalls off its edge, little floating islands, balloons, floating cubes and a rainbow.
//
// Stand on a cube pad (or QUICK PLAY) for a moment to warp into that cube's room. Everything static
// is merged per material; the few moving things are single objects or shader-driven.
import { T, V3, scene, mat, texFrom, sharedTex, textCanvas, solidBox, tickers, mergeChildren } from './engine.js';
import { CUBES, LEVELS, levelOpen, rngFrom } from '../../shared/config.js';
import { LOBBY } from '../../shared/arena.js';
import { actions } from './state.js';
import { U, roundedBlockGeo } from './cube.js';
import { blasterModel } from './blaster.js';
import { cv, ringGeo, box, sign, prompt, makeBoard, grassTex, waterTex, sharedMats } from './world.js';

export const lobbyRoot = new T.Group();
lobbyRoot.name = 'lobby';
lobbyRoot.visible = false;
scene.add(lobbyRoot);
const LX = LOBBY.x, LZ = LOBBY.z, RR = LOBBY.r;
const R = rngFrom(777);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const movers = [];
function mover(o) { o.userData.moving = true; lobbyRoot.add(o); movers.push(o); return o; }

// ----- textures -----
// soft pastel tiles (most white, some pink / lemon / mint / sky / lilac) with white grout
const TILE_TINTS = ['#ffffff', '#ffffff', '#f4f9ff', '#ffe4f1', '#fff4c4', '#dcffe8', '#dcf1ff', '#ece2ff'];
const floorTex = texFrom(cv(512, (x, N) => {
    x.fillStyle = '#f0f7ff'; x.fillRect(0, 0, N, N);
    const tl = N / 8;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = TILE_TINTS[(Math.random() * TILE_TINTS.length) | 0]; x.fillRect(i * tl, j * tl, tl, tl); }
    for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(140,170,210,${Math.random() * 0.07})`; x.fillRect(Math.random() * N, Math.random() * N, 2, 2); }
    x.strokeStyle = '#cfe0f2'; x.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * N / 8, 0); x.lineTo(i * N / 8, N); x.stroke(); x.beginPath(); x.moveTo(0, i * N / 8); x.lineTo(N, i * N / 8); x.stroke(); }
    x.strokeStyle = '#5ae4ff'; x.lineWidth = 5;
    x.strokeRect(2.5, 2.5, N - 5, N - 5);
}), true);
const rimGrass = grassTex.clone();
rimGrass.repeat.set(90, 2);
rimGrass.needsUpdate = true;

// ----- the cube pads -----
export const lobbyPads = [];
export let quickPad = null;
const PAD_C = { x: LX, z: LZ - 8 };
const beamShader = (color) => new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
    uniforms: { uTime: U.uTime, uColor: { value: new T.Color(color) }, uOn: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uOn; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * (0.3 + 0.18 * sin(vUv.x * 50.0 + uTime * 4.0) + 0.12 * sin(vUv.y * 20.0 - uTime * 6.0)) * uOn; gl_FragColor = vec4(uColor * a, a); }`,
});
function padLabelLines(p) {
    const c = CUBES[p.level];
    const lines = [{ t: 'CUBE ' + (p.level + 1), c: '#ffffff', s: '#10203a', px: 34 }, { t: c.name.toUpperCase(), c: hex(c.neon === 0xffffff ? 0xff8ad8 : c.neon), s: '#10203a', px: 52 }];
    if (!p.open) lines.push({ t: '🔒 Destroy Cube ' + p.level, c: '#ffd0d0', s: '#3a0a10', px: 32 });
    else lines.push({ t: p.count ? '▶ ' + p.count + ' playing' : p.cleared ? '✔ PLAY AGAIN' : '▶ PLAY!', c: p.count ? '#8aff7a' : '#ffffff', s: '#10203a', px: 36 });
    return lines;
}
function buildPads(g) {
    for (let i = 0; i < LEVELS; i++) {
        const c = CUBES[i];
        const a = (205 + i * (130 / (LEVELS - 1))) * Math.PI / 180;
        const x = PAD_C.x + Math.cos(a) * 46, z = PAD_C.z + Math.sin(a) * 46;
        const neon = c.neon === 0xffffff ? 0xff8ad8 : c.neon;
        const base = new T.Mesh(new T.CylinderGeometry(5.6, 6.2, 0.8, 36), mat(0xf6faff)); base.position.set(x, 0.4, z); g.add(base);
        const rim = new T.Mesh(new T.TorusGeometry(5.6, 0.28, 6, 40).rotateX(Math.PI / 2), mat(neon, { neon: true })); rim.position.set(x, 0.85, z); g.add(rim);
        const discMat = new T.MeshBasicMaterial({ color: neon, transparent: true, opacity: 0.45, depthWrite: false });
        const disc = mover(new T.Mesh(new T.CircleGeometry(5.2, 36).rotateX(-Math.PI / 2), discMat)); disc.position.set(x, 0.84, z);
        const beam = mover(new T.Mesh(new T.CylinderGeometry(4.6, 5.2, 34, 28, 1, true), beamShader(neon))); beam.position.set(x, 17.8, z); beam.renderOrder = 4;
        const holo = mover(new T.Mesh(roundedBlockGeo(3, 0.55), mat(c.colors[0], { emissive: c.colors[1], ei: 0.3 }))); holo.position.set(x, 6, z); holo.castShadow = true;
        const lbl = new T.Sprite(new T.SpriteMaterial({ map: sharedTex('blank', () => cv(4, () => {})), transparent: true, depthWrite: false, toneMapped: false }));
        lbl.position.set(x, 11.2, z); lbl.renderOrder = 8;
        mover(lbl);
        solidBox(x, 0.4, z, 10, 0.8, 10, { mat: 'floor' });
        lobbyPads.push({ level: i, x, z, r: 5.2, disc, discMat, beam, holo, lbl, open: i === 0, count: 0, cleared: false, key: '', phase: i * 0.7 });
    }
    // QUICK PLAY: the big pad in the middle (your best cube)
    const x = PAD_C.x, z = PAD_C.z;
    const base = new T.Mesh(new T.CylinderGeometry(8.4, 9.2, 1, 48), mat(0xffffff)); base.position.set(x, 0.5, z); g.add(base);
    const discMat = new T.MeshBasicMaterial({ color: 0x46ff6a, transparent: true, opacity: 0.55, depthWrite: false });
    const disc = mover(new T.Mesh(new T.CircleGeometry(8, 48).rotateX(-Math.PI / 2), discMat)); disc.position.set(x, 1.04, z);
    const ringMat = new T.MeshBasicMaterial({ color: 0x46ff6a });
    const ring = mover(new T.Mesh(new T.TorusGeometry(8.4, 0.4, 6, 56).rotateX(Math.PI / 2), ringMat)); ring.position.set(x, 1.1, z);
    const beam = mover(new T.Mesh(new T.CylinderGeometry(7.4, 8.2, 44, 32, 1, true), beamShader(0x7dff8a))); beam.position.set(x, 23, z); beam.renderOrder = 4;
    const play = new T.Sprite(new T.SpriteMaterial({ map: sharedTex('quickPlay', () => textCanvas([{ t: 'PLAY!', g: ['#c8ff6a', '#2ae85a'], s: '#0a3a10', px: 120, w: 700 }], 512)), transparent: true, depthWrite: false, toneMapped: false }));
    play.scale.set(16, 16 * play.material.map.image.height / 512, 1); play.position.set(x, 9, z); play.renderOrder = 8;
    mover(play);
    const lbl = new T.Sprite(new T.SpriteMaterial({ map: sharedTex('blank', () => cv(4, () => {})), transparent: true, depthWrite: false, toneMapped: false }));
    lbl.position.set(x, 14, z); lbl.renderOrder = 8;
    mover(lbl);
    solidBox(x, 0.5, z, 16, 1, 16, { mat: 'floor' });
    quickPad = { x, z, r: 7.6, disc, discMat, ring, ringMat, beam, play, lbl, level: 0, key: '' };
}
// Updates the pads' labels: open or locked, how many are playing each cube right now
export function setPadInfo(S, counts) {
    for (const p of lobbyPads) {
        p.open = levelOpen(S, p.level);
        p.count = (counts && counts[p.level]) || 0;
        p.cleared = !!(S.clears || {})[p.level];
        const key = p.open + '|' + p.count + '|' + p.cleared;
        if (key === p.key) continue;
        p.key = key;
        const lines = padLabelLines(p);
        const map = sharedTex('pad|' + JSON.stringify(lines), () => textCanvas(lines, 512));
        p.lbl.material.map = map; p.lbl.material.needsUpdate = true;
        p.lbl.scale.set(10.5, 10.5 * map.image.height / 512, 1);
        // a locked cube keeps its colour, just without the glow
        p.holo.material = p.open ? mat(CUBES[p.level].colors[0], { emissive: CUBES[p.level].colors[1], ei: 0.3 }) : mat(CUBES[p.level].colors[1]);
        p.beam.material.uniforms.uOn.value = p.open ? 1 : 0.25;
    }
    // QUICK PLAY: the newest cube you've opened
    const best = Math.min(LEVELS - 1, S.unlocked || 0);
    quickPad.level = best;
    const key = 'q' + best;
    if (key !== quickPad.key) {
        quickPad.key = key;
        const lines = [{ t: 'QUICK PLAY', c: '#ffffff', s: '#0a3a10', px: 48 }, { t: CUBES[best].ic + ' Cube ' + (best + 1) + ': ' + CUBES[best].name, c: '#c8ff8a', s: '#0a3a10', px: 34 }];
        const map = sharedTex('pad|' + JSON.stringify(lines), () => textCanvas(lines, 512));
        quickPad.lbl.material.map = map; quickPad.lbl.material.needsUpdate = true;
        quickPad.lbl.scale.set(12, 12 * map.image.height / 512, 1);
    }
}
// The pad you're standing on (or null)
export function padAt(x, z) {
    if (quickPad && (x - quickPad.x) ** 2 + (z - quickPad.z) ** 2 < quickPad.r * quickPad.r) return quickPad;
    for (const p of lobbyPads) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return p;
    return null;
}
// How far along the countdown the pad you stand on is (0..1), for its glow
export function padCharge(p, k) {
    for (const q of [...lobbyPads, quickPad]) { q.discMat.opacity = q === p ? 0.45 + 0.5 * k : q === quickPad ? 0.55 : 0.45; }
}

// ----- the DEPARTURES terminal -----
function buildTerminal(g) {
    const white = mat(0xf6faff), glass = mat(0x6ac4f4), glassD = mat(0x3a8ad8), trim = mat(0xd6e6f6), blue = mat(0x2a78e8);
    const neon = mat(0x3ae0ff, { neon: true });
    const AC = { x: LX, z: LZ - 10 }, RA = 74, A0 = 226, A1 = 314, step = 6;
    const P = (geo, m, x, y, z, ry) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    for (let a = A0; a < A1; a += step) {
        const m = (a + step / 2) * Math.PI / 180, w = 2 * Math.PI * RA * step / 360 + 0.2;
        const x = AC.x + Math.cos(m) * RA, z = AC.z + Math.sin(m) * RA, ry = -m + Math.PI / 2;
        const mid = Math.abs(a + step / 2 - 270) < step;
        P(new T.BoxGeometry(w, 3, 2.4), white, x, 1.5, z, ry);
        P(new T.BoxGeometry(w, 19, 0.9), mid ? glassD : glass, x, 12.5, z, ry);
        P(new T.BoxGeometry(w, 5, 2.6), white, x, 24.5, z, ry);
        P(new T.BoxGeometry(w + 0.05, 0.6, 2.8), neon, x - Math.cos(m) * 0.2, 21.8, z - Math.sin(m) * 0.2, ry);
        // window frames
        for (const yy of [8, 15]) P(new T.BoxGeometry(w, 0.4, 1.2), trim, x, yy, z, ry);
    }
    for (let a = A0; a <= A1; a += step) {
        const m = a * Math.PI / 180, x = AC.x + Math.cos(m) * RA, z = AC.z + Math.sin(m) * RA;
        P(new T.BoxGeometry(2, 27, 2), white, x, 13.5, z, -m + Math.PI / 2);
    }
    // the curved roof: a thick white slab with a blue edge, overhanging the front
    const span = (A1 - A0) * Math.PI / 180;
    const roof = P(new T.TorusGeometry(RA + 4, 10, 4, 48, span).rotateX(Math.PI / 2), white, AC.x, 28.5, AC.z);
    roof.scale.y = 0.16; roof.rotation.y = -A0 * Math.PI / 180;
    const edge = P(new T.TorusGeometry(RA - 5.5, 0.9, 8, 48, span).rotateX(Math.PI / 2), blue, AC.x, 28.5, AC.z);
    edge.rotation.y = -A0 * Math.PI / 180;
    const edgeN = P(new T.TorusGeometry(RA - 5.6, 0.3, 6, 48, span).rotateX(Math.PI / 2), neon, AC.x, 27.4, AC.z);
    edgeN.rotation.y = -A0 * Math.PI / 180;
    // the back of the building and its sides
    const back = P(new T.CylinderGeometry(RA + 22, RA + 22, 26, 40, 1, true, -A1 * Math.PI / 180 + Math.PI / 2, span), white, AC.x, 13, AC.z);
    back.material = white;
    for (const a of [A0, A1]) {
        const m = a * Math.PI / 180;
        const x0 = AC.x + Math.cos(m) * RA, z0 = AC.z + Math.sin(m) * RA, x1 = AC.x + Math.cos(m) * (RA + 22), z1 = AC.z + Math.sin(m) * (RA + 22);
        const len = Math.hypot(x1 - x0, z1 - z0);
        P(new T.BoxGeometry(len, 26, 2), white, (x0 + x1) / 2, 13, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0));
    }
    // colliders along the front, and the inside closed off
    for (let a = A0; a <= A1; a += 2.5) {
        const m = a * Math.PI / 180;
        solidBox(AC.x + Math.cos(m) * RA, 14, AC.z + Math.sin(m) * RA, 3.2, 28, 3.2, { mat: 'wall' });
    }
    // the coloured panels on the roof (the reference's)
    [[0xff3aa8, 244], [0xffd21e, 262], [0x2ad8ff, 280], [0x7dff3a, 298]].forEach(([c, a]) => {
        const m = a * Math.PI / 180, x = AC.x + Math.cos(m) * (RA + 10), z = AC.z + Math.sin(m) * (RA + 10), ry = -m + Math.PI / 2;
        P(box(15, 12, 1.4, 0.4), mat(0xffffff), x, 37, z, ry);
        P(box(13, 10, 1.6, 0.3), mat(c, { emissive: c, ei: 0.25 }), x, 37, z, ry);
        P(new T.BoxGeometry(1, 6, 1), trim, x, 30.5, z, ry);
    });
    // the entrance: dark glass doors under a little canopy
    const em = 270 * Math.PI / 180, ex = AC.x + Math.cos(em) * (RA - 1.4), ez = AC.z + Math.sin(em) * (RA - 1.4);
    P(box(14, 9, 0.6, 0.2), mat(0x1a3a6a), ex, 4.5, ez, -em + Math.PI / 2);
    P(box(18, 0.8, 6, 0.3), white, ex, 9.5, ez + 2.4, -em + Math.PI / 2);
    P(new T.BoxGeometry(18.4, 0.3, 0.3), neon, ex, 9.1, ez + 5.3, -em + Math.PI / 2);
    sign('DEPARTURES', '#ffffff', '#1a4aa8', AC.x, 32.4, AC.z - RA + 4.6, 34, 0, lobbyRoot);
}

// ----- the island: tiled floor, neon rings, grass rim, rails, the rock under it -----
function buildIsland(g) {
    const floorG = new T.CircleGeometry(RR, 96).rotateX(-Math.PI / 2);
    floorG.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (RR * 2 / 40); });
    const floor = new T.Mesh(floorG, new T.MeshLambertMaterial({ map: floorTex, color: 0xffffff }));
    floor.position.set(LX, 0.02, LZ); floor.receiveShadow = true; g.add(floor);
    // glowing rings and spokes in the floor
    const neonC = mat(0x3ae0ff, { neon: true }), neonP = mat(0xff6ad8, { neon: true });
    for (const [r0, m] of [[18, neonP], [34, neonC], [70, neonC], [104, neonP]]) { const o = new T.Mesh(ringGeo(r0, r0 + 0.6, 128), m); o.position.set(LX, 0.06, LZ - (r0 < 40 ? 8 : 0)); g.add(o); }
    for (let k = 0; k < 16; k++) {
        if (k === 4) continue; // the candy walkway runs there
        const a = k / 16 * Math.PI * 2, o = new T.Mesh(new T.PlaneGeometry(0.5, 32).rotateX(-Math.PI / 2), neonC);
        o.position.set(LX + Math.cos(a) * 86, 0.06, LZ + Math.sin(a) * 86); o.rotation.y = -a + Math.PI / 2; g.add(o);
    }
    // grass rim and the island's earth and rock underneath
    const rim = new T.Mesh(ringGeo(RR, RR + 12, 96), new T.MeshLambertMaterial({ map: rimGrass, color: 0xffffff }));
    rim.position.set(LX, 0.05, LZ); rim.receiveShadow = true; g.add(rim);
    const dirt = new T.Mesh(new T.CylinderGeometry(RR + 12, RR + 8, 8, 72, 1, true), mat(0x8a6a48)); dirt.position.set(LX, -4, LZ); g.add(dirt);
    const rock = new T.Mesh(new T.ConeGeometry(RR + 8, 110, 40, 3, true), mat(0x9a8a7a)); rock.rotation.x = Math.PI; rock.position.set(LX, -63, LZ); g.add(rock);
    const rock2 = new T.Mesh(new T.ConeGeometry(RR * 0.6, 70, 24, 2, true), mat(0x7a6a5a)); rock2.rotation.x = Math.PI; rock2.position.set(LX + 30, -90, LZ + 20); g.add(rock2);
    // the rail round the edge (glass panels on white posts, neon on top) and its invisible wall
    const glassM = mat(0xd8f4ff, { opacity: 0.35 }), postM = mat(0xffffff);
    for (let k = 0; k < 72; k++) {
        const a = (k + 0.5) / 72 * Math.PI * 2, x = LX + Math.cos(a) * (RR - 1), z = LZ + Math.sin(a) * (RR - 1), w = 2 * Math.PI * (RR - 1) / 72;
        const o = new T.Mesh(new T.BoxGeometry(w, 3, 0.3), glassM); o.position.set(x, 1.6, z); o.rotation.y = -a + Math.PI / 2; g.add(o);
        const p2 = new T.Mesh(new T.BoxGeometry(0.6, 3.6, 0.6), postM); p2.position.set(LX + Math.cos(a - Math.PI / 72) * (RR - 1), 1.8, LZ + Math.sin(a - Math.PI / 72) * (RR - 1)); g.add(p2);
    }
    const railTop = new T.Mesh(new T.TorusGeometry(RR - 1, 0.18, 6, 128).rotateX(Math.PI / 2), neonC); railTop.position.set(LX, 3.4, LZ); g.add(railTop);
    for (let k = 0; k < 120; k++) { const a = k / 120 * Math.PI * 2; solidBox(LX + Math.cos(a) * (RR - 0.5), 6, LZ + Math.sin(a) * (RR - 0.5), 6.6, 12, 6.6, { mat: 'wall' }); }
}

// ----- the shops round the plaza -----
function buildStations(g) {
    const white = mat(0xf6faff), blue = mat(0x2a78e8), dark = mat(0x22304a), neon = mat(0x3ae0ff, { neon: true });
    const P = (geo, m, x, y, z, ry, parent) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; (parent || g).add(o); return o; };
    // UPGRADES (west): three computers under a canopy, facing the plaza
    const ux = LX - 80, uz = LZ - 16;
    P(box(8, 0.8, 30, 0.3), white, ux - 2, 13, uz);
    P(new T.BoxGeometry(0.4, 0.4, 30.2), neon, ux + 2, 12.5, uz);
    for (const dz of [-10, 0, 10]) {
        P(box(5, 3.4, 4, 0.3), white, ux, 1.9, uz + dz);
        P(box(1, 3, 0.8, 0.2), mat(0xd6e6f6), ux - 0.8, 5.2, uz + dz);
        P(box(0.8, 5.5, 7.5, 0.3), white, ux - 1.2, 8.6, uz + dz);
        const scr = new T.Mesh(new T.PlaneGeometry(6.6, 4.6), new T.MeshBasicMaterial({ map: sharedTex('compScreen', () => cv(4, () => {})), toneMapped: false }));
        scr.position.set(ux - 0.75, 8.6, uz + dz); scr.rotation.y = Math.PI / 2; g.add(scr);
    }
    for (const dz of [-14, 14]) P(new T.CylinderGeometry(0.7, 0.7, 13, 12), white, ux - 4, 6.5, uz + dz);
    solidBox(ux, 3, uz, 6, 6, 32, { mat: 'metal' });
    sign('UPGRADES', '#ffb84a', '#3a2000', ux + 1, 16.5, uz, 18, Math.PI / 2, lobbyRoot);
    prompt({ x: ux + 4, z: uz }, 'Upgrades', () => actions.openUpgrades && actions.openUpgrades(), 13);
    // the leaderboards (MOST PLAYED) behind it
    for (const [key, title, color, dz] of [['wins', '🏆 MOST CUBES DESTROYED', '#ffd84a', 22], ['blocks', '💥 MOST BLOCKS BROKEN', '#5ad8ff', 38], ['coins', '💰 TOP COINS', '#7dff6b', 54]]) {
        makeBoard({ key, title, color, x: LX - 86, z: LZ + dz - 12 }, LX, LZ + 20, lobbyRoot);
    }
    // BLASTERS (east): glowing display cases (the reference's CLASSES gallery)
    const bx = LX + 80, bz = LZ - 16;
    ['blaster', 'twin', 'splash', 'mega'].forEach((id, k) => {
        const z = bz - 13.5 + k * 9;
        P(box(6.4, 2.2, 6.4, 0.3), white, bx, 1.1, z);
        P(new T.BoxGeometry(6.6, 0.3, 6.6), neon, bx, 2.3, z);
        P(new T.BoxGeometry(5.6, 7, 5.6), mat(0x9ae8ff, { opacity: 0.28 }), bx, 5.9, z);
        P(new T.BoxGeometry(5.8, 0.5, 5.8), white, bx, 9.6, z);
        const m = blasterModel(id); m.position.set(bx, 5.6, z); m.rotation.set(0.1, -Math.PI / 2 + 0.4, 0); m.scale.setScalar(0.9);
        g.add(m);
        solidBox(bx, 5, z, 6.6, 10, 6.6, { mat: 'metal' });
    });
    sign('BLASTERS', '#5ae0ff', '#0a2a4a', bx + 0.5, 15, bz, 16, -Math.PI / 2, lobbyRoot);
    prompt({ x: bx - 5, z: bz }, 'Blasters', () => actions.openShop && actions.openShop('guns'), 14);
    // BALL SKINS: a big gumball machine of glowing balls
    const kx = LX + 66, kz = LZ + 26;
    P(new T.CylinderGeometry(3, 3.6, 5, 24), mat(0x2a8aff), kx, 2.5, kz);
    P(new T.CylinderGeometry(3.3, 3.3, 0.5, 24), mat(0xffd21e), kx, 5.2, kz);
    P(new T.SphereGeometry(3.9, 24, 18), mat(0xd8f4ff, { opacity: 0.3 }), kx, 8.8, kz);
    [0x3ad8ff, 0x6aff3a, 0xff6ad8, 0xff8a2a, 0xffd21e, 0x8a3aff].forEach((c, k) => {
        for (let j = 0; j < 3; j++) { const a = k * 1.05 + j * 2.1, r = 1.2 + j * 0.8; P(new T.SphereGeometry(0.85, 12, 10), mat(c, { emissive: c, ei: 0.3 }), kx + Math.cos(a) * r, 6.6 + j * 1.1 + (k % 2) * 0.6, kz + Math.sin(a) * r); }
    });
    solidBox(kx, 5, kz, 7.4, 10, 7.4, { mat: 'metal' });
    sign('BALL SKINS', '#ffb85a', '#3a1a00', kx, 15.5, kz, 13, -Math.PI / 2 + 0.6, lobbyRoot);
    prompt({ x: kx, z: kz }, 'Ball Skins', () => actions.openShop && actions.openShop('skins'), 9);
    // GEM SHOP: a glowing crystal cluster on a pedestal
    const gx = LX + 82, gz = LZ + 46;
    P(new T.CylinderGeometry(4.5, 5.5, 2.4, 6), white, gx, 1.2, gz);
    [[0, 6.5, 0, 3.2], [2.3, 4.6, 1, 2], [-2, 4.4, -1.2, 2.2], [0.8, 4.2, -2.4, 1.6]].forEach(([dx, y, dz, s]) => {
        const o = P(new T.OctahedronGeometry(s, 0), mat(0xd23cff, { emissive: 0xb02aff, ei: 0.4 }), gx + dx, y, gz + dz);
        o.scale.y = 1.7;
    });
    solidBox(gx, 4, gz, 9, 8, 9, { mat: 'metal' });
    sign('GEM SHOP', '#ff8af0', '#3a0a3a', gx, 15.5, gz, 12, -Math.PI / 2 + 0.9, lobbyRoot);
    prompt({ x: gx, z: gz }, 'Gem Shop', () => actions.openShop && actions.openShop('gems'), 10);
    // DAILY: a giant gift box
    const dx = LX - 60, dz = LZ + 46;
    P(box(9, 7, 9, 0.6), mat(0xff3a5a), dx, 3.5, dz);
    P(box(9.6, 1.6, 9.6, 0.5), mat(0xff5a7a), dx, 7.6, dz);
    P(new T.BoxGeometry(1.6, 8.6, 9.7), mat(0xffd21e), dx, 4.2, dz);
    P(new T.BoxGeometry(9.7, 8.6, 1.6), mat(0xffd21e), dx, 4.2, dz);
    for (const s2 of [-1, 1]) { const bow = P(new T.TorusGeometry(1.7, 0.55, 8, 18), mat(0xffd21e), dx + s2 * 1.6, 9.6, dz); bow.rotation.set(0, Math.PI / 2, s2 * 0.6); }
    solidBox(dx, 4, dz, 9.6, 8.6, 9.6, { mat: 'metal' });
    sign('DAILY REWARD', '#ffe24a', '#3a2a00', dx, 15, dz, 13, Math.PI / 2 - 0.6, lobbyRoot);
    prompt({ x: dx, z: dz }, 'Daily Reward', () => actions.openDaily && actions.openDaily(), 10);
}

// ----- the sky deck: stairs up to a platform with spaceship pods -----
function buildDeck(g) {
    const white = mat(0xf6faff), trim = mat(0xd6e6f6), neon = mat(0xff6ad8, { neon: true });
    const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    const sx = LX + 58, z0 = LZ + 30, H = 10, depth = 1.6, steps = 10;
    for (let k = 0; k < steps; k++) {
        const y = (k + 1) * (H / steps);
        P(new T.BoxGeometry(10, y, depth), k % 2 ? white : trim, sx, y / 2, z0 + k * depth);
        solidBox(sx, y / 2, z0 + k * depth, 10, y, depth, { mat: 'floor' });
    }
    const dz = z0 + steps * depth + 10;
    P(box(30, H, 20, 0.6), white, sx + 6, H / 2, dz);
    P(new T.BoxGeometry(30.2, 0.4, 20.2), neon, sx + 6, H + 0.05, dz);
    solidBox(sx + 6, H / 2, dz, 30, H, 20, { mat: 'floor' });
    // glass rail on the far sides
    for (const [x, z, w, d] of [[sx + 21, dz, 0.3, 20], [sx + 6, dz + 10, 30, 0.3]]) {
        P(new T.BoxGeometry(w, 3, d), mat(0xd8f4ff, { opacity: 0.35 }), x, H + 1.5, z);
        solidBox(x, H + 2, z, Math.max(w, 1), 4, Math.max(d, 1), { mat: 'wall' });
    }
    // three spaceship pods (white capsules with dark blue glass)
    for (const k of [0, 1, 2]) {
        const px = sx + k * 8, pz = dz + 3;
        const cap = P(new T.CapsuleGeometry(2.4, 5, 6, 16), white, px, H + 3, pz); cap.rotation.x = Math.PI / 2;
        P(new T.SphereGeometry(2.2, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1a2a5a), px, H + 4.2, pz + 0.6);
        P(new T.BoxGeometry(5.6, 0.3, 0.3), neon, px, H + 1.2, pz + 3.6);
        solidBox(px, H + 3, pz, 5, 6, 9, { mat: 'metal' });
    }
}

// ----- the plaza: a candy walkway from the spawn to QUICK PLAY, coloured mats under the shops,
// planters, lamp posts, benches and a giant half-broken rainbow cube -----
const CANDY = [0xff7aa8, 0xffa86a, 0xffe05a, 0x7de86a, 0x5ad0ff, 0x8a8aff, 0xc47aff];
function roundRectGeo(w, l, r) {
    const s = new T.Shape(), x = -w / 2, y = -l / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + l - r);
    s.quadraticCurveTo(x + w, y + l, x + w - r, y + l); s.lineTo(x + r, y + l); s.quadraticCurveTo(x, y + l, x, y + l - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return new T.ShapeGeometry(s, 6).rotateX(-Math.PI / 2);
}
function buildPlaza(g) {
    const P = (geo, m, x, y, z, ry) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    const F = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.receiveShadow = true; g.add(o); return o; };
    const white = mat(0xffffff), neonC = mat(0x3ae0ff, { neon: true });
    // the walkway: rainbow bands across it (3 studs each), white edges with a neon line
    const z0 = LZ + 9.5, z1 = LZ + 106, len = z1 - z0, W = 14;
    const bandTex = texFrom(cv(64, (x, N, H) => {
        const h = H / CANDY.length;
        CANDY.forEach((c, i) => { x.fillStyle = hex(c); x.fillRect(0, i * h, N, h); x.fillStyle = 'rgba(255,255,255,0.4)'; x.fillRect(0, i * h, N, 4); x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(0, (i + 1) * h - 3, N, 3); });
    }, 448), true);
    const wg = new T.PlaneGeometry(W, len).rotateX(-Math.PI / 2);
    wg.attributes.uv.array.forEach((v, i, a) => { if (i & 1) a[i] = v * len / 21; });
    F(wg, new T.MeshLambertMaterial({ map: bandTex, color: 0xffffff }), LX, 0.09, (z0 + z1) / 2);
    for (const sx of [-1, 1]) {
        F(new T.BoxGeometry(1.2, 0.16, len), white, LX + sx * (W / 2 + 0.6), 0.08, (z0 + z1) / 2);
        F(new T.BoxGeometry(0.3, 0.06, len), neonC, LX + sx * (W / 2 + 0.6), 0.18, (z0 + z1) / 2);
    }
    // a coloured mat under every shop
    const pastel = (c) => mat(new T.Color(c).lerp(new T.Color(0xffffff), 0.45).getHex());
    for (const [x, z, w, l, c] of [[LX - 78, LZ - 16, 18, 40, 0xffa86a], [LX + 78, LZ - 16, 16, 44, 0x5ad0ff], [LX + 66, LZ + 26, 16, 16, 0xffe05a], [LX + 82, LZ + 46, 18, 18, 0xc47aff],
        [LX - 60, LZ + 46, 18, 18, 0xff7aa8], [LX - 84, LZ + 26, 12, 50, 0x7de86a]]) {
        F(roundRectGeo(w + 1.6, l + 1.6, 3.4), white, x, 0.08, z);
        F(roundRectGeo(w, l, 2.8), pastel(c), x, 0.1, z);
    }
    // planters along the walkway: white tubs, a bush, flowers, a little tree on every other one
    const greens = [0x46c83a, 0x5ad84a, 0x6ae85a].map((c) => mat(c)), trunk = mat(0x8a5a2a);
    const blob = new T.IcosahedronGeometry(1, 1), flower = new T.IcosahedronGeometry(0.42, 0);
    let k = 0;
    for (const z of [LZ + 20, LZ + 46, LZ + 70, LZ + 96]) for (const sx of [-1, 1]) {
        const x = LX + sx * 12.5, c = CANDY[k % CANDY.length];
        P(new T.CylinderGeometry(3, 2.6, 1.8, 20), white, x, 0.9, z);
        P(new T.TorusGeometry(3, 0.22, 6, 28).rotateX(Math.PI / 2), mat(c, { neon: true }), x, 1.82, z);
        const b = P(blob, greens[k % 3], x, 2.2, z); b.scale.set(2.5, 1.2, 2.5);
        for (let f = 0; f < 7; f++) { const a = f / 7 * Math.PI * 2 + k; P(flower, mat(CANDY[(k + f) % CANDY.length]), x + Math.cos(a) * 2.1, 2.7 + (f & 1) * 0.3, z + Math.sin(a) * 2.1); }
        if (k % 2 === 0) {
            const t = P(new T.CylinderGeometry(0.35, 0.5, 1, 8), trunk, x, 4, z); t.scale.y = 4;
            const top = P(blob, greens[(k + 1) % 3], x, 7.4, z); top.scale.set(2.8, 2.5, 2.8);
        }
        solidBox(x, 0.9, z, 6, 1.8, 6, { mat: 'wood' });
        k++;
    }
    // lamp posts with glowing candy globes
    k = 0;
    for (const z of [LZ + 33, LZ + 58, LZ + 84]) for (const sx of [-1, 1]) {
        const x = LX + sx * 10, c = CANDY[(k * 2 + 1) % CANDY.length];
        P(new T.CylinderGeometry(0.8, 1, 0.6, 12), white, x, 0.3, z);
        P(new T.CylinderGeometry(0.22, 0.3, 8, 8), white, x, 4.3, z);
        P(new T.SphereGeometry(1.05, 16, 12), mat(c, { neon: true }), x, 9, z);
        P(new T.TorusGeometry(0.9, 0.16, 6, 16).rotateX(Math.PI / 2), white, x, 8.2, z);
        solidBox(x, 4, z, 1.2, 8, 1.2, { mat: 'metal' });
        k++;
    }
    // benches facing the walkway (white seat, a coloured back)
    k = 0;
    for (const z of [LZ + 46, LZ + 70]) for (const sx of [-1, 1]) {
        const x = LX + sx * 18.5, ry = -sx * Math.PI / 2;
        const bench = new T.Group(); bench.position.set(x, 0, z); bench.rotation.y = ry; g.add(bench);
        const B2 = (geo, m, xx, y, zz) => { const o = new T.Mesh(geo, m); o.position.set(xx, y, zz); o.castShadow = true; o.receiveShadow = true; bench.add(o); };
        B2(box(6, 0.5, 2.2, 0.2), white, 0, 1.6, 0);
        B2(box(6, 1.8, 0.45, 0.2), mat(CANDY[(k * 3) % CANDY.length]), 0, 2.9, -1.1);
        for (const lx of [-2.4, 2.4]) B2(new T.BoxGeometry(0.5, 1.4, 1.8), mat(0xd6e6f6), lx, 0.7, 0);
        solidBox(x, 1, z, 2.4, 2, 6.2, { mat: 'wood' });
        k++;
    }
    // a giant rainbow cube, half broken, on a pedestal (east of the walkway)
    const cx = LX + 34, cz = LZ + 34;
    P(new T.CylinderGeometry(7, 7.6, 2, 32), white, cx, 1, cz);
    P(new T.TorusGeometry(7, 0.3, 6, 40).rotateX(Math.PI / 2), mat(0xff6ad8, { neon: true }), cx, 2.05, cz);
    const art = new T.Group(); art.position.set(cx, 2, cz); art.rotation.y = 0.5; g.add(art);
    const bg = roundedBlockGeo(3.3, 0.6), gone = new Set(['2,2,2', '1,2,2', '2,2,1', '2,1,2', '0,2,2']);
    for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
        if (gone.has(x + ',' + y + ',' + z)) continue;
        const o = new T.Mesh(bg, mat(CANDY[(x + y * 2 + z * 3) % CANDY.length], { emissive: CANDY[(x + y * 2 + z * 3) % CANDY.length], ei: 0.12 }));
        o.position.set((x - 1) * 3.45, 1.75 + y * 3.45, (z - 1) * 3.45); o.castShadow = o.receiveShadow = true; art.add(o);
    }
    // the broken bits at its foot
    for (const [x, z, s, c] of [[5.6, 4.4, 1.6, 0], [-4.8, 5.6, 1.2, 3], [6.4, -2.6, 1.1, 5]]) {
        const o = new T.Mesh(bg, mat(CANDY[c])); o.scale.setScalar(s / 3.3); o.position.set(x, s / 2, z); o.rotation.set(0.3, x, 0.2); o.castShadow = true; art.add(o);
    }
    solidBox(cx, 6, cz, 14, 12, 14, { mat: 'metal' });
}

// ----- scenery: trees on the rim, floating islands, waterfalls, clouds, balloons, a fountain -----
function buildScenery(g) {
    const greens = [0x46c83a, 0x5ad84a, 0x3ab030, 0x6ae85a].map((c) => mat(c));
    const trunk = mat(0x8a5a2a);
    const blob = new T.IcosahedronGeometry(1, 1), stem = new T.CylinderGeometry(0.7, 1, 1, 8);
    const tree = (x, z, s, k, parent) => {
        const P = (geo, m, xx, y, zz, sc) => { const o = new T.Mesh(geo, m); o.position.set(xx, y, zz); o.scale.copy(sc); o.castShadow = true; o.receiveShadow = true; (parent || g).add(o); };
        P(stem, trunk, x, 3 * s, z, new V3(1.1 * s, 6 * s, 1.1 * s));
        P(blob, greens[k % 4], x, 8 * s, z, new V3(4.4 * s, 3.8 * s, 4.4 * s));
        P(blob, greens[(k + 1) % 4], x + 2.2 * s, 6.6 * s, z + 0.8 * s, new V3(2.8 * s, 2.5 * s, 2.8 * s));
    };
    for (let k = 0; k < 30; k++) {
        const a = k / 30 * Math.PI * 2 + R() * 0.1, r = RR + 5 + R() * 4;
        const x = LX + Math.cos(a) * r, z = LZ + Math.sin(a) * r;
        if (z < LZ - 70 && Math.abs(x - LX) < 80) continue;
        tree(x, z, 0.75 + R() * 0.45, k);
    }
    // flower beds round the fountain and along the rim
    const fl = [0xff5a8a, 0xffd21e, 0xffffff, 0xa86aff, 0xff8a2a];
    for (let k = 0; k < 90; k++) {
        const a = R() * Math.PI * 2, r = RR + 2 + R() * 9;
        const o = new T.Mesh(new T.IcosahedronGeometry(0.55, 0), mat(fl[k % 5]));
        o.position.set(LX + Math.cos(a) * r, 0.6, LZ + Math.sin(a) * r); g.add(o);
    }
    // floating islands round the lobby, each with a tree (and a waterfall)
    for (const [dx, dy, dz, s] of [[-190, -18, -60, 1], [210, 6, 30, 0.8], [-150, 20, 150, 0.7], [170, -30, -170, 1.1], [30, -40, 230, 0.9]]) {
        const x = LX + dx, z = LZ + dz;
        const top = new T.Mesh(new T.CylinderGeometry(16 * s, 14 * s, 3, 20), mat(0x5ad84a)); top.position.set(x, dy, z); g.add(top);
        const under = new T.Mesh(new T.ConeGeometry(14 * s, 26 * s, 16), mat(0x9a8a7a)); under.rotation.x = Math.PI; under.position.set(x, dy - 14.5 * s, z); g.add(under);
        tree(x, z, s * 0.9, (dx | 0) & 3);
        const t2 = g.children[g.children.length - 1]; void t2;
    }
    // the cloud sea below the island
    const cloudM = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0xc8e4ff, emissiveIntensity: 0.35 });
    const puff = new T.SphereGeometry(1, 14, 10);
    const clouds = new T.InstancedMesh(puff, cloudM, 90), m4 = new T.Matrix4();
    for (let k = 0; k < 90; k++) {
        const a = R() * Math.PI * 2, d = 60 + R() * 520, s = 18 + R() * 36;
        m4.makeScale(s * 1.4, s * 0.55, s).setPosition(LX + Math.cos(a) * d, -95 - R() * 60, LZ + Math.sin(a) * d);
        clouds.setMatrixAt(k, m4);
    }
    clouds.frustumCulled = false;
    lobbyRoot.add(clouds);
    // the fountain in the plaza (west of the walkway, so the way to QUICK PLAY is clear)
    const fx = LX - 34, fz = LZ + 34;
    const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    P(new T.CylinderGeometry(10, 10.6, 1.6, 40), mat(0xffffff), fx, 0.8, fz);
    P(new T.TorusGeometry(10, 0.5, 8, 40).rotateX(Math.PI / 2), mat(0x3ae0ff, { neon: true }), fx, 1.65, fz);
    P(new T.CylinderGeometry(2.2, 3, 5, 20), mat(0xffffff), fx, 2.5, fz);
    P(new T.CylinderGeometry(4.5, 4.5, 0.6, 28), mat(0xffffff), fx, 5.2, fz);
    solidBox(fx, 0.8, fz, 20, 1.6, 20, { mat: 'floor' });
    const water = new T.Mesh(new T.CircleGeometry(9.6, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: waterTex, color: 0xffffff, transparent: true, opacity: 0.9 }));
    water.position.set(fx, 1.62, fz); lobbyRoot.add(water);
    const jetMat = new T.MeshBasicMaterial({ map: waterTex, color: 0xe8fbff, transparent: true, opacity: 0.65, depthWrite: false });
    const jet = mover(new T.Mesh(new T.CylinderGeometry(0.6, 1.4, 9, 12, 1, true), jetMat)); jet.position.set(fx, 9.6, fz);
    // waterfalls off the rim (a sheet of falling water)
    const fallTex = waterTex.clone(); fallTex.repeat.set(4, 2); fallTex.needsUpdate = true;
    const fallMat = new T.MeshBasicMaterial({ map: fallTex, color: 0xffffff, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false });
    for (const a of [0.35, 2.4, 4.1]) {
        const x = LX + Math.cos(a) * (RR + 11.5), z = LZ + Math.sin(a) * (RR + 11.5);
        const w = new T.Mesh(new T.PlaneGeometry(10, 80), fallMat); w.position.set(x, -40, z); w.rotation.y = -a + Math.PI / 2; lobbyRoot.add(w);
    }
    tickers.push((dt, t) => { if (!lobbyRoot.visible) return; fallTex.offset.y = (t * 0.6) % 1; jetMat.map.offset.y = (t * 0.8) % 1; });
    // balloons by the spawn (they bob as one bunch)
    const bal = new T.Group(); bal.position.set(LX + 30, 0, LZ + 94);
    [0xff3a5a, 0xffd21e, 0x3ad8ff, 0x7dff3a, 0xff6ad8, 0xa86aff].forEach((c, k) => {
        const b = new T.Mesh(new T.SphereGeometry(1.6, 16, 12), mat(c, { emissive: c, ei: 0.15 }));
        const a = k / 6 * Math.PI * 2; b.position.set(Math.cos(a) * 1.6, 12 + Math.sin(k * 1.7) * 1.2, Math.sin(a) * 1.6); b.scale.y = 1.2; bal.add(b);
        const s2 = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 10, 4), mat(0xffffff)); s2.position.set(Math.cos(a) * 0.8, 6.5, Math.sin(a) * 0.8); bal.add(s2);
    });
    const bal2 = bal.clone(); bal2.position.set(LX - 30, 0, LZ + 94);
    mover(bal); mover(bal2);
    tickers.push((dt, t) => { if (!lobbyRoot.visible) return; bal.position.y = Math.sin(t * 1.3) * 0.6; bal2.position.y = Math.sin(t * 1.1 + 2) * 0.6; bal.rotation.y = Math.sin(t * 0.5) * 0.2; });
    // the rainbow behind the terminal and floating glow cubes all round
    const { rainbowMat, floatMat } = sharedMats();
    const rb = new T.Mesh(new T.RingGeometry(300, 340, 96, 1, 0, Math.PI), rainbowMat);
    const pp = rb.geometry.attributes.position, uv = rb.geometry.attributes.uv;
    for (let i = 0; i < pp.count; i++) uv.setY(i, (Math.hypot(pp.getX(i), pp.getY(i)) - 300) / 40);
    rb.position.set(LX - 40, -60, LZ - 420); rb.rotation.y = 0.2; rb.renderOrder = -5;
    lobbyRoot.add(rb);
    const N = 30, fc = new T.InstancedMesh(roundedBlockGeo(1, 0.18), floatMat, N), col = new T.Color();
    for (let i = 0; i < N; i++) {
        const a = R() * Math.PI * 2, d = 90 + R() * 140, s = 3 + R() * 5;
        m4.makeScale(s, s, s).setPosition(LX + Math.cos(a) * d, 25 + R() * 55, LZ + Math.sin(a) * d);
        fc.setMatrixAt(i, m4);
        fc.setColorAt(i, col.set([0xff6ad8, 0xffd21e, 0x5ae0ff, 0x7dff6b, 0xffffff][i % 5]));
    }
    fc.frustumCulled = false;
    lobbyRoot.add(fc);
}

// ----- painted chevrons on the floor from the spawn to QUICK PLAY (the reference's), shimmering -----
function buildChevrons() {
    const shape = new T.Shape();
    shape.moveTo(-3, -1.2); shape.lineTo(0, 1.8); shape.lineTo(3, -1.2); shape.lineTo(3, 0.6); shape.lineTo(0, 3.6); shape.lineTo(-3, 0.6); shape.closePath();
    const parts = [];
    for (let k = 0; k < 9; k++) {
        const gch = new T.ShapeGeometry(shape); gch.rotateX(-Math.PI / 2); gch.rotateY(Math.PI);
        gch.translate(LX, 0.15, LZ + 70 - k * 6.2);
        const n = gch.attributes.position.count;
        gch.setAttribute('aK', new T.Float32BufferAttribute(new Float32Array(n).fill(k), 1));
        parts.push(gch);
    }
    const geo = mergeGeoms(parts);
    const m = new T.ShaderMaterial({
        transparent: true, depthWrite: false, forceSinglePass: true,
        uniforms: { uTime: U.uTime },
        vertexShader: 'attribute float aK; varying float vK; void main(){ vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uTime; varying float vK; void main(){ float w = 0.5 + 0.5 * sin(uTime * 5.0 + vK * 0.9); vec3 c = mix(vec3(1.0, 0.75, 0.92), vec3(1.0), w); gl_FragColor = vec4(c, 0.55 + 0.4 * w); }',
    });
    lobbyRoot.add(new T.Mesh(geo, m));
}
function mergeGeoms(list) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), k = new Float32Array(n), idx = [];
    let o = 0;
    for (const g of list) {
        pos.set(g.attributes.position.array, o * 3); k.set(g.attributes.aK.array, o);
        const ix = g.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + o);
        o += g.attributes.position.count;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aK', new T.BufferAttribute(k, 1)); g.setIndex(idx);
    return g;
}

let built = false;
export async function buildLobby(pause) {
    if (built) return;
    built = true;
    const g = new T.Group();
    buildIsland(g); await pause();
    buildTerminal(g); await pause();
    buildPads(g);
    buildStations(g); await pause();
    buildDeck(g);
    buildPlaza(g); await pause();
    buildScenery(g); await pause();
    buildChevrons();
    mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
    lobbyRoot.add(g);
    lobbyRoot.updateMatrixWorld(true);
    lobbyRoot.traverse((o) => { if (!o.userData.moving && o !== lobbyRoot) o.matrixAutoUpdate = false; });
    for (const o of movers) o.matrixAutoUpdate = true;
    setPadInfo({ unlocked: 0, clears: {} }, {});
    tickers.push((dt, t) => {
        if (!lobbyRoot.visible) return;
        // next to a pad, its neighbours' labels fade so they don't pile up behind it
        const pp = U.uPlayer.value;
        let near = null, nd = 30 * 30;
        for (const p of lobbyPads) { p.d2 = (p.x - pp.x) ** 2 + (p.z - pp.z) ** 2; if (p.d2 < nd) { nd = p.d2; near = p; } }
        for (const p of lobbyPads) {
            p.holo.rotation.set(t * 0.6 + p.phase, t * 0.9 + p.phase, 0);
            p.holo.position.y = 6 + Math.sin(t * 2 + p.phase) * 0.5;
            const o = !near || p === near || p.d2 > 44 * 44 ? 1 : 0.15, m = p.lbl.material;
            m.opacity += (o - m.opacity) * Math.min(1, dt * 8);
        }
        quickPad.ringMat.color.setHSL((t * 0.15) % 1, 0.9, 0.6);
        quickPad.play.position.y = 9 + Math.sin(t * 2.4) * 0.6;
        const k = 1 + Math.sin(t * 3) * 0.04;
        quickPad.play.scale.set(16 * k, 16 * k * quickPad.play.material.map.image.height / 512, 1);
    });
}
export function setLobbyVisible(on) { lobbyRoot.visible = on; }
