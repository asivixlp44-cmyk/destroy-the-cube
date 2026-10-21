// The cube: n x n x n blocks of CFG.block studs, standing on the ground in the middle of the arena
// (x and z from -n*B/2 to n*B/2, y from 0 to n*B). Generated from (level, seed) the same way on the
// server and every client, so only the seed and what's been broken ever travel over the network.
// Cell index c = x + n * (z + n * y): each horizontal layer is one contiguous run.
import { CFG, CUBES, TIER_HP, TIER_VAL, KINDS, cubeTier, rngFrom } from './config.js';

export const B = CFG.block;

export class CubeGrid {
    constructor(level, seed) {
        const def = CUBES[level];
        this.level = level;
        this.seed = seed >>> 0;
        this.def = def;
        const n = (this.n = def.n);
        const N = (this.N = n * n * n);
        this.half = (n * B) / 2;
        this.x0 = -this.half;
        this.z0 = -this.half;
        this.top = n * B;
        this.tier = new Uint8Array(N);
        this.kind = new Uint8Array(N);
        this.depth = new Uint8Array(N);
        this.hp = new Int32Array(N);
        this.maxHp = new Int32Array(N);
        const rnd = rngFrom(this.seed * 2654435761 + level * 977 + 13);
        const o = def.odds, a = o.rainbow, b = a + o.gem, c2 = b + o.gold, d = c2 + o.tnt;
        for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
            const c = x + n * (z + n * y);
            const depth = Math.min(x, n - 1 - x, y, n - 1 - y, z, n - 1 - z);
            const t = cubeTier(level, depth);
            const r = rnd() * 1000;
            // no TNT in the bottom layer (it would dig the floor out from under everyone at once)
            const k = r < a ? 4 : r < b ? 2 : r < c2 ? 1 : r < d && y > 0 ? 3 : 0;
            this.depth[c] = depth;
            this.tier[c] = t;
            this.kind[c] = k;
            this.maxHp[c] = this.hp[c] = Math.round(TIER_HP[t] * KINDS[k].hp);
        }
        this.alive = N;
    }
    idx(x, y, z) { return x + this.n * (z + this.n * y); }
    cx(c) { return c % this.n; }
    cz(c) { return ((c / this.n) | 0) % this.n; }
    cy(c) { return (c / (this.n * this.n)) | 0; }
    // the centre of a block in world space
    wx(c) { return this.x0 + (this.cx(c) + 0.5) * B; }
    wy(c) { return (this.cy(c) + 0.5) * B; }
    wz(c) { return this.z0 + (this.cz(c) + 0.5) * B; }
    inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.n && y < this.n && z < this.n; }
    solid(x, y, z) { return this.inside(x, y, z) && this.hp[this.idx(x, y, z)] > 0; }
    // the block at a world position (-1 for none)
    cellAt(wx, wy, wz) {
        const x = Math.floor((wx - this.x0) / B), y = Math.floor(wy / B), z = Math.floor((wz - this.z0) / B);
        return this.inside(x, y, z) ? this.idx(x, y, z) : -1;
    }
    // what one dropped cube from this block sells for
    value(c) { return TIER_VAL[this.tier[c]] * KINDS[this.kind[c]].val; }
    // A block shows when any side is open air (the floor under the bottom layer doesn't count)
    exposed(c) {
        const n = this.n, x = this.cx(c), y = this.cy(c), z = this.cz(c), hp = this.hp;
        if (x === 0 || x === n - 1 || z === 0 || z === n - 1 || y === n - 1) return true;
        return hp[c - 1] <= 0 || hp[c + 1] <= 0 || hp[c - n] <= 0 || hp[c + n] <= 0 || hp[c + n * n] <= 0 || (y > 0 && hp[c - n * n] <= 0);
    }
    // The 6 neighbours of a block (that exist in the grid)
    neighbours(c, out) {
        const n = this.n, x = this.cx(c), y = this.cy(c), z = this.cz(c);
        out.length = 0;
        if (x > 0) out.push(c - 1);
        if (x < n - 1) out.push(c + 1);
        if (z > 0) out.push(c - n);
        if (z < n - 1) out.push(c + n);
        if (y > 0) out.push(c - n * n);
        if (y < n - 1) out.push(c + n * n);
        return out;
    }
    // Blocks whose centre lies within r studs of a point: [cell, distance] pairs
    sphere(px, py, pz, r, out) {
        out.length = 0;
        const n = this.n, lo = (v, o) => Math.max(0, Math.floor((v - r - o) / B)), hi = (v, o) => Math.min(n - 1, Math.floor((v + r - o) / B));
        const x0 = lo(px, this.x0), x1 = hi(px, this.x0), y0 = lo(py, 0), y1 = hi(py, 0), z0 = lo(pz, this.z0), z1 = hi(pz, this.z0);
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            const c = x + n * (z + n * y);
            if (this.hp[c] <= 0) continue;
            const dx = this.x0 + (x + 0.5) * B - px, dy = (y + 0.5) * B - py, dz = this.z0 + (z + 0.5) * B - pz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d <= r) out.push([c, d]);
        }
        return out;
    }
    // Blocks far apart in the grid by at most k cells in every direction
    near(a, b, k) {
        return Math.abs(this.cx(a) - this.cx(b)) <= k && Math.abs(this.cy(a) - this.cy(b)) <= k && Math.abs(this.cz(a) - this.cz(b)) <= k;
    }

    // Voxel ray cast (Amanatides & Woo): the first solid block along the ray within maxT studs.
    // Returns { c, t, nx, ny, nz } (t: distance; n: the face it went in through) or null.
    // skip(c): blocks to pass through (a piercing shot)
    raycast(ox, oy, oz, dx, dy, dz, maxT, skip) {
        const n = this.n, inv = (v) => (Math.abs(v) < 1e-9 ? 1e9 : 1 / v);
        // into grid units
        const gx = (ox - this.x0) / B, gy = oy / B, gz = (oz - this.z0) / B;
        const ix = inv(dx), iy = inv(dy), iz = inv(dz);
        // where the ray enters the grid's box (and through which side)
        let t0 = 0, t1 = maxT / B, axis = -1;
        const gs = [gx, gy, gz], is = [ix, iy, iz];
        for (let k = 0; k < 3; k++) {
            let a = (0 - gs[k]) * is[k], b = (n - gs[k]) * is[k];
            if (a > b) { const q = a; a = b; b = q; }
            if (a > t0) { t0 = a; axis = k; }
            t1 = Math.min(t1, b);
            if (t0 > t1) return null;
        }
        const px = gx + dx * t0, py = gy + dy * t0, pz = gz + dz * t0;
        let x = Math.min(n - 1, Math.max(0, Math.floor(px))), y = Math.min(n - 1, Math.max(0, Math.floor(py))), z = Math.min(n - 1, Math.max(0, Math.floor(pz)));
        const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        let tx = dx === 0 ? 1e9 : ((dx > 0 ? x + 1 : x) - px) * ix + t0;
        let ty = dy === 0 ? 1e9 : ((dy > 0 ? y + 1 : y) - py) * iy + t0;
        let tz = dz === 0 ? 1e9 : ((dz > 0 ? z + 1 : z) - pz) * iz + t0;
        const ddx = Math.abs(ix), ddy = Math.abs(iy), ddz = Math.abs(iz);
        let nx = axis === 0 ? -sx : 0, ny = axis === 1 ? -sy : 0, nz = axis === 2 ? -sz : 0;
        let t = t0;
        for (let i = 0; i < n * 3 + 3; i++) {
            if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n || t > t1 + 1e-6) return null;
            const c = x + n * (z + n * y);
            if (this.hp[c] > 0 && !(skip && skip(c))) return { c, t: t * B, nx, ny, nz };
            if (tx < ty && tx < tz) { t = tx; tx += ddx; x += sx; nx = -sx; ny = 0; nz = 0; }
            else if (ty < tz) { t = ty; ty += ddy; y += sy; nx = 0; ny = -sy; nz = 0; }
            else { t = tz; tz += ddz; z += sz; nx = 0; ny = 0; nz = -sz; }
        }
        return null;
    }
}

// The next block a bouncing ball jumps to: one of the nearest standing, open-air blocks within
// CFG.bounceReach of the last one, not hit yet this shot (rnd picks among the closest few)
const nb = [];
export function bounceTarget(grid, from, hit, rnd) {
    const n = grid.n, R = CFG.bounceReach;
    const fx = grid.cx(from), fy = grid.cy(from), fz = grid.cz(from);
    nb.length = 0;
    for (let y = Math.max(0, fy - R); y <= Math.min(n - 1, fy + R); y++)
        for (let z = Math.max(0, fz - R); z <= Math.min(n - 1, fz + R); z++)
            for (let x = Math.max(0, fx - R); x <= Math.min(n - 1, fx + R); x++) {
                const c = x + n * (z + n * y);
                if (grid.hp[c] <= 0 || hit.includes(c) || !grid.exposed(c)) continue;
                const d = (x - fx) ** 2 + (y - fy) ** 2 * 1.4 + (z - fz) ** 2;
                nb.push([c, d]);
            }
    if (!nb.length) return -1;
    nb.sort((a, b) => a[1] - b[1]);
    return nb[Math.floor((rnd ? rnd() : Math.random()) * Math.min(4, nb.length))][0];
}
