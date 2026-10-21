import { T, V3, $, renderer, scene, camera, sun } from './engine.js';

// ----- quality presets -----
// No post-processing (bloom, colour grade) and no reflections in any preset: the scene is drawn
// straight to the screen. The presets change the resolution, the shadows and the ambient glitter.
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 1, shadows: false, shadowMap: 512, glitter: false },
    medium: { label: 'Medium', ratio: 1.25, shadows: true, shadowMap: 1024, glitter: true },
    high: { label: 'High', ratio: 2, shadows: true, shadowMap: 2048, glitter: true },
};
const weakPC = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
let quality = isTouch || weakPC ? 'low' : 'medium';
try { quality = localStorage.getItem('dtc_quality') || quality; } catch (e) { /* default */ }
if (!QUALITIES[quality]) quality = 'medium';

// No tone mapping, like Bloxity's top games: colours go to the screen as lit
renderer.toneMapping = T.NoToneMapping;
// A game that starts on Low (phones, weak PCs) builds every shader with no shadow code at all:
// about half the GPU time per pixel on a phone. Only the player's own choice in Settings switches
// it back on (one rebuild of the shaders); the automatic step-down never does (see below).
renderer.shadowMap.enabled = quality !== 'low';
function setShadowCode(on) {
    if (renderer.shadowMap.enabled === on) return;
    renderer.shadowMap.enabled = on;
    scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) m.needsUpdate = true; });
}
renderer.toneMappingExposure = 1.0;

// The automatic step-down never switches the shadow code off: that recompiles every lit shader at
// once (a long freeze, right when the game is already struggling). It just stops drawing the shadow
// map and fades the shadows out instead.
function setShadows(on) {
    sun.shadow.intensity = on ? 1 : 0;
    renderer.shadowMap.autoUpdate = on;
    // the map is drawn at least once (and again after a resize) so the shaders always have one
    renderer.shadowMap.needsUpdate = true;
}
function applyQuality() {
    const q = QUALITIES[quality];
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio));
    resizeFx();
    glitter.visible = q.glitter;
    // the page's soft vignette is one more full-screen layer to composite: Low goes without
    const vig = document.querySelector('#vignette');
    if (vig) vig.hidden = !q.glitter;
    document.body.classList.toggle('lowfx', quality === 'low');
    if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    setShadows(q.shadows);
}
export function getQuality() { return quality; }
// auto: a step down made by the frame-rate watcher (main.js). It is never saved, so a slow first
// minute can't leave the game stuck on Low; anything else is the player's choice and is saved.
let autoAllowed = true;
export const autoQualityAllowed = () => autoAllowed;
export function setQuality(q, auto) {
    if (!QUALITIES[q]) return;
    if (!auto && q !== quality) autoAllowed = false;
    quality = q;
    if (!auto) { try { localStorage.setItem('dtc_quality', q); } catch (e) { /* ignore */ } }
    if (!auto) setShadowCode(QUALITIES[q].shadows);
    applyQuality();
}
function resizeFx() {
    lines.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5));
    lines.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
    pointScale.value = innerHeight * renderer.getPixelRatio() * 0.5;
}
addEventListener('resize', resizeFx);

// The jumpscare head is drawn over the finished frame (see heads.js)
let overlay = null;
export function setOverlay(sceneFn, activeFn) { overlay = { scene: sceneFn, active: activeFn }; }
export function render() {
    renderer.render(scene, camera);
    if (overlay && overlay.active()) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(overlay.scene, camera);
        renderer.autoClear = true;
    }
}

// ----- speed lines (2D overlay) -----
const lines = $('#speedLines');
const lctx = lines.getContext('2d');
const streaks = Array.from({ length: 60 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
let lineAmt = 0;
export function setSpeedLines(target, dt) {
    const was = lineAmt;
    lineAmt += (target - lineAmt) * Math.min(1, dt * 6);
    if (lineAmt < 0.02 && was < 0.02) return;
    const w = lines.width, h = lines.height;
    lctx.clearRect(0, 0, w, h);
    if (lineAmt < 0.02) return;
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
    lctx.lineCap = 'round';
    for (const s of streaks) {
        s.r += dt * (1.6 + s.l * 4);
        if (s.r > 1) { s.r = 0.35 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
        const r0 = R * s.r, r1 = R * Math.min(1.1, s.r + s.l);
        lctx.strokeStyle = `rgba(255,255,255,${(0.6 * lineAmt * s.r).toFixed(3)})`;
        lctx.lineWidth = s.w;
        lctx.beginPath();
        lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        lctx.stroke();
    }
}

// =====================================================================================
// Particles: two fixed pools of points (one glowing / additive, one soft / normal), each drawn in
// a single draw call with one tiny shader. No sprite or material per particle, nothing allocated
// while playing: a big burst costs the same as a small one.
// =====================================================================================
const pointScale = { value: 400 };
const PT_VERT = `attribute float aSize; attribute float aAlpha; attribute float aStar; uniform float uScale;
    varying vec3 vColor; varying float vAlpha; varying float vStar;
    void main() {
        vColor = color; vAlpha = aAlpha; vStar = aStar;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(160.0, aSize * uScale / max(0.5, -mv.z));
    }`;
const PT_FRAG = `varying vec3 vColor; varying float vAlpha; varying float vStar;
    void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        float soft = max(0.0, 1.0 - r); soft *= soft;
        float star = max(0.0, 1.0 - abs(q.x) * 9.0) * max(0.0, 1.0 - abs(q.y) * 2.1) + max(0.0, 1.0 - abs(q.y) * 9.0) * max(0.0, 1.0 - abs(q.x) * 2.1);
        float a = mix(soft, max(soft * 0.8, star), vStar) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
    }`;
class Pool {
    constructor(max, additive) {
        this.max = max; this.n = 0;
        this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
        this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.star = new Float32Array(max);
        this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.max0 = new Float32Array(max);
        this.size0 = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max);
        this.drag = new Float32Array(max); this.a0 = new Float32Array(max);
        const g = new T.BufferGeometry();
        this.aPos = new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage);
        this.aCol = new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage);
        this.aSize = new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage);
        this.aAlpha = new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage);
        this.aStar = new T.BufferAttribute(this.star, 1).setUsage(T.DynamicDrawUsage);
        g.setAttribute('position', this.aPos); g.setAttribute('color', this.aCol);
        g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha); g.setAttribute('aStar', this.aStar);
        g.setDrawRange(0, 0);
        this.mat = new T.ShaderMaterial({
            vertexShader: PT_VERT, fragmentShader: PT_FRAG, vertexColors: true, transparent: true, depthWrite: false,
            blending: additive ? T.AdditiveBlending : T.NormalBlending, uniforms: { uScale: pointScale },
        });
        this.points = new T.Points(g, this.mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = 6;
        this.geo = g;
        scene.add(this.points);
    }
    add(x, y, z, vx, vy, vz, color, size, life, o) {
        if (this.n >= this.max) return;
        const i = this.n++, i3 = i * 3;
        this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
        this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
        tmpC.set(color);
        const k = o.hdr || 1;
        this.col[i3] = tmpC.r * k; this.col[i3 + 1] = tmpC.g * k; this.col[i3 + 2] = tmpC.b * k;
        this.size[i] = this.size0[i] = size;
        this.life[i] = this.max0[i] = life;
        this.grow[i] = o.grow || 0; this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
        this.a0[i] = this.alpha[i] = o.opacity ?? 1;
        this.star[i] = o.star ? 1 : 0;
    }
    // swap-remove: the last live particle moves into the dead one's slot
    kill(i) {
        const j = --this.n;
        if (i === j) return;
        const i3 = i * 3, j3 = j * 3;
        for (const a of [this.pos, this.vel, this.col]) { a[i3] = a[j3]; a[i3 + 1] = a[j3 + 1]; a[i3 + 2] = a[j3 + 2]; }
        for (const a of [this.size, this.alpha, this.star, this.life, this.max0, this.size0, this.grow, this.grav, this.drag, this.a0]) a[i] = a[j];
    }
    update(dt) {
        for (let i = this.n - 1; i >= 0; i--) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) { this.kill(i); continue; }
            const i3 = i * 3;
            this.vel[i3 + 1] -= this.grav[i] * dt;
            if (this.drag[i]) { const d = Math.exp(-this.drag[i] * dt); this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d; }
            this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
            const k = this.life[i] / this.max0[i];
            this.alpha[i] = this.a0[i] * Math.min(1, k * 2);
            if (this.grow[i]) this.size[i] = Math.max(0.05, this.size0[i] * (1 + this.grow[i] * (1 - k)));
        }
        this.geo.setDrawRange(0, this.n);
        if (this.n || this.was) {
            // only the live particles go up to the GPU (not the whole pool)
            const n = Math.max(1, this.n);
            for (const a of [this.aPos, this.aCol, this.aSize, this.aAlpha, this.aStar]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
        }
        this.was = this.n > 0;
    }
}
const tmpC = new T.Color();
const glow = new Pool(1600, true), soft = new Pool(700, false);
// opts: { add (glowing), star, hdr, grow, grav, drag, opacity }
function spawn(pos, vel, color, size, life, opts) {
    opts = opts || {};
    (opts.add ? glow : soft).add(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, color, size, life, opts);
}
const R = Math.random;
export function dust(pos, n, strength, color) {
    for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, sp = (2 + R() * 4) * strength;
        soft.add(pos.x + Math.cos(a) * 0.6, pos.y + 0.3, pos.z + Math.sin(a) * 0.6, Math.cos(a) * sp, 1.5 + R() * 2, Math.sin(a) * sp,
            color || 0xfff0f4, 0.9 + R() * 0.5, 0.35 + R() * 0.2, { grow: 1.6, drag: 3.5, opacity: 0.55 });
    }
}
export function sparkleColumn(pos, color) {
    for (let i = 0; i < 22; i++) {
        const a = R() * Math.PI * 2, r = 1.8 + R() * 1.2;
        glow.add(pos.x + Math.cos(a) * r, pos.y + R() * 2, pos.z + Math.sin(a) * r, 0, 7 + R() * 8, 0,
            i % 3 ? color : 0xffffff, 0.8 + R() * 0.6, 0.7 + R() * 0.4, { hdr: 1.4, drag: 0.6, star: true });
    }
}
// Strawberry splats: juicy red-pink droplets (landing on berries, getting zapped)
export function splash(pos, color, n, power) {
    for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, sp = (3 + R() * 5) * (power || 1);
        soft.add(pos.x + Math.cos(a) * 0.5, pos.y + 0.25, pos.z + Math.sin(a) * 0.5, Math.cos(a) * sp, 5 + R() * 7 * (power || 1), Math.sin(a) * sp,
            color, 0.6 + R() * 0.5, 0.5 + R() * 0.3, { grav: 38, drag: 0.6, opacity: 0.95 });
    }
}
export function popSpark(pos, color) {
    for (let i = 0; i < 8; i++) {
        const a = R() * Math.PI * 2;
        glow.add(pos.x, pos.y + 0.4, pos.z, Math.cos(a) * 5, 3 + R() * 3, Math.sin(a) * 5, i % 2 ? color : 0xffffff, 0.55, 0.32, { hdr: 1.4, drag: 3, star: i % 3 === 0 });
    }
}
// Strawberry pickup: a burst of pink and gold stars
export function coinBurst(pos) {
    for (let i = 0; i < 18; i++) {
        const a = R() * Math.PI * 2, u = R();
        glow.add(pos.x, pos.y, pos.z, Math.cos(a) * 7 * u, 4 + R() * 6, Math.sin(a) * 7 * u, i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xffd028 : 0xff4a7a, 0.75, 0.6, { hdr: 1.5, grav: 14, drag: 1.2, star: i % 2 === 0 });
    }
}
// Nuke: a blinding flash and a mushroom of sparks
export function nukeFx(pos) {
    for (let i = 0; i < 90; i++) {
        const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), sp = 14 + R() * 22;
        glow.add(pos.x, pos.y + 3, pos.z, s * Math.cos(th) * sp, Math.abs(u) * sp + 8, s * Math.sin(th) * sp, R() < 0.5 ? 0xffe03a : R() < 0.5 ? 0xff6a14 : 0xff4a7a,
            2.2 + R() * 1.5, 1 + R() * 0.6, { hdr: 1.6, grav: 6, drag: 1.2, grow: 1.5 });
    }
}
// Troll Gun: a bolt of sparks along the beam, and a pop where it hits
export function zapFx(from, to) {
    const d = new V3().subVectors(to, from), n = Math.min(40, Math.ceil(d.length() / 1.5));
    for (let i = 0; i <= n; i++) {
        const k = i / n;
        glow.add(from.x + d.x * k, from.y + d.y * k, from.z + d.z * k, (R() - 0.5) * 2, (R() - 0.5) * 2, (R() - 0.5) * 2, i % 2 ? 0x2ae8d8 : 0xffffff, 0.7, 0.28 + k * 0.1, { hdr: 1.5, drag: 2 });
    }
    popSpark(to, 0x2ae8d8);
}
// Morph poof: a puff of white smoke and glints when you change shape
export function poofFx(pos) {
    for (let i = 0; i < 26; i++) {
        const a = R() * Math.PI * 2, sp = 3 + R() * 5;
        soft.add(pos.x + Math.cos(a), pos.y + 1 + R() * 4, pos.z + Math.sin(a), Math.cos(a) * sp, 1 + R() * 3, Math.sin(a) * sp, 0xffffff, 1.6 + R() * 1.4, 0.6 + R() * 0.3, { grow: 1.4, drag: 3, opacity: 0.8 });
    }
    sparkleColumn(pos, 0xffe07a);
}
// Sword slash: an arc of glowing sparks in front of the player
export function slashFx(pos, yaw) {
    for (let i = 0; i <= 16; i++) {
        const a = yaw - 1.1 + (i / 16) * 2.2, r = 3.2;
        glow.add(pos.x + Math.sin(a) * r, pos.y + 2.6 + Math.sin(i / 16 * Math.PI) * 0.8, pos.z + Math.cos(a) * r, Math.sin(a) * 2, 0.5, Math.cos(a) * 2, i % 2 ? 0xc87aff : 0xffffff, 0.8, 0.25, { hdr: 1.6, drag: 3 });
    }
}
// A slap: a comic burst of white and coloured stars, a ring of dust (bigger for big gloves)
export function slapBurst(pos, color, power) {
    const k = power || 1, n = Math.round(16 + 10 * k);
    for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2, u = R() * 2 - 1, sp = (8 + R() * 10) * Math.sqrt(k);
        glow.add(pos.x, pos.y + 2.6, pos.z, Math.cos(a) * sp, u * sp * 0.6 + 4, Math.sin(a) * sp, i % 3 ? color : 0xffffff, 0.8 + R() * 0.6 * k, 0.35 + R() * 0.25, { hdr: 1.5, drag: 3.2, star: i % 2 === 0 });
    }
    for (let i = 0; i < 8; i++) {
        const a = R() * Math.PI * 2;
        soft.add(pos.x, pos.y + 2.4, pos.z, Math.cos(a) * 6, 1 + R() * 2, Math.sin(a) * 6, 0xffffff, 1.4 + R(), 0.4, { grow: 2, drag: 4, opacity: 0.6 });
    }
}
// Burning (Fire Punch): flames licking up round the player
export function fireFx(pos, dt) {
    if (R() > dt * 40) return;
    const a = R() * Math.PI * 2, r = 0.6 + R() * 1.2;
    glow.add(pos.x + Math.cos(a) * r, pos.y + 0.5 + R() * 3, pos.z + Math.sin(a) * r, (R() - 0.5) * 2, 5 + R() * 6, (R() - 0.5) * 2, R() < 0.5 ? 0xffd028 : 0xff5a14, 1.1 + R() * 0.8, 0.45 + R() * 0.3, { hdr: 1.4, grow: -0.4, drag: 1.2 });
}
// A tornado spinning someone up (Tornado Slap): a funnel of grey-white puffs
export function tornadoFx(pos, t, dt) {
    if (R() > dt * 60) return;
    const h = R() * 9, a = t * 9 + h * 1.4, r = 0.8 + h * 0.45;
    soft.add(pos.x + Math.cos(a) * r, pos.y - 2 + h, pos.z + Math.sin(a) * r, -Math.sin(a) * 8, 2, Math.cos(a) * 8, R() < 0.5 ? 0xe8ecff : 0xb8c0d8, 1.4 + R() * 1.2, 0.4, { grow: 1, drag: 2, opacity: 0.75 });
}
// Falling into the ocean: a big white splash
export function bigSplash(pos) {
    for (let i = 0; i < 60; i++) {
        const a = R() * Math.PI * 2, sp = 4 + R() * 12;
        soft.add(pos.x + Math.cos(a), pos.y, pos.z + Math.sin(a), Math.cos(a) * sp, 14 + R() * 18, Math.sin(a) * sp, i % 3 ? 0xe8f8ff : 0x7ad0ff, 1 + R() * 1.2, 0.8 + R() * 0.4, { grav: 40, drag: 0.4, opacity: 0.95 });
    }
}
// Admin sparkles / rainbow aura round a player
export function auraFx(pos, rainbow, dt) {
    if (R() > dt * 26) return;
    const a = R() * Math.PI * 2, r = 1.6 + R() * 1.2;
    const c = rainbow ? tmpC.setHSL(R(), 0.95, 0.62).getHex() : (R() < 0.5 ? 0xffffff : 0xfff0a8);
    glow.add(pos.x + Math.cos(a) * r, pos.y + R() * 5, pos.z + Math.sin(a) * r, 0, 1.5 + R() * 2, 0, c, 0.55 + R() * 0.4, 0.7 + R() * 0.4, { hdr: 1.4, star: R() < 0.6 });
}
// Fire puff (unused by the gear here, kept for the carpet's sparkle tail)
export function flame(at, spread, size, vel) {
    const v = vel ? vel.clone().multiplyScalar(0.7 + R() * 0.6) : new V3();
    v.x += (R() - 0.5) * 3; v.y += 3 + R() * 5; v.z += (R() - 0.5) * 3;
    glow.add(at.x + (R() - 0.5) * spread, at.y, at.z + (R() - 0.5) * spread, v.x, v.y, v.z, R() < 0.5 ? 0xffd028 : 0xff7ad8, (size || 1.4) * (0.7 + R() * 0.6), 0.45 + R() * 0.35, { hdr: 1.3, grow: -0.5, drag: 1.5, opacity: 0.95 });
}

// Trail streaming behind the player while they move: a vertical ribbon through the last few
// positions, tapering and fading toward the tail (rainbow trails cycle their colour).
// The ribbon is built in the vertex shader from a uniform array of points, so a moving trail
// never rewrites a vertex buffer (per-frame buffer uploads stall the GPU on ANGLE D3D11: six
// players' trails halved the frame rate). The shared geometry only holds (point index, side).
const TRAIL_N = 28;
const trailGeo = new T.BufferGeometry();
{
    const seg = new Float32Array(TRAIL_N * 2 * 3), idx = [];
    for (let i = 0; i < TRAIL_N; i++) for (let s = 0; s < 2; s++) { seg[(i * 2 + s) * 3] = i; seg[(i * 2 + s) * 3 + 1] = s; }
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    trailGeo.setAttribute('position', new T.BufferAttribute(seg, 3));
    trailGeo.setIndex(idx);
}
const trailMat = new T.ShaderMaterial({
    uniforms: { uPts: { value: new Float32Array(TRAIL_N * 4) }, uLen: { value: 0 }, uColor: { value: new T.Color() }, uRainbow: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
        uniform vec4 uPts[${TRAIL_N}];
        uniform float uLen, uRainbow, uTime;
        uniform vec3 uColor;
        varying vec3 vCol;
        void main() {
            vec4 p = uPts[int(position.x + 0.5)];
            float k = uLen > 1.0 ? max(0.0, 1.0 - position.x / (uLen - 1.0)) : 0.0;
            vec3 c = uColor;
            if (uRainbow > 0.5) {
                float h = fract(uTime * 0.4 + position.x / ${TRAIL_N}.0);
                vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
                c = 0.6 + (rgb - 0.5) * 0.8;
            }
            vCol = c * k * 0.95;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, p.y + (position.y > 0.5 ? p.w : -p.w), p.z, 1.0);
        }`,
    fragmentShader: /* glsl */`
        varying vec3 vCol;
        void main() {
            gl_FragColor = vec4(vCol, 1.0);
            #include <colorspace_fragment>
        }`,
    transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, forceSinglePass: true,
});
export function makeTrail(color) {
    const N = TRAIL_N, pts = [];
    // clone() shares typed-array uniforms, so each trail gets its own point buffer
    const mat = trailMat.clone(), u = mat.uniforms, buf = u.uPts.value = new Float32Array(N * 4);
    const mesh = new T.Mesh(trailGeo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    const c = u.uColor.value.set(color);
    let acc = 0;
    return {
        color, rainbow: false, width: 1,
        setColor(hex, rainbow) { this.color = hex; this.rainbow = !!rainbow; c.set(hex); u.uRainbow.value = rainbow ? 1 : 0; },
        reset() { pts.length = 0; mesh.visible = false; },
        update(at, on, dt, t) {
            acc += dt;
            if (acc >= 0.03) {
                acc = 0;
                if (on) pts.unshift(at.clone()); else pts.pop();
                if (pts.length > N) pts.length = N;
            }
            if (pts.length && on) pts[0].copy(at);
            mesh.visible = pts.length > 1;
            if (!mesh.visible) return;
            const n = pts.length;
            for (let i = 0; i < N; i++) {
                const p = pts[Math.min(i, n - 1)], o = i * 4;
                buf[o] = p.x; buf[o + 1] = p.y; buf[o + 2] = p.z;
                buf[o + 3] = i < n ? this.width * (1 - i / (n - 1)) : 0;
            }
            u.uLen.value = n;
            u.uTime.value = t || 0;
        },
        dispose() { scene.remove(mesh); mat.dispose(); },
    };
}

// Expanding ring on the ground (stage clears, big landings): a small pool of meshes, reused
const ringGeo = new T.RingGeometry(0.8, 1, 48);
const rings = [];
for (let i = 0; i < 14; i++) {
    const m = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide, forceSinglePass: true }));
    m.rotation.x = -Math.PI / 2; m.visible = false;
    scene.add(m);
    rings.push({ mesh: m, t: 0, life: 1, maxR: 9, on: false });
}
export function ring(pos, color, maxR, life, normal) {
    const r = rings.find((x) => !x.on) || rings[0];
    r.on = true; r.t = 0; r.life = life || 0.7; r.maxR = maxR || 9;
    r.mesh.material.color.set(color).multiplyScalar(1.4);
    if (normal) {
        // a splash ring flat on the face a ball hit
        r.mesh.position.copy(pos).addScaledVector(normal, 0.15);
        r.mesh.rotation.set(0, 0, 0);
        r.mesh.lookAt(r.mesh.position.x + normal.x, r.mesh.position.y + normal.y, r.mesh.position.z + normal.z);
    } else {
        r.mesh.rotation.set(-Math.PI / 2, 0, 0);
        r.mesh.position.copy(pos).setY(pos.y + 0.2);
    }
    r.mesh.visible = true;
}
// a dot of glow left behind a flying ball
export function trailDot(x, y, z, color, size) {
    glow.add(x + (R() - 0.5) * 0.3, y + (R() - 0.5) * 0.3, z + (R() - 0.5) * 0.3, 0, 0.5, 0, color, size || 0.5, 0.22 + R() * 0.1, { hdr: 1.3, grow: -0.5 });
}

// Fireworks: a glowing rocket that bursts into coloured sparks
const rockets = [];
const FW_COLORS = [0xffd028, 0x46ec50, 0x28c8ff, 0xff3fa0, 0xc428ff, 0xff4a6e];
export function fireworks(center, count, onBurst) {
    for (let i = 0; i < count; i++) {
        const a = R() * Math.PI * 2, r = 6 + R() * 10;
        rockets.push({
            p: new V3(center.x + Math.cos(a) * r, center.y + 1, center.z + Math.sin(a) * r),
            v: new V3((R() * 2 - 1) * 3, 34 + R() * 10, (R() * 2 - 1) * 3),
            t: 0.7 + R() * 0.3 + i * 0.18, trail: 0, color: FW_COLORS[(R() * FW_COLORS.length) | 0], onBurst,
        });
    }
}
function burstFw(p, color) {
    for (let i = 0; i < 56; i++) {
        const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = 16 + R() * 8;
        glow.add(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp, i % 5 ? color : 0xffffff, 1.5 + R() * 0.8, 1.1 + R() * 0.5, { hdr: 1.8, grav: 14, drag: 1.4, star: i % 4 === 0 });
    }
}
// Confetti: a colourful puff (stage clear, purchases)
export function confetti(pos) {
    for (const c of [0xff4a6e, 0xffd028, 0x46ec50, 0x3ad8ff, 0xc45aff, 0xffffff]) splash(new V3(pos.x, pos.y + 3, pos.z), c, 6, 1.5);
}

// ----- ambient particles all around the camera, per floor: glints drifting up, snowflakes over the
// freezing water, embers over the lava -----
const AMB = 220;
const ambGeo = new T.BufferGeometry();
{
    const pos = new Float32Array(AMB * 3), seed = new Float32Array(AMB);
    for (let i = 0; i < AMB; i++) { pos[i * 3] = R(); pos[i * 3 + 1] = R(); pos[i * 3 + 2] = R(); seed[i] = R(); }
    ambGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    ambGeo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
}
const ambMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new V3() }, uColor: { value: new T.Color(0xffffff) }, uScale: pointScale, uDir: { value: 0.5 }, uSnow: { value: 0 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uScale; uniform float uDir; uniform float uSnow; varying float vA; varying float vS;
        void main() {
            vec3 box = vec3(80.0, 50.0, 80.0);
            vec3 p = position * box;
            p.y += uTime * (1.0 + aSeed * 2.0) * uDir * (1.0 + uSnow * 2.0);
            p.x += sin(uTime * 0.5 + aSeed * 20.0) * (2.5 + uSnow * 3.0);
            vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
            vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0);
            vA = tw * (1.0 - smoothstep(14.0, 40.0, length(rel))) * smoothstep(4.0, 9.0, -mv.z);
            vS = aSeed;
            gl_PointSize = min(28.0, uScale * 0.35 * (0.35 + aSeed * 0.65) * (0.6 + tw * 0.4) * (1.0 + uSnow * 0.8) / max(1.0, -mv.z));
        }`,
    fragmentShader: `uniform vec3 uColor; uniform float uSnow; varying float vA; varying float vS;
        void main() {
            vec2 q = gl_PointCoord - 0.5;
            float core = pow(max(0.0, 1.0 - length(q) * 2.0), 2.0);
            float rays = max(0.0, 1.0 - abs(q.x) * 12.0) * max(0.0, 1.0 - abs(q.y) * 2.4) + max(0.0, 1.0 - abs(q.y) * 12.0) * max(0.0, 1.0 - abs(q.x) * 2.4);
            vec3 c = mix(uColor, vec3(1.0), 0.35 + 0.35 * sin(vS * 31.0));
            float soft = max(0.0, 1.0 - length(q) * 2.0);
            gl_FragColor = vec4(c * 1.2, mix((core + rays * 0.55) * 0.8, soft * 0.95, uSnow) * vA);
        }`,
});
const glitter = new T.Points(ambGeo, ambMat);
glitter.frustumCulled = false;
glitter.renderOrder = 5;
scene.add(glitter);
const ambTmp = new T.Color();
// amb: { color, dir (how fast the particles rise; below 0 they fall), snow (soft round flakes) }
export function updateAmbient(camPos, t, amb) {
    const u = ambMat.uniforms;
    u.uTime.value = t;
    u.uCam.value.copy(camPos);
    u.uColor.value.lerp(ambTmp.set(amb.color), 0.03);
    u.uDir.value += ((amb.dir ?? 0.5) - u.uDir.value) * 0.03;
    u.uSnow.value += ((amb.snow ? 1 : 0) - u.uSnow.value) * 0.03;
}

export function updateFx(dt) {
    glow.update(dt);
    soft.update(dt);
    for (const r of rings) {
        if (!r.on) continue;
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { r.on = false; r.mesh.visible = false; continue; }
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(1 + e * r.maxR);
        r.mesh.material.opacity = 1 - k;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 20 * dt;
        r.p.addScaledVector(r.v, dt);
        r.trail -= dt;
        if (r.trail <= 0) { r.trail = 0.03; glow.add(r.p.x, r.p.y, r.p.z, 0, -2, 0, 0xffe7a8, 1.1, 0.35, { hdr: 1.6 }); }
        r.t -= dt;
        if (r.t <= 0) { burstFw(r.p, r.color); if (r.onBurst) r.onBurst(); rockets.splice(i, 1); }
    }
}

// One of each effect material in the scene for the loading warm-up (main.js) so the first sparkle,
// ring or trail in play doesn't stop the game to compile its shader. Kept, never disposed.
export function fxWarmGroup() {
    const g = new T.Group();
    g.add(new T.Mesh(trailGeo, trailMat));
    return g;
}
// the pools and rings are always in the scene: make sure they're seen by the warm-up even when empty
export function fxShowAll(on) {
    for (const p of [glow, soft]) p.geo.setDrawRange(0, on ? 1 : p.n);
    for (const r of rings) r.mesh.visible = on || r.on;
}

applyQuality();

// ----- Destroy the Cube: hits, blasts, the blaster's flash, coins -----
// a little spray of sparks off a block that was hit (coloured like the block)
export function hitSpark(pos, color, nx, ny, nz) {
    for (let i = 0; i < 6; i++) {
        const a = R() * Math.PI * 2, sp = 4 + R() * 7;
        glow.add(pos.x, pos.y, pos.z, (nx || 0) * 8 + Math.cos(a) * sp, (ny || 0) * 8 + 2 + R() * 6, (nz || 0) * 8 + Math.sin(a) * sp, i % 2 ? color : 0xffffff, 0.5 + R() * 0.4, 0.28 + R() * 0.15, { hdr: 1.3, drag: 3, grav: 10, star: i === 0 });
    }
}
// a block popping: a ring of soft puffs and glints
export function breakPuff(pos, color) {
    for (let i = 0; i < 8; i++) {
        const a = R() * Math.PI * 2, u = R() * 2 - 1, sp = 6 + R() * 6;
        soft.add(pos.x, pos.y, pos.z, Math.cos(a) * sp, u * sp + 3, Math.sin(a) * sp, i % 3 ? 0xffffff : color, 1.4 + R() * 1.2, 0.4 + R() * 0.2, { grow: 1.6, drag: 4, opacity: 0.55 });
    }
    for (let i = 0; i < 5; i++) {
        const a = R() * Math.PI * 2;
        glow.add(pos.x, pos.y, pos.z, Math.cos(a) * 9, 4 + R() * 6, Math.sin(a) * 9, i % 2 ? color : 0xffffff, 0.7, 0.35, { hdr: 1.5, drag: 3, star: true });
    }
}
// an explosion (Exploding Balls, the Mega Cannon, TNT): a fireball, sparks and smoke
export function blastFx(pos, r) {
    const k = Math.max(0.6, r / 6);
    for (let i = 0; i < Math.round(26 * k); i++) {
        const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), sp = (10 + R() * 14) * k;
        glow.add(pos.x, pos.y, pos.z, s * Math.cos(th) * sp, u * sp + 4, s * Math.sin(th) * sp, R() < 0.5 ? 0xffd23a : R() < 0.5 ? 0xff6a1a : 0xffffff, (1.6 + R() * 1.4) * k, 0.45 + R() * 0.3, { hdr: 1.6, drag: 2.6, grow: 1.2 });
    }
    for (let i = 0; i < Math.round(12 * k); i++) {
        const a = R() * Math.PI * 2, sp = (4 + R() * 6) * k;
        soft.add(pos.x, pos.y, pos.z, Math.cos(a) * sp, 2 + R() * 5, Math.sin(a) * sp, R() < 0.5 ? 0xf0f0f4 : 0xc8ccd8, (2.4 + R() * 2) * k, 0.8 + R() * 0.4, { grow: 2.2, drag: 2.5, opacity: 0.6 });
    }
}
// the muzzle flash: a quick bright puff out of the barrel
export function muzzleFlash(pos, dir, color) {
    for (let i = 0; i < 5; i++) {
        const sp = 6 + R() * 10;
        glow.add(pos.x, pos.y, pos.z, dir.x * sp + (R() - 0.5) * 4, dir.y * sp + (R() - 0.5) * 4, dir.z * sp + (R() - 0.5) * 4, i % 2 ? color : 0xffffff, 0.5 + R() * 0.4, 0.12 + R() * 0.08, { hdr: 1.6, drag: 6 });
    }
}
// coins fountaining out of the sell machine
export function coinFountain(pos, n) {
    for (let i = 0; i < (n || 26); i++) {
        const a = R() * Math.PI * 2, sp = 3 + R() * 7;
        glow.add(pos.x + Math.cos(a), pos.y, pos.z + Math.sin(a), Math.cos(a) * sp, 16 + R() * 14, Math.sin(a) * sp, i % 4 ? 0xffd21e : 0xffffff, 1 + R() * 0.7, 1 + R() * 0.5, { hdr: 1.4, grav: 32, drag: 0.4, star: i % 3 === 0 });
    }
}
// a soft sparkle where a cube was collected
export function collectFx(pos, color) {
    for (let i = 0; i < 4; i++) {
        const a = R() * Math.PI * 2;
        glow.add(pos.x, pos.y, pos.z, Math.cos(a) * 3, 2 + R() * 3, Math.sin(a) * 3, i % 2 ? color : 0xffffff, 0.45, 0.3, { hdr: 1.4, drag: 4, star: i === 0 });
    }
}
