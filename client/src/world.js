// The arena around the cube: a sunny grass field with rolling hills, windmills and round trees; a
// pale tiled plaza round the cube with a glowing water ring (the reference's); and to the south the
// curved white-and-blue BLASTER BASE: the SELL machine in the middle (a beam of light shows where it
// is), the upgrade computer, the blaster rack, the ball jars, the gem machine and the ball skins,
// with the leaderboards and the CUBE SELECT portal outside. Glowing cubes float round the sky.
//
// Everything that doesn't move is merged per material (a few dozen draw calls for the whole place).
// The few things that move do it in their shaders (water, floating cubes, the guide chevrons) or
// as single objects (windmill blades, the sell beam, the guide arrow).
import {
    T, V3, scene, mat, texFrom, sharedTex, textCanvas, solids, prompts, tickers, solidBox, setMood, mergeChildren, fitFont,
} from './engine.js';
import { CUBES, fmt, rngFrom } from '../../shared/config.js';
import { BASE, SPOTS, PLAZA_R } from '../../shared/arena.js';
import { actions } from './state.js';
import { U, roundedBlockGeo } from './cube.js';
import { blasterModel } from './blaster.js';

// The arena (the cube's field and the base) hangs under one root, shown only while you're in a cube
// room; the lobby (lobby.js) has its own
export const arenaRoot = new T.Group();
arenaRoot.name = 'arena';
scene.add(arenaRoot);
export const statics = [];
export function add(o, parent) { (parent || arenaRoot).add(o); statics.push(o); return o; }
const R = rngFrom(4242);
export function cv(n, draw, h) { const c = document.createElement('canvas'); c.width = n; c.height = h || n; draw(c.getContext('2d'), n, h || n); return c; }

// ----- textures (drawn in code) -----
export const grassTex = texFrom(cv(256, (x, N) => {
    x.fillStyle = '#5cc83a'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 2600; i++) {
        const g = 150 + Math.random() * 70;
        x.fillStyle = `rgba(${60 + Math.random() * 40},${g},${30 + Math.random() * 30},${0.25 + Math.random() * 0.35})`;
        const px = Math.random() * N, py = Math.random() * N;
        x.fillRect(px, py, 1.5, 3 + Math.random() * 4);
    }
}), true);
grassTex.repeat.set(140, 140);
// 4 x 4 plaza tiles, most pale grey-white, a few in soft candy tints
const TINTS = ['#e8eff7', '#e8eff7', '#eef3fa', '#ffe2ef', '#fff2c6', '#dafbe6', '#daeeff', '#ebe0ff'];
const tileTex = texFrom(cv(512, (x, N) => {
    const t = N / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        x.fillStyle = TINTS[(Math.random() * TINTS.length) | 0]; x.fillRect(i * t, j * t, t, t);
        x.strokeStyle = '#c5d2e2'; x.lineWidth = 4; x.strokeRect(i * t + 2, j * t + 2, t - 4, t - 4);
        x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2; x.strokeRect(i * t + 7, j * t + 7, t - 14, t - 14);
    }
    for (let i = 0; i < 2400; i++) { x.fillStyle = `rgba(150,170,200,${Math.random() * 0.08})`; x.fillRect(Math.random() * N, Math.random() * N, 2, 2); }
}), true);
// the candy ring round the foot of the cube: bright segments all the way round
const candyTex = texFrom(cv(512, (x, N, H) => {
    const C = ['#ff7aa8', '#ffa86a', '#ffe05a', '#7de86a', '#5ad0ff', '#8a8aff', '#c47aff'], w = N / C.length;
    C.forEach((c, i) => { x.fillStyle = c; x.fillRect(i * w, 0, w, H); x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(i * w, 0, 3, H); });
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(0, 0, N, H * 0.22);
}, 32), true);
candyTex.repeat.set(8, 1);
const floorTex = texFrom(cv(256, (x, N) => {
    x.fillStyle = '#f2f7fd'; x.fillRect(0, 0, N, N);
    x.strokeStyle = '#cfdcec'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * N / 4, 0); x.lineTo(i * N / 4, N); x.stroke(); x.beginPath(); x.moveTo(0, i * N / 4); x.lineTo(N, i * N / 4); x.stroke(); }
    x.fillStyle = 'rgba(90,200,255,0.18)'; x.fillRect(N / 4 + 6, N / 4 + 6, N / 2 - 12, N / 2 - 12);
}), true);
export const waterTex = texFrom(cv(256, (x, N) => {
    const g = x.createLinearGradient(0, 0, 0, N); g.addColorStop(0, '#5ae8ff'); g.addColorStop(1, '#1ab4ff');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 6; x.lineCap = 'round';
    for (let i = 0; i < 14; i++) { const y = Math.random() * N, x0 = Math.random() * N; x.beginPath(); x.moveTo(x0, y); x.quadraticCurveTo(x0 + 20, y - 8, x0 + 40, y); x.stroke(); }
}), true);
waterTex.repeat.set(60, 1);

// a flat ring on the ground (inner .. outer), its texture running round it
export function ringGeo(r0, r1, seg) {
    const g = new T.RingGeometry(r0, r1, seg || 128, 1);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
        const a = Math.atan2(p.getY(i), p.getX(i)), r = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (a / (Math.PI * 2) + 0.5), (r - r0) / (r1 - r0));
    }
    g.rotateX(-Math.PI / 2);
    return g;
}

// =====================================================================================
// Ground: grass, the plaza, the water ring, the path to the base
// =====================================================================================
export let floatMat;
let waterMat, neonMats = [], cubeRing, candyRing, rainbowMat, sellBeam, sellBeamMat, padMat, portalCube, chevMat, arrow, windBlades = [];
function buildGround() {
    const grass = new T.Mesh(new T.CircleGeometry(950, 64).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ map: grassTex, color: 0xffffff }));
    grass.position.y = -0.02; grass.receiveShadow = true;
    add(grass);
    const plazaG = new T.CircleGeometry(PLAZA_R, 96).rotateX(-Math.PI / 2);
    plazaG.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (PLAZA_R * 2 / 40); });
    const plaza = new T.Mesh(plazaG, new T.MeshLambertMaterial({ map: tileTex, color: 0xffffff }));
    plaza.position.y = 0.03; plaza.receiveShadow = true;
    add(plaza);
    const rim = new T.Mesh(ringGeo(PLAZA_R, PLAZA_R + 1.6), mat(0xffffff));
    rim.position.y = 0.06; rim.receiveShadow = true; add(rim);
    waterMat = new T.MeshBasicMaterial({ map: waterTex, color: 0xffffff, transparent: true, opacity: 0.92 });
    const water = new T.Mesh(ringGeo(PLAZA_R + 1.6, PLAZA_R + 6.5), waterMat);
    water.position.y = 0.05; add(water);
    const rim2 = new T.Mesh(ringGeo(PLAZA_R + 6.5, PLAZA_R + 7.6), mat(0xffffff));
    rim2.position.y = 0.06; rim2.receiveShadow = true; add(rim2);
    // the path from the plaza to the base, over the water
    const pathG = new T.PlaneGeometry(26, 26).rotateX(-Math.PI / 2);
    pathG.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 0.65; });
    const path = new T.Mesh(pathG, new T.MeshLambertMaterial({ map: tileTex, color: 0xffffff }));
    path.position.set(0, 0.08, PLAZA_R + 4); path.receiveShadow = true; add(path);
    for (const sx of [-1, 1]) { const e = new T.Mesh(new T.BoxGeometry(1.2, 0.5, 26), mat(0xffffff)); e.position.set(sx * 13.4, 0.25, PLAZA_R + 4); e.castShadow = e.receiveShadow = true; add(e); }
    // the glowing ring round the foot of the cube (sized per cube in setTheme)
    const nm = mat(0x3ae0ff, { neon: true });
    neonMats.push(nm);
    cubeRing = new T.Mesh(ringGeo(1, 1.035, 128), nm);
    cubeRing.position.y = 0.09;
    arenaRoot.add(cubeRing);
    candyRing = new T.Mesh(ringGeo(1.045, 1.15, 128), new T.MeshLambertMaterial({ map: candyTex, color: 0xffffff }));
    candyRing.position.y = 0.08; candyRing.receiveShadow = true;
    arenaRoot.add(candyRing);
    // the spawn pad
    const spawnPad = new T.Mesh(new T.CircleGeometry(4.5, 40).rotateX(-Math.PI / 2), mat(0xffffff));
    spawnPad.position.set(0, 0.1, 72); spawnPad.receiveShadow = true; add(spawnPad);
    const sp2 = new T.Mesh(ringGeo(4.5, 5.2, 48), nm); sp2.position.set(0, 0.11, 72); add(sp2);
}

// =====================================================================================
// The BLASTER BASE
// =====================================================================================
const signs = [];
export function sign(text, color, stroke, x, y, z, w, face, parent) {
    const map = sharedTex('sign|' + text + color, () => textCanvas([{ t: text, c: color, s: stroke, px: 96, w: 700 }], 1024));
    const h = w * map.image.height / map.image.width;
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide, forceSinglePass: true }));
    m.position.set(x, y, z);
    m.rotation.y = face || 0;
    m.renderOrder = 3;
    add(m, parent);
    signs.push(m);
    return m;
}
// a face toward the middle of the base from (x, z)
const faceIn = (x, z) => Math.atan2(BASE.x - x, BASE.z - 12 - z);
export function prompt(spot, label, act, r) { prompts.push({ pos: new V3(spot.x, 2, spot.z), r: r || 9, label: () => label, act }); }

function buildBase() {
    const g = new T.Group();
    const white = mat(0xf6f9fe), blue = mat(0x2a7ae8), glass = mat(0x9ad6ff), trim = mat(0xd8e4f2), dark = mat(0x2a3448);
    const neon = mat(0x3ae0ff, { neon: true });
    neonMats.push(neon);
    const P = (geo, m, x, y, z, ry) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    // floor
    const fl = new T.CylinderGeometry(BASE.r + 1.5, BASE.r + 1.5, 0.3, 72);
    fl.attributes.uv.array.forEach((v, i, a) => { a[i] = v * 7; });
    P(fl, new T.MeshLambertMaterial({ map: floorTex, color: 0xffffff }), BASE.x, 0.15, BASE.z);
    solidBox(BASE.x, 0.15, BASE.z, BASE.r * 2, 0.3, BASE.r * 2, { mat: 'floor' });
    // the curved wall: white base, a band of blue windows, white top, blue rim, neon strip
    const A0 = 10, A1 = 170, step = 8;
    for (let a = A0; a < A1; a += step) {
        const m = (a + step / 2) * Math.PI / 180, w = 2 * Math.PI * BASE.r * step / 360 + 0.25;
        const x = BASE.x + Math.cos(m) * BASE.r, z = BASE.z + Math.sin(m) * BASE.r, ry = -m + Math.PI / 2;
        P(new T.BoxGeometry(w, 6, 2), white, x, 3, z, ry);
        P(new T.BoxGeometry(w, 7, 1.2), glass, x, 9.5, z, ry);
        P(new T.BoxGeometry(w, 3, 2), white, x, 14.5, z, ry);
        P(new T.BoxGeometry(w + 0.1, 1, 2.6), blue, x, 16.5, z, ry);
        P(new T.BoxGeometry(w, 0.35, 0.3), neon, x - Math.cos(m) * 1.05, 5.7, z - Math.sin(m) * 1.05, ry);
        // window mullions
        P(new T.BoxGeometry(0.4, 7, 1.5), trim, x + Math.cos(m + Math.PI / 2) * w / 2, 9.5, z + Math.sin(m + Math.PI / 2) * w / 2, ry);
    }
    // wall colliders: small boxes along the arc
    for (let a = A0; a <= A1; a += 3) {
        const m = a * Math.PI / 180;
        solidBox(BASE.x + Math.cos(m) * BASE.r, 8.5, BASE.z + Math.sin(m) * BASE.r, 2.4, 17, 2.4, { mat: 'wall' });
    }
    // pillars at the open ends and the front arch with the sign
    for (const a of [A0, A1]) {
        const m = a * Math.PI / 180, x = BASE.x + Math.cos(m) * BASE.r, z = BASE.z + Math.sin(m) * BASE.r;
        P(new T.CylinderGeometry(1.8, 2.1, 20, 20), white, x, 10, z);
        P(new T.CylinderGeometry(2.2, 2.2, 0.8, 20), blue, x, 20.2, z);
        for (const y of [4, 12]) P(new T.TorusGeometry(1.9, 0.18, 6, 24).rotateX(Math.PI / 2), neon, x, y, z);
        solidBox(x, 10, z, 4, 20, 4, { mat: 'wall' });
    }
    const gap = (360 - (A1 - A0)) * Math.PI / 180;
    const arch = new T.TorusGeometry(BASE.r, 0.9, 10, 60, gap);
    arch.rotateX(Math.PI / 2);
    const archM = P(arch, blue, BASE.x, 20.5, BASE.z);
    archM.rotation.y = -(A1 * Math.PI / 180);
    const archN = P(new T.TorusGeometry(BASE.r - 1, 0.25, 6, 60, gap).rotateX(Math.PI / 2), neon, BASE.x, 19.4, BASE.z);
    archN.rotation.y = -(A1 * Math.PI / 180);
    // a roof ring along the top of the wall
    const roof = P(new T.TorusGeometry(BASE.r - 4, 4.5, 4, 48, (A1 - A0) * Math.PI / 180).rotateX(Math.PI / 2), trim, BASE.x, 17.4, BASE.z);
    roof.scale.y = 0.12; roof.rotation.y = -A0 * Math.PI / 180;
    // ----- the SELL machine -----
    const sx = SPOTS.sell.x, sz = SPOTS.sell.z + 6;
    P(box(9, 8, 5, 0.6), white, sx, 4.3, sz);
    P(box(9.4, 1, 5.4, 0.4), blue, sx, 0.8, sz);
    P(box(6.4, 3.2, 0.3, 0.1), dark, sx, 5.2, sz - 2.55);
    P(new T.CylinderGeometry(3.8, 2.2, 3, 24), mat(0xffd21e), sx, 9.6, sz);
    P(new T.TorusGeometry(3.8, 0.35, 8, 28).rotateX(Math.PI / 2), white, sx, 11.1, sz);
    P(box(3.2, 0.5, 0.4, 0.1), neon, sx, 2.6, sz - 2.6);
    solidBox(sx, 4.5, sz, 9.4, 9, 5.4, { mat: 'metal' });
    // the screen: a coin and an arrow
    const scr = new T.Mesh(new T.PlaneGeometry(6, 3), new T.MeshBasicMaterial({ map: sharedTex('sellScreen', () => cv(256, (x) => {
        x.fillStyle = '#0a2a4a'; x.fillRect(0, 0, 256, 128);
        x.fillStyle = '#ffd21e'; x.beginPath(); x.arc(70, 64, 34, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#c88a08'; x.font = '900 40px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 70, 66);
        x.fillStyle = '#7dff6b'; x.beginPath(); x.moveTo(130, 44); x.lineTo(190, 44); x.lineTo(190, 24); x.lineTo(236, 64); x.lineTo(190, 104); x.lineTo(190, 84); x.lineTo(130, 84); x.fill();
    }, 128)), toneMapped: false }));
    scr.position.set(sx, 5.2, sz - 2.75); scr.rotation.y = Math.PI; g.add(scr);
    // the pad in front of it, and the beam of light that shows where it is
    padMat = new T.MeshBasicMaterial({ color: 0x46ff6a, transparent: true, opacity: 0.55, depthWrite: false });
    const pad = new T.Mesh(new T.CircleGeometry(6, 48).rotateX(-Math.PI / 2), padMat);
    pad.position.set(SPOTS.sell.x, 0.34, SPOTS.sell.z); g.add(pad);
    const padRing = new T.Mesh(ringGeo(6, 6.6, 64), mat(0x46ff6a, { neon: true }));
    padRing.position.set(SPOTS.sell.x, 0.35, SPOTS.sell.z); g.add(padRing);
    sellBeamMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, forceSinglePass: true,
        uniforms: { uTime: U.uTime, uColor: { value: new T.Color(0x7dff8a) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
            void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.15 * sin(vUv.x * 40.0 + uTime * 3.0)) * (0.75 + 0.25 * sin(uTime * 2.0)); gl_FragColor = vec4(uColor * a, a); }`,
    });
    sellBeam = new T.Mesh(new T.CylinderGeometry(5.6, 6, 70, 32, 1, true), sellBeamMat);
    sellBeam.position.set(SPOTS.sell.x, 35, SPOTS.sell.z);
    sellBeam.renderOrder = 4;
    arenaRoot.add(sellBeam);
    sign('SELL', '#7dff6b', '#0a3a10', sx, 15.5, sz - 1, 12, Math.PI);
    // ----- the upgrade computer -----
    const c = SPOTS.computer, cr = faceIn(c.x, c.z);
    const comp = new T.Group(); comp.position.set(c.x, 0, c.z); comp.rotation.y = cr; g.add(comp);
    const CP = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; comp.add(o); return o; };
    CP(box(8, 3.4, 4, 0.3), white, 0, 1.9, -1);
    CP(box(8.4, 0.4, 4.4, 0.15), blue, 0, 3.7, -1);
    CP(box(1, 3.2, 0.8, 0.2), trim, 0, 5.4, -2.2);
    CP(box(9, 6, 0.8, 0.4), white, 0, 9.4, -2.5);
    const screen = new T.Mesh(new T.PlaneGeometry(8, 5.2), new T.MeshBasicMaterial({ map: sharedTex('compScreen', () => cv(256, (x) => {
        const gr = x.createLinearGradient(0, 0, 0, 170); gr.addColorStop(0, '#2ae8ff'); gr.addColorStop(1, '#1a8ae8');
        x.fillStyle = gr; x.fillRect(0, 0, 256, 170);
        x.strokeStyle = '#ffffff'; x.lineWidth = 6;
        const nodes = [[128, 40], [70, 90], [186, 90], [50, 140], [110, 140], [170, 140], [210, 140]];
        for (const [a, b] of [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]]) { x.beginPath(); x.moveTo(nodes[a][0], nodes[a][1]); x.lineTo(nodes[b][0], nodes[b][1]); x.stroke(); }
        for (const [i, [nx, ny]] of nodes.entries()) { x.fillStyle = ['#ffd21e', '#7dff6b', '#ff7ad8', '#ffffff', '#ffffff', '#ffffff', '#ffffff'][i]; x.beginPath(); x.arc(nx, ny, 14, 0, Math.PI * 2); x.fill(); }
    }, 170)), toneMapped: false }));
    screen.position.set(0, 9.4, -2.05); comp.add(screen);
    CP(box(5, 0.3, 1.6, 0.1), dark, 0, 3.95, 0);
    solidBox(c.x, 3, c.z, 8, 6, 8, { mat: 'metal' });
    sign('UPGRADES', '#ffd84a', '#3a2a00', c.x, 15.2, c.z, 13, cr);
    prompt(c, 'Upgrades', () => actions.openUpgrades && actions.openUpgrades());
    // ----- the blaster rack -----
    const gs = SPOTS.guns, gr = faceIn(gs.x, gs.z);
    const rack = new T.Group(); rack.position.set(gs.x, 0, gs.z); rack.rotation.y = gr; g.add(rack);
    const RP = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; rack.add(o); return o; };
    RP(box(12, 3.4, 3, 0.3), white, 0, 1.9, 0);
    RP(box(12.4, 0.4, 3.4, 0.15), blue, 0, 3.7, 0);
    RP(box(13, 10, 0.8, 0.3), trim, 0, 8.5, -2.6);
    ['blaster', 'twin', 'splash', 'mega'].forEach((id, i) => {
        const b = blasterModel(id);
        b.position.set(-4.5 + i * 3, 7.5 + (i % 2) * 2.6, -1.9);
        b.rotation.set(0, Math.PI / 2, 0.15);
        b.scale.setScalar(0.85);
        rack.add(b);
    });
    solidBox(gs.x, 3, gs.z, 12, 6, 6, { mat: 'metal' });
    sign('BLASTERS', '#5ad8ff', '#0a2a4a', gs.x, 15.5, gs.z, 13, gr);
    prompt(gs, 'Blasters', () => actions.openShop && actions.openShop('guns'));
    // ----- the ball jars -----
    const as = SPOTS.ammo;
    RPa(g, as, white, blue);
    solidBox(as.x, 3, as.z, 12, 6, 5, { mat: 'metal' });
    sign('BALLS', '#7dff6b', '#0a3a10', as.x, 15.5, as.z, 10, Math.PI);
    prompt(as, 'Balls', () => actions.openShop && actions.openShop('ammo'));
    // ----- the gem machine (a big gumball machine full of gems) -----
    const ms = SPOTS.gems;
    gumball(g, ms);
    solidBox(ms.x, 5, ms.z, 7, 10, 7, { mat: 'metal' });
    sign('GEM SHOP', '#ff8af0', '#3a0a3a', ms.x, 15.5, ms.z, 12, faceIn(ms.x, ms.z));
    prompt(ms, 'Gem Shop', () => actions.openShop && actions.openShop('gems'));
    // ----- ball skins: a pedestal with balls floating over it -----
    const ks = SPOTS.skins, kr = faceIn(ks.x, ks.z);
    P(new T.CylinderGeometry(3.2, 3.8, 3.2, 28), white, ks.x, 1.6, ks.z);
    P(new T.CylinderGeometry(3.4, 3.4, 0.4, 28), blue, ks.x, 3.3, ks.z);
    solidBox(ks.x, 1.7, ks.z, 6.6, 3.4, 6.6, { mat: 'metal' });
    sign('BALL SKINS', '#ffb85a', '#3a1a00', ks.x, 13.5, ks.z, 13, kr);
    prompt(ks, 'Ball Skins', () => actions.openShop && actions.openShop('skins'));
    mergeChildren(g);
    add(g);
    // the floating balls over the skins pedestal (they turn)
    const balls = new T.Group(); balls.position.set(ks.x, 7, ks.z);
    [0x3ad8ff, 0xff6ad8, 0xff6a1a, 0xffd21e, 0x8a3aff].forEach((c2, i) => {
        const b = new T.Mesh(new T.SphereGeometry(0.9, 18, 12), mat(c2, { emissive: c2, ei: 0.35 }));
        const a = i / 5 * Math.PI * 2; b.position.set(Math.cos(a) * 2.2, Math.sin(i * 1.7) * 0.6, Math.sin(a) * 2.2);
        balls.add(b);
    });
    arenaRoot.add(balls);
    tickers.push((dt, t) => { balls.rotation.y = t * 0.8; balls.position.y = 7 + Math.sin(t * 1.6) * 0.4; });
    // front arch sign
    sign('⚡ BLASTER BASE ⚡', '#ffffff', '#1a4aa8', BASE.x, 23.5, BASE.z - BASE.r + 0.5, 30, Math.PI);
}
export function box(w, h, l, r) { const g = roundedBlockGeo(1, r ?? 0.2); g.scale(w, h, l); return g; }
function RPa(g, as, white, blue) {
    const grp = new T.Group(); grp.position.set(as.x, 0, as.z); g.add(grp);
    const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; grp.add(o); return o; };
    P(box(12, 3.4, 3, 0.3), white, 0, 1.9, 0);
    P(box(12.4, 0.4, 3.4, 0.15), blue, 0, 3.7, 0);
    const glass = mat(0xd8f4ff, { opacity: 0.35 });
    [0x3ad8ff, 0x6aff3a, 0xff8a2a].forEach((c, i) => {
        const x = -4 + i * 4;
        P(new T.CylinderGeometry(1.5, 1.5, 3.4, 20), glass, x, 5.6, 0);
        P(new T.CylinderGeometry(1.6, 1.6, 0.4, 20), mat(c), x, 7.5, 0);
        const bm = mat(c, { emissive: c, ei: 0.25 });
        for (let k = 0; k < 9; k++) P(new T.SphereGeometry(0.55, 10, 8), bm, x + Math.cos(k * 2.4) * (0.4 + (k % 3) * 0.3), 4.3 + Math.floor(k / 3) * 0.95, Math.sin(k * 2.4) * (0.4 + (k % 3) * 0.3));
    });
}
function gumball(g, ms) {
    const grp = new T.Group(); grp.position.set(ms.x, 0, ms.z); g.add(grp);
    const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; grp.add(o); return o; };
    P(new T.CylinderGeometry(2.6, 3.2, 4.5, 24), mat(0xe82a4a), 0, 2.25, 0);
    P(box(2, 1.4, 0.6, 0.2), mat(0xffffff), 0, 2.6, -2.8);
    P(new T.CylinderGeometry(3, 3, 0.5, 24), mat(0xffd21e), 0, 4.7, 0);
    P(new T.SphereGeometry(3.4, 24, 18), mat(0xd8f4ff, { opacity: 0.3 }), 0, 8, 0);
    P(new T.CylinderGeometry(1, 1.2, 0.8, 16), mat(0xe82a4a), 0, 11.6, 0);
    const cols = [0xd23cff, 0x3ad8ff, 0x7dff6b, 0xffd21e, 0xff5a8a];
    for (let k = 0; k < 22; k++) {
        const a = k * 2.399, rr = 2.4 * Math.sqrt((k + 0.5) / 22), y = 5.6 + (k % 5) * 0.8;
        const gm = new T.Mesh(new T.OctahedronGeometry(0.62, 0), mat(cols[k % 5], { emissive: cols[k % 5], ei: 0.3 }));
        gm.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); gm.rotation.set(k, k * 2, 0);
        grp.add(gm);
    }
}

// =====================================================================================
// Leaderboards and the CUBE SELECT portal
// =====================================================================================
const BOARDS = [
    { key: 'wins', title: '🏆 MOST CUBES DESTROYED', color: '#ffd84a', x: -46, z: 66 },
    { key: 'blocks', title: '💥 MOST BLOCKS BROKEN', color: '#5ad8ff', x: -54, z: 86 },
    { key: 'coins', title: '💰 TOP COINS', color: '#7dff6b', x: -56, z: 108 },
];
const boardTex = [];
function buildBoards() {
    for (const b of BOARDS) makeBoard(b, 0, 80, null);
}
// a leaderboard at (b.x, b.z) turned toward (fx, fz)
export function makeBoard(b, fx, fz, parent) {
    {
        const ry = Math.atan2(fx - b.x, fz - b.z);
        const grp = new T.Group(); grp.position.set(b.x, 0, b.z); grp.rotation.y = ry;
        const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; grp.add(o); return o; };
        P(box(13, 17, 1.2, 0.4), mat(0x2a6ae8), 0, 10.5, 0);
        for (const sx of [-5, 5]) P(new T.CylinderGeometry(0.6, 0.7, 4, 12), mat(0xf6f9fe), sx, 1.5, 0);
        const c = cv(512, () => {}, 640);
        const tex = texFrom(c);
        boardTex.push({ c, tex, b });
        const face = new T.Mesh(new T.PlaneGeometry(12, 15), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        face.position.set(0, 10.5, 0.62); grp.add(face);
        solidBox(b.x, 9, b.z, 6, 18, 6, { mat: 'metal' });
        add(grp, parent);
        drawBoard(boardTex[boardTex.length - 1], lastBoards[b.key] || []);
    }
}
let lastBoards = {};
function drawBoard(bt, rows) {
    const x = bt.c.getContext('2d'), W = 512, H = 640;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#163a7a'); g.addColorStop(1, '#0a1a3a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, 0, W, 86);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    fitFont(x, bt.b.title, W - 30, 40, 700, 'Fredoka, sans-serif', 0);
    x.fillStyle = bt.b.color; x.fillText(bt.b.title, W / 2, 46);
    for (let i = 0; i < 10; i++) {
        const y = 118 + i * 51, r = rows[i];
        x.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
        x.fillRect(16, y - 23, W - 32, 46);
        x.textAlign = 'left';
        x.font = '700 28px Fredoka, sans-serif';
        x.fillStyle = i === 0 ? '#ffd84a' : i === 1 ? '#d8e4f0' : i === 2 ? '#ffb07a' : '#ffffff';
        x.fillText('#' + (i + 1), 26, y);
        if (r) {
            fitFont(x, r.n, 270, 28, 700, 'Fredoka, sans-serif', 0);
            x.fillStyle = '#ffffff'; x.fillText(r.n, 92, y);
            x.textAlign = 'right'; x.font = '700 28px Fredoka, sans-serif'; x.fillStyle = bt.b.color;
            x.fillText(fmt(r.v), W - 28, y);
        }
    }
    bt.tex.needsUpdate = true;
}
let boardKey = '';
export function renderBoards(m) {
    const key = JSON.stringify(m);
    if (key === boardKey) return;
    boardKey = key;
    lastBoards = m;
    for (const bt of boardTex) drawBoard(bt, m[bt.b.key] || []);
}
function buildPortal() {
    const p = SPOTS.portal, ry = Math.atan2(0 - p.x, 72 - p.z);
    const grp = new T.Group(); grp.position.set(p.x, 0, p.z); grp.rotation.y = ry;
    const P = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; grp.add(o); return o; };
    P(new T.CylinderGeometry(6, 6.6, 0.8, 40), mat(0xf6f9fe), 0, 0.4, 0);
    const nm = mat(0x3ae0ff, { neon: true }); neonMats.push(nm);
    P(new T.TorusGeometry(6.2, 0.22, 6, 48).rotateX(Math.PI / 2), nm, 0, 0.85, 0);
    P(new T.TorusGeometry(7.5, 0.7, 10, 48, Math.PI), mat(0x2a6ae8), 0, 0.5, 0);
    P(new T.TorusGeometry(7.5, 0.25, 6, 48, Math.PI), nm, 0, 0.5, 0.75);
    solidBox(p.x, 0.4, p.z, 12, 0.8, 12, { mat: 'floor' });
    add(grp);
    // a little spinning cube in the middle (the next cube's colours)
    portalCube = new T.Mesh(roundedBlockGeo(3.4, 0.6), mat(0x5ab4f0, { emissive: 0x2a6ae8, ei: 0.35 }));
    portalCube.position.set(p.x, 5.5, p.z);
    portalCube.castShadow = true;
    arenaRoot.add(portalCube);
    tickers.push((dt, t) => { portalCube.rotation.set(t * 0.7, t * 1.1, 0); portalCube.position.y = 5.5 + Math.sin(t * 2) * 0.5; });
    sign('🏠 LOBBY', '#ffffff', '#1a4aa8', p.x, 13.5, p.z, 12, ry);
    prompt(p, 'Back to the Lobby', () => actions.goLevel && actions.goLevel(-1), 10);
}

// =====================================================================================
// Scenery: hills, windmills, trees, rocks, a rainbow, floating glow cubes
// =====================================================================================
function buildScenery() {
    const g = new T.Group();
    const greens = [0x46c83a, 0x5ad84a, 0x3ab030, 0x6ae85a].map((c) => mat(c));
    const trunk = mat(0x8a5a2a), rock = mat(0xb8c0cc), hill = mat(0x58c040);
    const P = (geo, m, x, y, z, s) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); if (s) o.scale.copy(s); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    // hills on the horizon
    for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2 + R() * 0.2, d = 420 + R() * 260, r = 90 + R() * 120;
        P(new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hill, Math.cos(a) * d, -2, Math.sin(a) * d, new V3(r, r * (0.3 + R() * 0.25), r));
    }
    // round trees in loose clumps (not where the base, the boards or the portal stand)
    const blob = new T.IcosahedronGeometry(1, 1), stem = new T.CylinderGeometry(0.7, 1, 1, 8);
    let placed = 0;
    for (let k = 0; placed < 64 && k < 400; k++) {
        const a = R() * Math.PI * 2, d = 92 + R() * 190, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (Math.abs(x) < 70 && z > 40 && z < 170) continue;
        if (x < -30 && x > -75 && z > 50 && z < 125) continue;
        const s = 0.8 + R() * 0.7;
        P(stem, trunk, x, 3 * s, z, new V3(1.1 * s, 6 * s, 1.1 * s));
        const gm = greens[k % 4];
        P(blob, gm, x, 8 * s, z, new V3(4.6 * s, 4 * s, 4.6 * s));
        P(blob, greens[(k + 1) % 4], x + 2.4 * s, 6.6 * s, z + 0.8 * s, new V3(3 * s, 2.7 * s, 3 * s));
        P(blob, greens[(k + 2) % 4], x - 2 * s, 6.9 * s, z - 1.2 * s, new V3(3.2 * s, 2.8 * s, 3.2 * s));
        if (d < 130) solidBox(x, 4 * s, z, 2 * s, 8 * s, 2 * s, { mat: 'wood' });
        placed++;
    }
    // bushes and rocks round the plaza
    for (let i = 0; i < 40; i++) {
        const a = R() * Math.PI * 2, d = PLAZA_R + 12 + R() * 22, x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (Math.abs(x) < 50 && z > 50) continue;
        if (i % 3) P(blob, greens[i % 4], x, 1.2, z, new V3(2.6 + R() * 1.5, 2 + R(), 2.6 + R() * 1.5));
        else P(new T.DodecahedronGeometry(1, 0), rock, x, 1, z, new V3(2.4 + R() * 2, 1.6 + R(), 2 + R() * 2));
    }
    mergeChildren(g);
    add(g);
    // windmills on the hills (their blades turn)
    for (const [x, z, s] of [[-260, -300, 1.2], [300, -260, 1], [380, 120, 1.1], [-360, 60, 0.9], [120, -420, 1.3]]) {
        const w = new T.Group(); w.position.set(x, 0, z); w.scale.setScalar(s);
        const tower = new T.Mesh(new T.CylinderGeometry(1.2, 2.4, 46, 12), mat(0xf6f9fe)); tower.position.y = 23; tower.castShadow = true; w.add(tower);
        const hub = new T.Group(); hub.position.set(0, 46, 2.2); w.add(hub);
        for (let k = 0; k < 3; k++) { const b = new T.Mesh(new T.BoxGeometry(1.4, 22, 0.3), mat(0xffffff)); b.position.y = 11; const arm = new T.Group(); arm.rotation.z = k * Math.PI * 2 / 3; arm.add(b); hub.add(arm); }
        w.rotation.y = Math.atan2(-x, -z);
        arenaRoot.add(w);
        windBlades.push(hub);
    }
    // the rainbow behind the cube (the reference has one)
    rainbowMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, fog: false,
        uniforms: { uA: { value: 0.55 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uA; varying vec2 vUv;
            vec3 hueRgb(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
            void main(){ float v = vUv.y; float band = smoothstep(0.0, 0.18, v) * (1.0 - smoothstep(0.82, 1.0, v)); vec3 c = mix(vec3(1.0), hueRgb(v * 0.82), 0.75); gl_FragColor = vec4(c, band * uA); }`,
    });
    const rb = new T.Mesh(new T.RingGeometry(250, 290, 96, 1, 0, Math.PI), rainbowMat);
    // uv.y across the band: rebuild from the radius
    const pp = rb.geometry.attributes.position, uv = rb.geometry.attributes.uv;
    for (let i = 0; i < pp.count; i++) uv.setY(i, (Math.hypot(pp.getX(i), pp.getY(i)) - 250) / 40);
    rb.position.set(60, -30, -420);
    rb.rotation.y = -0.25;
    rb.renderOrder = -5;
    add(rb);
    // floating glow cubes, bobbing and turning (in the shader)
    floatMat = new T.MeshLambertMaterial({ color: 0xffffff });
    floatMat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uTime: U.uTime, uNeon: { value: new T.Color(0x3ae0ff) } });
        floatMat.userData.sh = sh;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace('void main() {', `void main() {
                #ifdef USE_INSTANCING
                vec3 fp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
                #else
                vec3 fp = vec3(0.0);
                #endif
                float fs = fract(sin(dot(fp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
                float fa = uTime * (0.4 + fs * 0.6) + fs * 6.28;
                mat3 fR = mat3(cos(fa), 0.0, -sin(fa), 0.0, 1.0, 0.0, sin(fa), 0.0, cos(fa)) * mat3(1.0, 0.0, 0.0, 0.0, cos(fa * 0.6), sin(fa * 0.6), 0.0, -sin(fa * 0.6), cos(fa * 0.6));`)
            .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = fR * objectNormal;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = fR * transformed; transformed.y += sin(uTime * (0.8 + fs) + fs * 9.0) * 2.5;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uNeon;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uNeon * 0.35;');
    };
    floatMat.customProgramCacheKey = () => 'dtc-float';
    const N = 36, fl = new T.InstancedMesh(roundedBlockGeo(1, 0.18), floatMat, N), m4 = new T.Matrix4(), col = new T.Color();
    for (let i = 0; i < N; i++) {
        const a = R() * Math.PI * 2, d = 70 + R() * 120, s = 3 + R() * 5;
        m4.makeScale(s, s, s).setPosition(Math.cos(a) * d, 30 + R() * 60, Math.sin(a) * d);
        fl.setMatrixAt(i, m4);
        fl.setColorAt(i, col.set([0xffffff, 0x9ae8ff, 0xffd84a, 0xff8ad8][i % 4]));
    }
    fl.frustumCulled = false;
    add(fl);
}

// =====================================================================================
// The guide: a bouncing arrow over where to go next, chevrons on the ground leading there
// =====================================================================================
const CHEV = 18;
function buildGuide() {
    const a = new T.Group();
    const am = mat(0xffffff, { emissive: 0xffffff, ei: 0.35 });
    const head = new T.Mesh(new T.ConeGeometry(1.6, 2.4, 4), am); head.rotation.x = Math.PI; head.position.y = 1.2; a.add(head);
    const tail = new T.Mesh(new T.BoxGeometry(1.1, 2.2, 1.1), am); tail.position.y = 3.4; a.add(tail);
    a.visible = false;
    scene.add(a);
    arrow = a;
    chevMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, forceSinglePass: true,
        uniforms: { uTime: U.uTime, uFrom: { value: new V3() }, uTo: { value: new V3() }, uOn: { value: 0 } },
        vertexShader: /* glsl */`
            uniform float uTime; uniform vec3 uFrom; uniform vec3 uTo; uniform float uOn;
            varying float vA;
            void main() {
                float id = float(gl_InstanceID);
                vec3 d = uTo - uFrom; d.y = 0.0;
                float L = length(d);
                float k = fract(id / ${CHEV}.0 + uTime * 0.35);
                vec3 dir = L > 0.01 ? d / L : vec3(0.0, 0.0, 1.0);
                vec3 side = vec3(dir.z, 0.0, -dir.x);
                vec3 P = uFrom + dir * (4.0 + k * max(0.0, L - 8.0));
                P.y = 0.35;
                vA = uOn * smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.85, 1.0, k)) * step(10.0, L);
                vec3 w = P + side * position.x + dir * position.z;
                gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
            }`,
        fragmentShader: 'varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(vec3(1.0), vA * 0.85); }',
    });
    // a flat chevron (two slanted bars) in the xz plane, pointing +z
    const shape = new T.Shape();
    shape.moveTo(-1.6, -0.6); shape.lineTo(0, 1.0); shape.lineTo(1.6, -0.6); shape.lineTo(1.6, 0.4); shape.lineTo(0, 2.0); shape.lineTo(-1.6, 0.4); shape.closePath();
    const cg = new T.ShapeGeometry(shape); cg.rotateX(Math.PI / 2);
    const ig = new T.InstancedBufferGeometry().copy(cg);
    ig.instanceCount = CHEV;
    const ch = new T.Mesh(ig, chevMat);
    ch.frustumCulled = false; ch.renderOrder = 2;
    scene.add(ch);
}
// target: a point to lead the player to (or null)
export function setGuide(target, from, showArrow) {
    if (!target) { chevMat.uniforms.uOn.value = 0; arrow.visible = false; return; }
    chevMat.uniforms.uOn.value = 1;
    chevMat.uniforms.uFrom.value.copy(from);
    chevMat.uniforms.uTo.value.copy(target);
    arrow.visible = showArrow !== false;
    arrow.position.set(target.x, (target.y || 0) + 6 + Math.sin(U.uTime.value * 4) * 0.8, target.z);
    arrow.rotation.y = U.uTime.value * 2;
}

// =====================================================================================
// Per cube: the colours of the neon, the cube ring, the floating cubes and the sky
// =====================================================================================
let pendingTheme = null;
export function setTheme(level, now) {
    const def = CUBES[level];
    if (!portalCube) { pendingTheme = level; setMood(def.mood, true); return; }
    for (const m of neonMats) m.color.set(def.neon).multiplyScalar(1.25);
    const half = def.n * 2.5;
    cubeRing.scale.set(half + 5, 1, half + 5);
    candyRing.scale.set(half + 5, 1, half + 5);
    if (floatMat.userData.sh) floatMat.userData.sh.uniforms.uNeon.value.set(def.neon);
    portalCube.material.color.set(CUBES[Math.min(level + 1, CUBES.length - 1)].colors[0]);
    setMood(def.mood, now);
}
export function sellBeamOn(on, color) {
    sellBeam.visible = on;
    if (color) sellBeamMat.uniforms.uColor.value.set(color);
}

let built = false;
export async function buildWorld(pause) {
    if (built) return;
    built = true;
    buildGround(); await pause();
    buildBase(); await pause();
    buildBoards(); buildPortal(); await pause();
    buildScenery(); await pause();
    buildGuide();
    if (pendingTheme !== null) setTheme(pendingTheme, true);
    for (const o of statics) { o.updateMatrixWorld(true); o.traverse((c) => { c.matrixAutoUpdate = false; }); }
    tickers.push((dt, t) => {
        waterTex.offset.x = (t * 0.01) % 1;
        for (const h of windBlades) h.rotation.z = t * 0.6;
        padMat.opacity = 0.4 + 0.2 * Math.sin(t * 4);
    });
}
// Every shader of the world in view for the loading warm-up
const SHADOW_SIDE = { [T.FrontSide]: T.BackSide, [T.BackSide]: T.FrontSide, [T.DoubleSide]: T.DoubleSide };
const warmKeep = [];
export async function warmUp(renderer, camera, pause, extraScenes) {
    // Hidden things are shown just for the (synchronous) gathering of their materials and hidden
    // again before anything is awaited: the game may show or hide them meanwhile (joining the lobby
    // while this runs used to come back to an invisible lobby).
    const vis = [], waits = [];
    scene.traverse((o) => { if (o !== scene && !o.visible) { vis.push(o); o.visible = true; } });
    try { waits.push(renderer.compileAsync(scene, camera)); } catch (e) { renderer.compile(scene, camera); }
    for (const o of vis) o.visible = false;
    for (const sc of extraScenes || []) { try { waits.push(renderer.compileAsync(sc, camera)); } catch (e) { renderer.compile(sc, camera); } }
    for (const w of waits) { try { await w; } catch (e) { /* compiles on first use */ } }
    if (renderer.shadowMap.enabled) {
        const kinds = new Map();
        scene.traverse((o) => {
            if (!o.isMesh || !o.castShadow) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                const side = m.shadowSide ?? SHADOW_SIDE[m.side];
                const key = [o.isSkinnedMesh, o.isInstancedMesh, !!(o.isInstancedMesh && o.instanceColor), !!m.map, side, m.alphaTest > 0].join();
                if (kinds.has(key)) continue;
                const d = new T.MeshDepthMaterial({ side, map: m.map, alphaMap: m.alphaMap, alphaTest: m.alphaTest });
                let p;
                if (o.isSkinnedMesh) { p = new T.SkinnedMesh(o.geometry, d); p.bind(o.skeleton, o.bindMatrix); }
                else if (o.isInstancedMesh) { p = new T.InstancedMesh(o.geometry, d, 1); if (o.instanceColor) p.setColorAt(0, new T.Color(1, 1, 1)); }
                else p = new T.Mesh(o.geometry, d);
                kinds.set(key, p);
            }
        });
        const stand = new T.Group();
        for (const p of kinds.values()) stand.add(p);
        const rt = new T.WebGLRenderTarget(1, 1);
        const prev = renderer.getRenderTarget(), fog = scene.fog;
        let ready = null;
        renderer.setRenderTarget(rt);
        scene.fog = null;
        try { ready = renderer.compileAsync(stand, camera, scene); } catch (e) { /* compiles on first use */ }
        scene.fog = fog;
        renderer.setRenderTarget(prev);
        if (ready) { try { await ready; } catch (e) { /* compiles on first use */ } }
        rt.dispose();
        warmKeep.push(stand);
        try { renderer.compile(new T.Group(), camera, scene); } catch (e) { /* next frame */ }
    }
    const texs = new Set();
    const collect = (o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
            for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
            if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) texs.add(v); }
        }
    };
    scene.traverse(collect);
    for (const sc of extraScenes || []) sc.traverse(collect);
    let n = 0;
    for (const tx of texs) {
        renderer.initTexture(tx);
        if (++n % 12 === 0) await pause();
    }
    const gl = renderer.getContext();
    if (gl.fenceSync) {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const t0 = performance.now();
        while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 15));
        gl.deleteSync(sync);
    }
}
void signs; void solids;
// the lobby reuses a few of the arena's materials (same shaders, nothing new to compile)
export function sharedMats() { return { rainbowMat, floatMat }; }
// Arena or lobby: which world is drawn
export function setPlace(place) {
    arenaRoot.visible = place === 'arena';
}
