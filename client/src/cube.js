// The cube on screen, and everything that flies off it.
//
// The blocks are one InstancedMesh holding only the blocks you can see (any side open to the air):
// as blocks break, the ones behind them join the list. A block's data lives in three per-instance
// buffers (where it is, its colour, and fx = last hit time / damage / kind / stripes); a hit or a
// break rewrites just that block's slot, and all the slots touched in a frame go up to the GPU in a
// few small ranges. Everything that moves (the squish when a block is hit, the cracks, the gold
// glint, the rainbow, the cube building itself again) happens in the block shader.
//
// Dropped cubes, flying shards and the blaster's balls are GPU-driven too: each is written once
// when it starts (where from, how fast, when) and the vertex shader works out where it is now, so
// nothing is re-uploaded every frame (per-frame instance uploads stall the GPU on Windows / ANGLE).
import { T, V3, scene, sharedTex, textCanvas } from './engine.js';
import { CubeGrid, B, bounceTarget } from '../../shared/cube.js';
import { CUBES, KINDS, CFG } from '../../shared/config.js';

// a blank texture for sprites that get their text later (the shader with a map compiles at load)
const BLANK = new T.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
BLANK.needsUpdate = true;
export const U = {
    uTime: { value: 0 }, uBuild: { value: 99 }, uHL: { value: 0 }, uPlayer: { value: new V3() }, uAimSlot: { value: -1 },
};
const MAXN = 19 ** 3;

// ----- a block: a box with rounded edges (one bevel step, smooth normals) -----
export function roundedBlockGeo(size, r) {
    const h = size / 2, i = h - r;
    const pos = [], nor = [], idx = [];
    const faces = [
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const ts = [-h, -i, i, h];
    for (const [N, Uu, V] of faces) {
        const base = pos.length / 3;
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
            const u = ts[a], v = ts[b];
            const p = [N[0] * h + Uu[0] * u + V[0] * v, N[1] * h + Uu[1] * u + V[1] * v, N[2] * h + Uu[2] * u + V[2] * v];
            const q = p.map((x) => Math.max(-i, Math.min(i, x)));
            const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], l = Math.hypot(d[0], d[1], d[2]);
            const nn = l > 1e-6 ? d.map((x) => x / l) : N;
            pos.push(q[0] + nn[0] * r, q[1] + nn[1] * r, q[2] + nn[2] * r);
            nor.push(nn[0], nn[1], nn[2]);
        }
        for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
            const k = base + b * 4 + a;
            idx.push(k, k + 1, k + 5, k, k + 5, k + 4);
        }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
}

// Slots touched this frame go up in a few ranges (one big range when there are many)
class Dirty {
    constructor(attrs) { this.attrs = attrs; this.list = []; }
    mark(s) { this.list.push(s); }
    flush() {
        const L = this.list;
        if (!L.length) return;
        L.sort((a, b) => a - b);
        const ranges = [];
        let a = L[0], b = L[0];
        for (let k = 1; k < L.length; k++) {
            const s = L[k];
            if (s <= b + 1) { b = Math.max(b, s); continue; }
            ranges.push([a, b]); a = b = s;
        }
        ranges.push([a, b]);
        const list = ranges.length > 12 ? [[ranges[0][0], ranges[ranges.length - 1][1]]] : ranges;
        for (const at of this.attrs) {
            at.clearUpdateRanges();
            for (const [s0, s1] of list) at.addUpdateRange(s0 * at.itemSize, (s1 - s0 + 1) * at.itemSize);
            at.needsUpdate = true;
        }
        L.length = 0;
    }
}

// ----- shader bits shared by the block, drop and shard materials -----
const HUE = /* glsl */`vec3 hueRgb(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;
const CRACK = /* glsl */`
vec2 crH(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float crackF(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 r = g + crH(i + g) - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return sqrt(d2) - sqrt(d1);
}`;

// =====================================================================================
// The blocks
// =====================================================================================
const blockMat = new T.MeshLambertMaterial({ color: 0xffffff });
blockMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
            attribute vec4 aFx;
            uniform float uTime; uniform float uBuild; uniform float uAimSlot;
            varying vec3 vLoc; varying vec3 vObjN; varying vec4 vFx; varying float vFlash; varying float vSeed; varying vec3 vIP; varying float vAim;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
            vLoc = position; vObjN = normal; vFx = aFx;
            // a hit: a white flash and a jelly squish that springs back past its size; a neighbour
            // breaking: just the wobble (its time is stored + 100000). Damage dents it a little.
            bool wob = aFx.x > 50000.0;
            float since = uTime - (wob ? aFx.x - 100000.0 : aFx.x);
            float jig = since >= 0.0 && since < 1.6 ? exp(-since * 6.5) * cos(since * 26.0) : 0.0;
            vFlash = !wob && since >= 0.0 && since < 1.2 ? exp(-since * 9.0) : 0.0;
            transformed *= (1.0 - (wob ? 0.07 : 0.16) * jig) * (1.0 - 0.06 * aFx.y);
            vAim = abs(float(gl_InstanceID) - uAimSlot) < 0.5 ? 1.0 : 0.0;
            #ifdef USE_INSTANCING
                vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #else
                vec3 ip = vec3(0.0);
            #endif
            vIP = ip;
            vSeed = fract(sin(dot(ip, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float bk = clamp((uBuild - ip.y * 0.026 - vSeed * 0.45) / 0.6, 0.0, 1.0);
            float be = 1.0 - pow(1.0 - bk, 3.0);
            transformed *= mix(0.05, 1.0, be);
            transformed.y += (1.0 - be) * 55.0;`);
    sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
            uniform float uTime; uniform float uHL;
            varying vec3 vLoc; varying vec3 vObjN; varying vec4 vFx; varying float vFlash; varying float vSeed; varying vec3 vIP; varying float vAim;
            ${HUE}
            ${CRACK}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
            {
                vec3 an = abs(vObjN);
                vec2 uv = (an.x > 0.5 ? vLoc.zy : (an.y > 0.5 ? vLoc.xz : vLoc.xy)) / ${B.toFixed(1)};
                vec3 col = diffuseColor.rgb;
                float kind = vFx.z;
                // the inner blocks: diagonal stripes, like the reference's Tier 2 blocks
                if (vFx.w > 0.5) { float s = fract((uv.x + uv.y) * 2.6 + vSeed); col *= 1.0 - 0.2 * smoothstep(0.38, 0.46, s) * (1.0 - smoothstep(0.86, 0.94, s)); }
                // a soft plastic sheen toward the top of each face
                col += vec3(0.07) * (1.0 - smoothstep(0.0, 0.42, length(uv - vec2(-0.16, 0.18))));
                vec3 glow = vec3(0.0);
                if (kind > 0.5 && kind < 1.5) {
                    // GOLD: a glint sweeping across
                    float g = smoothstep(0.86, 1.0, sin((uv.x + uv.y) * 5.0 - uTime * 3.2 + vSeed * 6.28));
                    glow += vec3(1.0, 0.86, 0.4) * (0.12 + g * 0.55);
                } else if (kind > 1.5 && kind < 2.5) {
                    // GEM: a glowing diamond in the middle
                    float d = abs(uv.x) + abs(uv.y);
                    float gem = 1.0 - smoothstep(0.17, 0.23, d);
                    col = mix(col, vec3(1.0, 0.82, 1.0), gem * 0.6);
                    glow += vec3(0.85, 0.25, 1.0) * (0.18 + gem * (0.45 + 0.25 * sin(uTime * 5.0 + vSeed * 9.0)));
                } else if (kind > 2.5 && kind < 3.5) {
                    // TNT: a cream band with dark letters-ish dots, and a slow warning pulse
                    float band = 1.0 - smoothstep(0.12, 0.14, abs(uv.y));
                    float dots = step(0.5, fract(uv.x * 4.0 + 0.25)) * (1.0 - smoothstep(0.035, 0.05, abs(uv.y)));
                    col = mix(col, vec3(0.98, 0.93, 0.8), band);
                    col = mix(col, vec3(0.15, 0.08, 0.08), band * dots * 0.85);
                    glow += vec3(1.0, 0.15, 0.1) * (0.08 + 0.08 * sin(uTime * 6.0 + vSeed * 6.0));
                } else if (kind > 3.5) {
                    // RAINBOW
                    col = 0.45 + 0.6 * hueRgb(fract(uTime * 0.25 + (vIP.x + vIP.y + vIP.z) * 0.012 + uv.x * 0.35 + uv.y * 0.2));
                    glow += col * 0.28;
                }
                // cracks spread as the block loses its hit points
                float dmg = vFx.y;
                if (dmg > 0.01) {
                    float cr = crackF(uv * 3.2 + vSeed * 17.0);
                    float line = 1.0 - smoothstep(0.015 + 0.06 * dmg, 0.03 + 0.08 * dmg, cr);
                    col *= 1.0 - (0.18 * dmg + 0.55 * line * smoothstep(0.0, 0.3, dmg));
                }
                // the block under the crosshair: brighter, with a glowing rim
                float edgeA = smoothstep(0.36, 0.49, max(abs(uv.x), abs(uv.y)));
                col = mix(col, col * 1.2 + 0.06, vAim * 0.7);
                glow += vAim * edgeA * vec3(1.0, 0.96, 0.7) * (0.6 + 0.3 * sin(uTime * 9.0));
                // hit flash, and the last blocks of a cube glowing so you can find them
                col = mix(col, vec3(1.0), vFlash * 0.6);
                glow += uHL * (0.3 + 0.3 * sin(uTime * 7.0 + vSeed * 6.0)) * vec3(1.0, 0.95, 0.7);
                diffuseColor.rgb = col;
                // a little light of their own: soft, candy-like plastic from every side
                totalEmissiveRadiance += glow + col * 0.1;
            }`);
};
blockMat.customProgramCacheKey = () => 'dtc-block';

const tmpC = new T.Color();
const hash = (c) => { const x = Math.sin(c * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

export class CubeView {
    constructor() {
        this.geo = roundedBlockGeo(B * 0.966, 0.8);
        this.fx = new T.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4);
        this.fx.setUsage(T.DynamicDrawUsage);
        this.geo.setAttribute('aFx', this.fx);
        const m = (this.mesh = new T.InstancedMesh(this.geo, blockMat, MAXN));
        m.instanceMatrix.setUsage(T.DynamicDrawUsage);
        m.setColorAt(0, tmpC.set(0xffffff));
        m.instanceColor.setUsage(T.DynamicDrawUsage);
        const mat = m.instanceMatrix.array;
        for (let s = 0; s < MAXN; s++) { mat[s * 16] = mat[s * 16 + 5] = mat[s * 16 + 10] = mat[s * 16 + 15] = 1; }
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = true;
        m.boundingSphere = new T.Sphere(new V3(0, 30, 0), 100);
        scene.add(m);
        this.dirty = new Dirty([m.instanceMatrix, m.instanceColor, this.fx]);
        // The blocks inside (not shown) as plain dark boxes: the hairline grooves between rounded
        // blocks would otherwise look straight through the cube to the sky. 12 triangles each, no
        // shadows; they only ever show down the grooves.
        this.fillMat = new T.MeshBasicMaterial({ color: 0x1a3060 });
        const f = (this.fill = new T.InstancedMesh(new T.BoxGeometry(B, B, B), this.fillMat, MAXN));
        f.instanceMatrix.setUsage(T.DynamicDrawUsage);
        const fm = f.instanceMatrix.array;
        for (let s = 0; s < MAXN; s++) { fm[s * 16] = fm[s * 16 + 5] = fm[s * 16 + 10] = fm[s * 16 + 15] = 1; }
        f.count = 0;
        f.boundingSphere = m.boundingSphere;
        scene.add(f);
        this.fillDirty = new Dirty([f.instanceMatrix]);
        this.fillOf = new Int32Array(MAXN).fill(-1);
        this.fillCell = new Int32Array(MAXN);
        this.fillCount = 0;
        this.slotOf = new Int32Array(MAXN).fill(-1);
        this.cellOf = new Int32Array(MAXN);
        this.grid = null; this.srv = null; this.gen = -1; this.count = 0;
        this.nb = [];
    }
    // A whole cube: (level, seed) builds the layout, dead / dmg are what's already broken
    load(m, animate) {
        const g = (this.grid = new CubeGrid(m.level, m.seed));
        this.def = CUBES[m.level];
        this.gen = m.gen;
        if (m.dead) {
            const bin = atob(m.dead);
            for (let c = 0; c < g.N; c++) if (bin.charCodeAt(c >> 3) & (1 << (c & 7))) g.hp[c] = 0;
        }
        for (let i = 0; i < (m.dmg || []).length; i += 2) g.hp[m.dmg[i]] = m.dmg[i + 1];
        this.srv = Int32Array.from(g.hp);
        this.pend = new Map();
        this.slotOf.fill(-1);
        this.fillOf.fill(-1);
        this.count = 0; this.fillCount = 0;
        for (let c = 0; c < g.N; c++) if (g.hp[c] > 0) { if (g.exposed(c)) this.add(c, true); else this.fillAdd(c, true); }
        this.mesh.count = this.count;
        this.fill.count = this.fillCount;
        this.fillMat.color.set(this.def.colors[2]).multiplyScalar(0.32);
        this.fill.instanceMatrix.clearUpdateRanges(); this.fill.instanceMatrix.needsUpdate = true;
        this.fillDirty.list.length = 0;
        this.mesh.boundingSphere.set(new V3(0, g.top / 2, 0), g.half * 1.75 + 8);
        for (const at of [this.mesh.instanceMatrix, this.mesh.instanceColor, this.fx]) { at.clearUpdateRanges(); at.needsUpdate = true; }
        this.dirty.list.length = 0;
        U.uBuild.value = animate ? 0 : 99;
        U.uHL.value = 0;
    }
    alive() { let n = 0; const hp = this.grid.hp; for (let c = 0; c < hp.length; c++) if (hp[c] > 0) n++; return n; }
    colorOf(c) {
        const g = this.grid, k = g.kind[c], d = this.def;
        if (k) tmpC.set(KINDS[k].color);
        else if (d.rainbowShells) tmpC.setHSL(((g.cx(c) + g.cy(c) + g.cz(c)) / (g.n * 3) + hash(c) * 0.08) % 1, 0.78, 0.62);
        else if (d.accent && hash(c + 0.37) < 0.1) tmpC.set(d.accent[hash(c + 1.71) < 0.5 ? 0 : 1]).multiplyScalar(g.depth[c] >= 4 ? 0.72 : g.depth[c] >= 2 ? 0.86 : 1);
        else tmpC.set(d.colors[g.depth[c] >= 4 ? 2 : g.depth[c] >= 2 ? 1 : 0]);
        const v =(((g.cx(c) + g.cy(c) + g.cz(c)) & 1) ? 1.04 : 0.96) * (0.97 + hash(c) * 0.06);
        return tmpC.multiplyScalar(v);
    }
    add(c, bulk) {
        const g = this.grid, s = this.count++;
        this.slotOf[c] = s; this.cellOf[s] = c;
        const mat = this.mesh.instanceMatrix.array, o = s * 16;
        mat[o + 12] = g.wx(c); mat[o + 13] = g.wy(c); mat[o + 14] = g.wz(c);
        const col = this.colorOf(c), ca = this.mesh.instanceColor.array;
        ca[s * 3] = col.r; ca[s * 3 + 1] = col.g; ca[s * 3 + 2] = col.b;
        const f = this.fx.array;
        f[s * 4] = -100; f[s * 4 + 1] = 1 - g.hp[c] / g.maxHp[c]; f[s * 4 + 2] = g.kind[c]; f[s * 4 + 3] = g.depth[c] >= 2 ? 1 : 0;
        if (!bulk) { this.dirty.mark(s); this.mesh.count = this.count; }
    }
    fillAdd(c, bulk) {
        const g = this.grid, s = this.fillCount++;
        this.fillOf[c] = s; this.fillCell[s] = c;
        const mat = this.fill.instanceMatrix.array, o = s * 16;
        mat[o + 12] = g.wx(c); mat[o + 13] = g.wy(c); mat[o + 14] = g.wz(c);
        if (!bulk) { this.fillDirty.mark(s); this.fill.count = this.fillCount; }
    }
    fillRemove(c) {
        const s = this.fillOf[c];
        if (s < 0) return;
        const last = this.fillCount - 1, cl = this.fillCell[last];
        if (s !== last) {
            const mat = this.fill.instanceMatrix.array;
            for (let k = 12; k < 15; k++) mat[s * 16 + k] = mat[last * 16 + k];
            this.fillOf[cl] = s; this.fillCell[s] = cl;
            this.fillDirty.mark(s);
        }
        this.fillOf[c] = -1;
        this.fillCount--;
        this.fill.count = this.fillCount;
    }
    // a block left the cube: the last slot moves into its place, the blocks behind it show
    remove(c) {
        this.fillRemove(c);
        const s = this.slotOf[c], g = this.grid;
        if (s >= 0) {
            const last = this.count - 1, cl = this.cellOf[last];
            if (s !== last) {
                const mat = this.mesh.instanceMatrix.array, ca = this.mesh.instanceColor.array, f = this.fx.array;
                for (let k = 12; k < 15; k++) mat[s * 16 + k] = mat[last * 16 + k];
                for (let k = 0; k < 3; k++) ca[s * 3 + k] = ca[last * 3 + k];
                for (let k = 0; k < 4; k++) f[s * 4 + k] = f[last * 4 + k];
                this.slotOf[cl] = s; this.cellOf[s] = cl;
                this.dirty.mark(s);
            }
            this.slotOf[c] = -1;
            this.count--;
            this.mesh.count = this.count;
        }
        for (const n of g.neighbours(c, this.nb)) if (g.hp[n] > 0 && this.slotOf[n] < 0 && g.exposed(n)) { this.fillRemove(n); this.add(n); }
    }
    // a block put back (a hit the server never agreed with)
    restore(c) {
        const g = this.grid;
        if (this.slotOf[c] >= 0 || this.fillOf[c] >= 0 || g.hp[c] <= 0) return;
        if (g.exposed(c)) this.add(c); else this.fillAdd(c);
    }
    // hit: flash + squish; and how cracked it looks
    touch(c, now) {
        const s = this.slotOf[c];
        if (s < 0) return;
        const g = this.grid, f = this.fx.array;
        if (now !== undefined) f[s * 4] = now;
        f[s * 4 + 1] = Math.max(0, 1 - g.hp[c] / g.maxHp[c]);
        this.dirty.mark(s);
    }
    // a neighbour broke: a little wobble (no flash)
    wobble(c, now) {
        const s = this.slotOf[c];
        if (s < 0) return;
        const f = this.fx.array;
        if (f[s * 4] < 50000 && now - f[s * 4] < 0.3) return;
        f[s * 4] = 100000 + now;
        this.dirty.mark(s);
    }
    flush() {
        this.dirty.flush(); this.fillDirty.flush();
        // hidden while the cube builds itself (the blocks fly in from above)
        this.fill.visible = !this.hidden && U.uBuild.value > 3.4;
        this.mesh.visible = !this.hidden;
    }
    clear() { this.mesh.count = this.count = 0; this.slotOf.fill(-1); this.fill.count = this.fillCount = 0; this.fillOf.fill(-1); }
}
export const cube = new CubeView();

// =====================================================================================
// Dropped cubes: fall, bounce once, sit and bob; stacks merge ("12x"); fly to you when grabbed
// =====================================================================================
const DROP_MAX = 700, DROP_G = 70, DROP_SIZE = 1.9;
const dropMat = new T.MeshLambertMaterial({ color: 0xffffff });
const DROP_FN = /* glsl */`
    const float DG = ${DROP_G.toFixed(1)};
    float landT(vec4 A, vec4 Bv) { float vy = Bv.y; float h = A.y - Bv.w; return (vy + sqrt(max(0.0, vy * vy + 2.0 * DG * h))) / DG; }
    vec3 dropPos(vec4 A, vec4 Bv, float t) {
        float tl = landT(A, Bv);
        if (t < tl) return vec3(A.x + Bv.x * t, A.y + Bv.y * t - 0.5 * DG * t * t, A.z + Bv.z * t);
        vec3 p = vec3(A.x + Bv.x * tl, Bv.w, A.z + Bv.z * tl);
        float tb = t - tl, bv = min(12.0, abs(Bv.y - DG * tl) * 0.28), tb2 = 2.0 * bv / DG;
        if (tb < tb2) p.y += bv * tb - 0.5 * DG * tb * tb;
        return p;
    }`;
dropMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
            attribute vec4 aA; attribute vec4 aB; attribute vec4 aC;
            uniform float uTime; uniform vec3 uPlayer;
            ${DROP_FN}`)
        .replace('void main() {', `void main() {
            float dT = uTime - aA.w;
            float dTl = landT(aA, aB);
            float dRest = smoothstep(0.0, 0.6, dT - dTl);
            float dSpin = aC.z * 6.2832 + uTime * 0.9 * dRest + dT * 7.0 * (1.0 - dRest);
            mat2 dR = mat2(cos(dSpin), -sin(dSpin), sin(dSpin), cos(dSpin));`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal.xz = dR * objectNormal.xz;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
            float sc = aC.y * aC.w;
            transformed.xz = dR * transformed.xz;
            vec3 wpos = dropPos(aA, aB, dT) + vec3(0.0, ${(DROP_SIZE / 2).toFixed(2)} * sc + dRest * (sin(uTime * 2.6 + aC.z * 6.28) * 0.22 + 0.3), 0.0);
            if (uTime > aC.x) {
                float k = clamp((uTime - aC.x) / 0.3, 0.0, 1.0);
                vec3 from = dropPos(aA, aB, aC.x - aA.w) + vec3(0.0, ${(DROP_SIZE / 2).toFixed(2)} * sc, 0.0);
                wpos = mix(from, uPlayer, k * k);
                wpos.y += sin(k * 3.1416) * 3.0;
                sc *= 1.0 - k * 0.75;
            }
            transformed = transformed * sc + wpos;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>');
};
dropMat.customProgramCacheKey = () => 'dtc-drop';
const dropT = (vy, h) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * DROP_G * h))) / DROP_G;

class Drops {
    constructor() {
        const geo = roundedBlockGeo(DROP_SIZE, 0.36);
        this.aA = new T.InstancedBufferAttribute(new Float32Array(DROP_MAX * 4), 4);
        this.aB = new T.InstancedBufferAttribute(new Float32Array(DROP_MAX * 4), 4);
        this.aC = new T.InstancedBufferAttribute(new Float32Array(DROP_MAX * 4), 4);
        for (const a of [this.aA, this.aB, this.aC]) { a.setUsage(T.DynamicDrawUsage); geo.setAttribute(a === this.aA ? 'aA' : a === this.aB ? 'aB' : 'aC', a); }
        for (let s = 0; s < DROP_MAX; s++) this.aC.array[s * 4] = 1e9;
        const m = (this.mesh = new T.InstancedMesh(geo, dropMat, DROP_MAX));
        m.setColorAt(0, tmpC.set(0xffffff));
        m.instanceColor.setUsage(T.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = false; m.receiveShadow = true;
        m.count = 0; m.visible = false;
        this.hi = 0;
        scene.add(m);
        this.dirty = new Dirty([this.aA, this.aB, this.aC, m.instanceColor]);
        this.free = [];
        for (let s = DROP_MAX - 1; s >= 0; s--) this.free.push(s);
        this.list = [];            // live drops (stacks)
        this.byId = new Map();     // block id -> its stack
        this.labels = [];
        for (let i = 0; i < 24; i++) {
            const sp = new T.Sprite(new T.SpriteMaterial({ map: BLANK, transparent: true, depthWrite: false, toneMapped: false }));
            sp.visible = false; sp.renderOrder = 9; scene.add(sp);
            this.labels.push(sp);
        }
        this.labelT = 0;
    }
    write(d) {
        const s = d.slot, A = this.aA.array, Bb = this.aB.array, C = this.aC.array, col = this.mesh.instanceColor.array;
        A[s * 4] = d.ox; A[s * 4 + 1] = d.oy; A[s * 4 + 2] = d.oz; A[s * 4 + 3] = d.t0;
        Bb[s * 4] = d.vx; Bb[s * 4 + 1] = d.vy; Bb[s * 4 + 2] = d.vz; Bb[s * 4 + 3] = d.landY;
        C[s * 4] = d.grabT ?? 1e9; C[s * 4 + 1] = d.scale; C[s * 4 + 2] = d.spin; C[s * 4 + 3] = d.alive ? 1 : 0;
        col[s * 3] = d.r; col[s * 3 + 1] = d.g; col[s * 3 + 2] = d.b;
        this.dirty.mark(s);
        if (d.alive && s + 1 > this.hi) { this.hi = s + 1; this.mesh.count = this.hi; this.mesh.visible = true; }
    }
    // A cube falling from block id at (x, y, z), thrown along (nx, nz) (the side the ball came in from)
    spawn(id, grid, x, y, z, nx, nz, color, now, value) {
        if (!this.free.length) this.collectOldest();
        const slot = this.free.pop();
        const a = Math.random() * Math.PI * 2, out = 3 + Math.random() * 5;
        const vx = nx * out + Math.cos(a) * 2.2, vz = nz * out + Math.sin(a) * 2.2, vy = 9 + Math.random() * 7;
        // where it lands: on top of whatever stands under the spot it falls to (twice, as the spot
        // depends on how long it falls)
        let landY = 0;
        for (let k = 0; k < 2; k++) {
            const tl = dropT(vy, y - landY);
            landY = groundAt(grid, x + vx * tl, z + vz * tl, y);
        }
        const tl = dropT(vy, y - landY);
        tmpC.set(color);
        const d = {
            id, ids: [id], n: 1, slot, ox: x, oy: y, oz: z, vx, vy, vz, landY, t0: now, tl, x: x + vx * tl, z: z + vz * tl, y: landY,
            landed: false, grabbed: false, grabT: null, scale: 1, spin: Math.random(), alive: true, r: tmpC.r, g: tmpC.g, b: tmpC.b, value: value || 1,
        };
        this.write(d);
        this.list.push(d);
        this.byId.set(id, d);
        return d;
    }
    freeDrop(d) {
        d.alive = false;
        this.write(d);
        this.free.push(d.slot);
        const i = this.list.indexOf(d);
        if (i >= 0) this.list.splice(i, 1);
        if (!this.list.length) { this.mesh.visible = false; this.hi = 0; this.mesh.count = 0; }
    }
    // a block someone else turned out to have broken (or a hit that never happened): its cube goes
    removeId(id) {
        const d = this.byId.get(id);
        if (!d) return;
        this.byId.delete(id);
        const i = d.ids.indexOf(id);
        if (i >= 0) d.ids.splice(i, 1);
        d.n = d.ids.length;
        if (!d.n) this.freeDrop(d); else this.restack(d);
    }
    restack(d) { d.scale = Math.min(2.3, 1 + 0.16 * Math.sqrt(d.n - 1)); this.write(d); }
    clearAll() {
        for (const d of [...this.list]) this.freeDrop(d);
        this.byId.clear();
    }
    collectOldest() { const d = this.list[0]; if (d) { for (const id of d.ids) this.byId.delete(id); this.freeDrop(d); } }
    // Landing, stacking, re-falling when the block under a cube breaks, and grabbing the ones in
    // reach (onGrab(stack, take) decides how many the backpack can take; onCollect when they arrive)
    update(now, grid, px, py, pz, range, onGrab, onCollect) {
        const r2 = range * range;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const d = this.list[i];
            if (d.grabbed) {
                if (now - d.grabT >= 0.3) { this.freeDrop(d); onCollect(d); }
                continue;
            }
            if (!d.landed) {
                if (now < d.t0 + d.tl + 0.12) continue;
                d.landed = true;
                // merge into a stack that's already lying close by
                for (const o of this.list) {
                    if (o === d || !o.landed || o.grabbed || o.n >= 99) continue;
                    if ((o.x - d.x) ** 2 + (o.z - d.z) ** 2 < 2.8 * 2.8 && Math.abs(o.y - d.y) < 1.5) {
                        for (const id of d.ids) { o.ids.push(id); this.byId.set(id, o); }
                        o.n = o.ids.length;
                        this.restack(o);
                        this.freeDrop(d);
                        d.merged = true;
                        break;
                    }
                }
                if (d.merged) continue;
            }
            // the block it sat on is gone: fall again
            if (grid && d.y > 0.5 && groundAt(grid, d.x, d.z, d.y + 0.5) < d.y - 0.5) {
                const ly = groundAt(grid, d.x, d.z, d.y + 0.5);
                Object.assign(d, { ox: d.x, oy: d.y, oz: d.z, vx: 0, vy: 2, vz: 0, landY: ly, t0: now, tl: dropT(2, d.y - ly), y: ly, landed: false });
                this.write(d);
                continue;
            }
            const dx = d.x - px, dz = d.z - pz;
            if (dx * dx + dz * dz < r2 && Math.abs(d.y - py) < 12) {
                const take = onGrab(d);
                if (take <= 0) continue;
                if (take < d.n) {
                    // the backpack has room for some: those fly over, the rest stay as a smaller stack
                    const ids = d.ids.splice(0, take);
                    d.n = d.ids.length;
                    this.restack(d);
                    if (!this.free.length) continue;
                    const part = { ...d, ids, n: ids.length, slot: this.free.pop(), grabbed: true, grabT: now, landed: true, scale: 1, merged: false };
                    for (const id of ids) this.byId.set(id, part);
                    this.write(part);
                    this.list.push(part);
                } else {
                    d.grabbed = true; d.grabT = now;
                    this.write(d);
                }
            }
        }
        this.flushLabels(now, px, py, pz);
        this.dirty.flush();
    }
    // "12x" over the nearest stacks
    flushLabels(now, px, py, pz) {
        if (now - this.labelT < 0.15) return;
        this.labelT = now;
        const stacks = this.list.filter((d) => d.landed && !d.grabbed && d.n > 1)
            .map((d) => [d, (d.x - px) ** 2 + (d.z - pz) ** 2]).filter((x) => x[1] < 90 * 90).sort((a, b) => a[1] - b[1]);
        this.labels.forEach((sp, i) => {
            const e = stacks[i];
            if (!e) { sp.visible = false; return; }
            const d = e[0], txt = d.n + 'x';
            const map = sharedTex('stack|' + txt, () => textCanvas([{ t: txt, c: '#ffffff', s: '#1a2a5a', px: 64 }], 256));
            if (sp.material.map !== map) { sp.material.map = map; sp.material.needsUpdate = true; }
            const w = 2.6 * d.scale;
            sp.scale.set(w, w * map.image.height / map.image.width, 1);
            sp.position.set(d.x, d.y + DROP_SIZE * d.scale + 1.6, d.z);
            sp.visible = true;
        });
    }
    // where a stack of landed cubes is (for the guide arrow)
    nearest(px, pz) {
        let best = null, bd = Infinity;
        for (const d of this.list) { if (!d.landed || d.grabbed) continue; const q = (d.x - px) ** 2 + (d.z - pz) ** 2; if (q < bd) { bd = q; best = d; } }
        return best;
    }
}
// The top of the highest block (or the ground) under (x, z), at or below height y
export function groundAt(grid, x, z, y) {
    if (!grid) return 0;
    const gx = Math.floor((x - grid.x0) / B), gz = Math.floor((z - grid.z0) / B);
    if (gx < 0 || gz < 0 || gx >= grid.n || gz >= grid.n) return 0;
    for (let gy = Math.min(grid.n - 1, Math.floor((y + 0.01) / B) - 1); gy >= 0; gy--) if (grid.hp[gx + grid.n * (gz + grid.n * gy)] > 0) return (gy + 1) * B;
    return 0;
}
export const drops = new Drops();

// =====================================================================================
// Debris: chunks bursting off a broken block. Each flies on a ballistic arc, bounces on the floor
// under it (losing most of its speed each time), tumbles, settles and shrinks away. All of it in the
// vertex shader from what was written once at the start (ring buffer).
// =====================================================================================
const SHARD_MAX = 720, DEB_G = 70;
const shardMat = new T.MeshLambertMaterial({ color: 0xffffff });
shardMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
            attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; uniform float uTime;
            const float DG = ${DEB_G.toFixed(1)};
            vec3 debPos(float t, out float restT) {
                vec3 p = aA.xyz, v = aB.xyz;
                float fy = aC.x, tt = t;
                restT = 1e9;
                for (int i = 0; i < 4; i++) {
                    float tau = (v.y + sqrt(v.y * v.y + 2.0 * DG * max(0.0, p.y - fy))) / DG;
                    if (tt <= tau) { p += v * tt; p.y -= 0.5 * DG * tt * tt; return p; }
                    p += v * tau; p.y = fy; tt -= tau;
                    v.y = -(v.y - DG * tau) * 0.38; v.xz *= 0.55;
                    if (v.y < 2.5) { restT = t - tt; return p; }
                }
                restT = t - tt;
                return p;
            }`)
        .replace('void main() {', `void main() {
            float sT = uTime - aA.w;
            float sRest;
            vec3 sP = debPos(max(sT, 0.0), sRest);
            float sAng = min(sT, sRest) * (5.0 + aC.z * 7.0) + aC.z * 20.0;
            mat3 sR = mat3(cos(sAng), sin(sAng), 0.0, -sin(sAng), cos(sAng), 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, cos(sAng * 0.7), sin(sAng * 0.7), 0.0, -sin(sAng * 0.7), cos(sAng * 0.7));`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal = sR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
            float k = sT / aC.y;
            float sc = (sT < 0.0 || k > 1.0) ? 0.0 : aB.w * (1.0 - smoothstep(0.72, 1.0, k));
            transformed = sR * transformed * sc + sP + vec3(0.0, 0.5 * sc, 0.0);`);
};
shardMat.customProgramCacheKey = () => 'dtc-debris';
class Shards {
    constructor() {
        const geo = roundedBlockGeo(1, 0.16);
        this.aA = new T.InstancedBufferAttribute(new Float32Array(SHARD_MAX * 4), 4);
        this.aB = new T.InstancedBufferAttribute(new Float32Array(SHARD_MAX * 4), 4);
        this.aC = new T.InstancedBufferAttribute(new Float32Array(SHARD_MAX * 4), 4);
        for (let k = 0; k < SHARD_MAX; k++) { this.aA.array[k * 4 + 3] = -100; this.aC.array[k * 4 + 1] = 1; }
        geo.setAttribute('aA', this.aA); geo.setAttribute('aB', this.aB); geo.setAttribute('aC', this.aC);
        const m = (this.mesh = new T.InstancedMesh(geo, shardMat, SHARD_MAX));
        m.setColorAt(0, tmpC.set(0xffffff));
        for (const a of [this.aA, this.aB, this.aC, m.instanceColor]) a.setUsage(T.DynamicDrawUsage);
        m.frustumCulled = false; m.count = 0; m.visible = false;
        m.castShadow = false; m.receiveShadow = true;
        scene.add(m);
        this.dirty = new Dirty([this.aA, this.aB, this.aC, m.instanceColor]);
        this.next = 0; this.hi = 0; this.until = 0;
    }
    // n chunks out of a block at (x, y, z), thrown mostly along (nx, ny, nz); they land on floorY
    burst(x, y, z, color, n, power, now, nx, ny, nz, floorY) {
        tmpC.set(color);
        const p = power || 1;
        nx = nx || 0; ny = ny || 0; nz = nz || 0;
        for (let i = 0; i < n; i++) {
            const k = this.next; this.next = (this.next + 1) % SHARD_MAX;
            const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = (5 + Math.random() * 9) * p, out = (5 + Math.random() * 9) * p;
            const A = this.aA.array, Bb = this.aB.array, C = this.aC.array, col = this.mesh.instanceColor.array;
            A[k * 4] = x + (Math.random() - 0.5) * 3; A[k * 4 + 1] = y + (Math.random() - 0.5) * 3; A[k * 4 + 2] = z + (Math.random() - 0.5) * 3; A[k * 4 + 3] = now + Math.random() * 0.04;
            Bb[k * 4] = Math.cos(a) * r * sp + nx * out; Bb[k * 4 + 1] = u * sp * 0.6 + 7 + Math.random() * 7 + ny * out; Bb[k * 4 + 2] = Math.sin(a) * r * sp + nz * out;
            // a few big chunks, more small bits
            Bb[k * 4 + 3] = i < 2 ? 1.2 + Math.random() * 0.7 : 0.45 + Math.random() * 0.7;
            C[k * 4] = floorY || 0; C[k * 4 + 1] = 1.4 + Math.random() * 0.9; C[k * 4 + 2] = Math.random();
            const v = 0.85 + Math.random() * 0.3;
            col[k * 3] = tmpC.r * v; col[k * 3 + 1] = tmpC.g * v; col[k * 3 + 2] = tmpC.b * v;
            this.dirty.mark(k);
            if (k + 1 > this.hi) this.hi = k + 1;
        }
        this.until = Math.max(this.until, now + 2.5);
        this.mesh.count = this.hi; this.mesh.visible = true;
    }
    flush() {
        this.dirty.flush();
        // all settled and faded: stop drawing, start the ring from 0 again
        if (this.mesh.visible && U.uTime.value > this.until) { this.mesh.visible = false; this.next = this.hi = this.mesh.count = 0; }
    }
}
export const shards = new Shards();

const FALL_MAX = 1400, FALL_G = 95;
const fallMat = new T.MeshLambertMaterial({ color: 0xffffff });
fallMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
            attribute vec4 aA; attribute vec4 aB; uniform float uTime;`)
        .replace('void main() {', `void main() {
            float fT = uTime - aA.w;
            float fY = aA.y - 0.5 * ${FALL_G.toFixed(1)} * fT * fT;
            float fA = fT * fT * (aB.y - 0.5) * 1.6;
            mat3 fR = mat3(1.0, 0.0, 0.0, 0.0, cos(fA), sin(fA), 0.0, -sin(fA), cos(fA)) * mat3(cos(fA * 0.6), sin(fA * 0.6), 0.0, -sin(fA * 0.6), cos(fA * 0.6), 0.0, 0.0, 0.0, 1.0);`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal = fR * objectNormal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
            float fOn = (fT >= 0.0 && fY > aB.x) ? 1.0 : 0.0;
            transformed = fR * transformed * fOn + vec3(aA.x, max(fY, aB.x), aA.z);`);
};
fallMat.customProgramCacheKey = () => 'dtc-fall';
class Fallers {
    constructor() {
        const geo = roundedBlockGeo(B * 0.966, 0.8);
        this.aA = new T.InstancedBufferAttribute(new Float32Array(FALL_MAX * 4), 4);
        this.aB = new T.InstancedBufferAttribute(new Float32Array(FALL_MAX * 4), 4);
        for (let k = 0; k < FALL_MAX; k++) { this.aA.array[k * 4 + 3] = -100; this.aB.array[k * 4] = 1e6; }
        geo.setAttribute('aA', this.aA); geo.setAttribute('aB', this.aB);
        const m = (this.mesh = new T.InstancedMesh(geo, fallMat, FALL_MAX));
        m.setColorAt(0, tmpC.set(0xffffff));
        for (const a of [this.aA, this.aB, m.instanceColor]) a.setUsage(T.DynamicDrawUsage);
        // no shadow: the depth pass would not run the fall animation (all at the origin)
        m.frustumCulled = false; m.count = 0; m.visible = false;
        m.castShadow = false; m.receiveShadow = true;
        scene.add(m);
        this.dirty = new Dirty([this.aA, this.aB, m.instanceColor]);
        this.next = 0; this.hi = 0; this.until = 0;
        this.landing = [];
    }
    // a block dropping from (x, y, z) to landY (its centre); info comes back when it lands
    fall(x, y, z, landY, color, now, info) {
        const k = this.next; this.next = (this.next + 1) % FALL_MAX;
        const A = this.aA.array, Bb = this.aB.array, col = this.mesh.instanceColor.array;
        A[k * 4] = x; A[k * 4 + 1] = y; A[k * 4 + 2] = z; A[k * 4 + 3] = now;
        Bb[k * 4] = landY; Bb[k * 4 + 1] = Math.random();
        tmpC.set(color);
        col[k * 3] = tmpC.r; col[k * 3 + 1] = tmpC.g; col[k * 3 + 2] = tmpC.b;
        this.dirty.mark(k);
        const t = Math.sqrt(Math.max(0, 2 * (y - landY) / FALL_G));
        this.landing.push({ at: now + t, x, y: landY, z, color, ...info });
        if (k + 1 > this.hi) this.hi = k + 1;
        this.until = Math.max(this.until, now + t + 0.1);
        this.mesh.count = this.hi; this.mesh.visible = true;
    }
    // calls onLand(block) for every block that hit the ground this frame
    update(now, onLand) {
        for (let i = this.landing.length - 1; i >= 0; i--) {
            const b = this.landing[i];
            if (b.at > now) continue;
            this.landing.splice(i, 1);
            onLand(b);
        }
    }
    clear() { this.landing.length = 0; for (let k = 0; k < FALL_MAX; k++) this.aA.array[k * 4 + 3] = -100; this.aA.clearUpdateRanges(); this.aA.needsUpdate = true; this.mesh.visible = false; this.next = this.hi = this.mesh.count = 0; }
    flush() {
        this.dirty.flush();
        if (this.mesh.visible && U.uTime.value > this.until) { this.mesh.visible = false; this.next = this.hi = this.mesh.count = 0; }
    }
}
export const fallers = new Fallers();

// =====================================================================================
// Balls: the blaster's shots (a glowing ball with a streak), each written once and flown by the GPU
// =====================================================================================
const BALL_MAX = 256;
const ballMat = new T.ShaderMaterial({
    uniforms: U,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, forceSinglePass: true,
    vertexShader: /* glsl */`
        attribute vec4 aA; attribute vec4 aB; attribute vec4 aC;
        uniform float uTime;
        varying vec3 vCol; varying float vS; varying float vY; varying float vTail;
        void main() {
            float k = (uTime - aA.w) / aB.w;
            if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            vec3 P = mix(aA.xyz, aB.xyz, k);
            vec3 D = normalize(aB.xyz - aA.xyz + vec3(1e-4));
            vec3 V = normalize(cameraPosition - P);
            vec3 S = normalize(cross(D, V) + vec3(1e-5));
            float r = aC.w;
            float len = min(r * 9.0, length(aB.xyz - aA.xyz) * k + r);
            // position.x: 0 the tail's end .. 1 the front of the ball; position.y: -1..1 across
            float s = position.x * (len + r) - len;
            vec3 w = P + D * s + S * position.y * r * 1.2;
            vS = s / r; vY = position.y * 1.2; vTail = len / r;
            vCol = aC.rgb;
            gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
    fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vS; varying float vY; varying float vTail;
        void main() {
            float rad = length(vec2(vS, vY));
            float ball = 1.0 - smoothstep(0.55, 1.0, rad);
            float back = clamp(-vS / max(0.001, vTail), 0.0, 1.0);
            float tail = (1.0 - smoothstep(0.0, 0.75 * (1.0 - back) + 0.05, abs(vY))) * (1.0 - back) * step(vS, 0.0);
            float core = 1.0 - smoothstep(0.0, 0.6, rad);
            float a = max(ball, tail * 0.7);
            if (a < 0.01) discard;
            gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.8) * 1.2, a);
        }`,
});
class Balls {
    constructor() {
        const geo = new T.InstancedBufferGeometry();
        geo.setAttribute('position', new T.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        this.aA = new T.InstancedBufferAttribute(new Float32Array(BALL_MAX * 4), 4);
        this.aB = new T.InstancedBufferAttribute(new Float32Array(BALL_MAX * 4), 4);
        this.aC = new T.InstancedBufferAttribute(new Float32Array(BALL_MAX * 4), 4);
        for (let s = 0; s < BALL_MAX; s++) { this.aA.array[s * 4 + 3] = -100; this.aB.array[s * 4 + 3] = 1; }
        for (const [n, a] of [['aA', this.aA], ['aB', this.aB], ['aC', this.aC]]) { a.setUsage(T.DynamicDrawUsage); geo.setAttribute(n, a); }
        geo.instanceCount = BALL_MAX;
        this.mesh = new T.Mesh(geo, ballMat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 7;
        scene.add(this.mesh);
        this.dirty = new Dirty([this.aA, this.aB, this.aC]);
        this.next = 0;
    }
    // a ball from a to b, taking dur seconds, starting now
    fly(a, b, dur, color, size, now) {
        const s = this.next; this.next = (this.next + 1) % BALL_MAX;
        const A = this.aA.array, Bb = this.aB.array, C = this.aC.array;
        A[s * 4] = a.x; A[s * 4 + 1] = a.y; A[s * 4 + 2] = a.z; A[s * 4 + 3] = now;
        Bb[s * 4] = b.x; Bb[s * 4 + 1] = b.y; Bb[s * 4 + 2] = b.z; Bb[s * 4 + 3] = Math.max(0.02, dur);
        tmpC.set(color);
        C[s * 4] = tmpC.r; C[s * 4 + 1] = tmpC.g; C[s * 4 + 2] = tmpC.b; C[s * 4 + 3] = size;
        this.dirty.mark(s);
    }
    flush() { this.dirty.flush(); }
}
export const balls = new Balls();

// =====================================================================================
// Damage numbers: a small pool of sprites popping up off the blocks you hit
// =====================================================================================
class DmgNums {
    constructor() {
        this.pool = [];
        for (let i = 0; i < 26; i++) {
            const sp = new T.Sprite(new T.SpriteMaterial({ map: BLANK, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
            sp.visible = false; sp.renderOrder = 12; scene.add(sp);
            this.pool.push({ sp, t: 0, vy: 0, w: 0, h: 0 });
        }
        this.k = 0;
    }
    show(text, x, y, z, color, size) {
        const p = this.pool[this.k]; this.k = (this.k + 1) % this.pool.length;
        const key = 'dn|' + text + '|' + color;
        const map = sharedTex(key, () => textCanvas([{ t: text, c: color, s: '#10203a', px: 80 }], 256));
        if (p.sp.material.map !== map) { p.sp.material.map = map; p.sp.material.needsUpdate = true; }
        p.w = size || 3; p.h = p.w * map.image.height / map.image.width;
        p.sp.position.set(x + (Math.random() - 0.5) * 1.5, y, z + (Math.random() - 0.5) * 1.5);
        p.sp.visible = true; p.t = 0; p.vy = 6 + Math.random() * 3;
    }
    update(dt) {
        for (const p of this.pool) {
            if (!p.sp.visible) continue;
            p.t += dt;
            if (p.t > 0.8) { p.sp.visible = false; continue; }
            p.sp.position.y += p.vy * dt; p.vy *= Math.exp(-dt * 3);
            const pop = p.t < 0.08 ? 0.5 + p.t / 0.08 * 0.75 : p.t < 0.16 ? 1.25 - (p.t - 0.08) / 0.08 * 0.25 : 1;
            p.sp.scale.set(p.w * pop, p.h * pop, 1);
            p.sp.material.opacity = Math.min(1, (0.8 - p.t) * 4);
        }
    }
}
export const dmgNums = new DmgNums();

// Every shader here, for the loading warm-up
export function cubeWarmGroup() {
    const g = new T.Group();
    for (const m of [cube.mesh, drops.mesh, shards.mesh, balls.mesh]) {
        const was = m.count;
        void was;
    }
    return g;
}
// Things a frame needs before it's drawn
export function flushCube(now) {
    U.uTime.value = now;
    if (U.uBuild.value < 99) U.uBuild.value += 0;
    cube.flush(); shards.flush(); balls.flush();
}
export { bounceTarget, CFG };
