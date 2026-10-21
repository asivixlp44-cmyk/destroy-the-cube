// The blasters, built in code like the reference's toy blaster: a white body with coloured trims,
// a ribbed tank round the barrel, a swirl badge on the side, a glowing strip and a fat muzzle.
// Each blaster is a few merged meshes (one per material). The barrel points along +z; the grip
// hangs below the origin. MUZZLE is where the balls come out.
import { T, V3, mat, mergeChildren } from './engine.js';
import { GUNS, gunById } from '../../shared/config.js';
import { roundedBlockGeo } from './cube.js';

export const MUZZLE = new V3(0, 0.12, 2.95);
const cyl = (r, l, seg) => { const g = new T.CylinderGeometry(r, r, l, seg || 14); g.rotateX(Math.PI / 2); return g; };
const box = (w, h, l, r) => { const g = roundedBlockGeo(1, r ?? 0.12); g.scale(w, h, l); return g; };
const geoCache = new Map();
const G = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };

function part(root, geo, material, x, y, z, rx, ry, rz) {
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    root.add(m);
    return m;
}

// lit: matte materials for the world; flat: the first-person copy (no shadow code: drawn on top)
export function blasterModel(id, flat) {
    const g = gunById[id] || GUNS[0], L = g.look;
    const root = new T.Group();
    const M = (c, o) => (flat ? flatMat(c, o) : mat(c, o));
    const body = M(L.body), accent = M(L.accent), tank = M(L.tank), dark = M(0x2a3448), neon = M(L.accent, { neon: true, boost: 1.15 });
    const big = id === 'mega', heavy = big || id === 'plasma' || id === 'galaxy';
    // body, top rail, stock, grip
    part(root, G('body' + big, () => box(big ? 1.3 : 1, big ? 1.25 : 1.05, 2.7, 0.3)), body, 0, 0, 0.15);
    part(root, G('rail', () => box(0.55, 0.28, 2.1, 0.1)), accent, 0, big ? 0.75 : 0.66, 0.05);
    part(root, G('stock', () => box(0.86, 0.86, 0.9, 0.22)), body, 0, -0.06, -1.42);
    part(root, G('grip', () => box(0.5, 1.15, 0.62, 0.16)), accent, 0, -0.9, -0.55, 0.28);
    part(root, G('trig', () => box(0.14, 0.4, 0.2, 0.05)), dark, 0, -0.62, -0.02);
    // the side vents (three dark slots on the stock, like the reference)
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) part(root, G('vent', () => box(0.05, 0.5, 0.1, 0.02)), dark, side * 0.44, -0.04, -1.62 + k * 0.2);
    // the swirl badge on each side
    for (const side of [-1, 1]) {
        part(root, G('badge', () => { const c = new T.CylinderGeometry(0.34, 0.34, 0.08, 18); c.rotateZ(Math.PI / 2); return c; }), accent, side * (big ? 0.66 : 0.52), 0.05, -0.1);
        part(root, G('badgeIn', () => { const c = new T.TorusGeometry(0.2, 0.06, 6, 16); c.rotateY(Math.PI / 2); return c; }), dark, side * (big ? 0.71 : 0.57), 0.05, -0.1);
    }
    // the glowing strip along each side
    for (const side of [-1, 1]) part(root, G('strip', () => box(0.04, 0.12, 1.9, 0.02)), neon, side * (big ? 0.66 : 0.52), 0.32, 0.4);
    // barrels
    const n = g.barrels || 1, R = big ? 0.5 : heavy ? 0.36 : n > 2 ? 0.16 : 0.27;
    const offs = n === 1 ? [[0, 0.12]] : n === 2 ? [[-0.24, 0.12], [0.24, 0.12]] : n === 3 ? [[-0.3, 0.05], [0.3, 0.05], [0, 0.32]]
        : Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * 0.28, 0.12 + Math.sin(i / n * Math.PI * 2) * 0.28]);
    for (const [x, y] of offs) {
        part(root, G('barrel' + R, () => cyl(R, 1.6)), body, x, y, 2.05);
        part(root, G('muzzle' + R, () => cyl(R * 1.32, 0.26)), accent, x, y, 2.86);
        part(root, G('muzzleIn' + R, () => cyl(R * 0.8, 0.27)), neon, x, y, 2.87);
    }
    // the ribbed tank round the barrel
    part(root, G('tank' + big, () => cyl(big ? 0.75 : 0.55, 0.85, 18)), tank, 0, 0.12, 1.35);
    for (const dz of [-0.36, 0, 0.36]) part(root, G('rib' + big, () => cyl(big ? 0.8 : 0.6, 0.1, 18)), M(0xffffff), 0, 0.12, 1.35 + dz);
    // a little scope on the bigger ones
    if (heavy) part(root, G('scope', () => cyl(0.18, 0.8)), dark, 0, 1.05, -0.2);
    mergeChildren(root);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = !flat; o.receiveShadow = !flat; } });
    root.userData.muzzle = MUZZLE.clone().setY(big ? 0.12 : 0.12);
    root.userData.id = id;
    return root;
}
// First-person materials: matte, never in shadow (the viewmodel is drawn over the frame)
const flatCache = new Map();
function flatMat(color, o) {
    o = o || {};
    const key = color + '|' + (o.neon ? 1 : 0);
    let m = flatCache.get(key);
    if (!m) {
        m = o.neon ? new T.MeshBasicMaterial({ color }) : new T.MeshLambertMaterial({ color });
        if (o.neon) m.color.multiplyScalar(1.25 * (o.boost || 1));
        flatCache.set(key, m);
    }
    return m;
}
