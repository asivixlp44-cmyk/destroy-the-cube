import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, saveSoon, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, CUBES, LEVELS, TIER_HP, TNT_RADIUS, TNT_DAMAGE, UPGRADES, upgradeById, upLevel, upCost, GUNS, gunById, AMMO, ammoById,
    PASSES, BOOSTS, skinById, TUTORIAL, TUTORIAL_GEMS, questAt, GIFTS, DAILY, CODES, dailyStatus, dayKey, rewardText, coinScale,
    stats, coinMult, SPAWN, SELL, KITS, SKINS, clamp, fmt, levelOpen,
} from '../../shared/config.js';
import { CubeGrid, B } from '../../shared/cube.js';
import { LOBBY } from '../../shared/arena.js';

const GREEN = '#7dff6b', GOLD = '#ffd028', BLUE = '#6fe0ff', PINK = '#ff7ad8';
const AMMO_IDX = { normal: 0, bouncy: 1, boom: 2 };

function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const near2 = (a, x, z) => (a.x - x) ** 2 + (a.z - z) ** 2;
const sph = [];

export const liveRooms = new Set();

// One cube, shared by up to 8 players (rooms are matched by cube level: everyone in a room plays
// the same cube). Movement is client-side; every hit, pickup, sale and purchase is checked here.
// The cube itself lives here as a CubeGrid: hits come in as the chain of blocks one ball touched
// (the first block, then each bounce), the room takes the hit points off, breaks blocks, sets off
// TNT and explosions, and sends what changed to everyone in small batches.
export class CubeRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate(options) {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;
        // level -1: the lobby (no cube, more players); else the cube of that level
        this.isLobby = !!options && (options.level === -1 || options.level === '-1');
        this.state.lobby = this.isLobby;
        this.state.level = this.isLobby ? 0 : clamp((options && options.level) | 0, 0, LEVELS - 1);
        if (this.isLobby) this.maxClients = CFG.lobbyPlayers;
        this.setMetadata({ level: this.isLobby ? -1 : this.state.level }).catch(() => {});
        this.pending = { b: [], h: new Map(), sh: [], x: [], f: [] };
        this.tnt = [];
        this.support = null;
        if (!this.isLobby) this.build();

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('hit', this.onHit);
        on('pick', this.onPick);
        on('sell', this.onSell);
        on('up', this.onUpgrade);
        on('gun', this.onGun);
        on('ammo', this.onAmmo);
        on('pass', this.onPass);
        on('boost', this.onBoost);
        on('ball', this.onBall);
        on('daily', this.onDaily);
        on('gift', this.onGift);
        on('code', this.onCode);
        on('meta', this.onMeta);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);

        this.setSimulationInterval((ms) => this.update(ms), 50);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.secAcc = 0;
    }

    // A fresh cube (a new random layout of gold, gems and TNT every time)
    build() {
        const st = this.state;
        if (this.isLobby) return;
        this.grid = new CubeGrid(st.level, (Math.random() * 4294967295) >>> 0);
        st.seed = this.grid.seed;
        st.gen = (st.gen + 1) % 65536;
        st.phase = 0;
        st.total = this.grid.N;
        st.left = this.grid.N;
        st.startAt = Date.now();
        st.nextAt = 0;
        this.pending.b.length = 0; this.pending.h.clear(); this.pending.x.length = 0;
        this.tnt.length = 0;
        if (this.sessions) for (const s of this.sessions.values()) { s.drops.clear(); s.contrib = 0; }
    }
    // The whole cube for a player who just arrived: which blocks are gone (a bitmask) and the hit
    // points of the damaged ones
    cubeMsg() {
        if (this.isLobby) return { lobby: true };
        const g = this.grid, dead = new Uint8Array(Math.ceil(g.N / 8)), dmg = [];
        for (let c = 0; c < g.N; c++) {
            if (g.hp[c] <= 0) dead[c >> 3] |= 1 << (c & 7);
            else if (g.hp[c] < g.maxHp[c]) dmg.push(c, g.hp[c]);
        }
        const st = this.state;
        return { level: st.level, seed: st.seed, gen: st.gen, phase: st.phase, dead: Buffer.from(dead).toString('base64'), dmg };
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        const player = new PlayerState();
        player.name = profile.name;
        player.pid = this.freePid();
        player.av = cleanAvatar(options.av);
        const sp = this.isLobby ? LOBBY.spawn : SPAWN;
        player.x = sp.x + (Math.random() - 0.5) * 8; player.y = 0; player.z = sp.z; player.ry = SPAWN.yaw;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        const s = {
            id: client.sessionId, client, profile, player, pid: player.pid,
            pos: { x: player.x, y: player.y, z: player.z }, drops: new Map(), contrib: 0,
            tokens: 4, tokT: Date.now(), joinedAt: Date.now(), giftClaimed: {}, friends: 0, guest, lastChat: 0, lastSell: 0,
            playSecs: 0, dirtyAt: 0, sealAt: 0,
            stats: { fresh: Date.now() - (profile.firstPlay || 0) < 60000, blocks: 0, sells: 0, ups: 0, destroyed: 0, coins0: profile.totalCoins, gems0: profile.gems, buys: 0, touch: false, fps: 0, level: this.state.level, unlocked0: profile.unlocked },
        };
        this.sessions.set(client.sessionId, s);
        if (!this.isLobby && levelOpen(profile, this.state.level)) profile.level = this.state.level;
        this.syncPublic(s);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_'), level: this.isLobby ? -1 : this.state.level });
        client.send('cube', this.cubeMsg());
        this.sendProfile(s, true);
        this.broadcastBoards(client);
        // a cube this player hasn't opened yet (an old link, a new device): off to their best one
        if (!this.isLobby && !levelOpen(profile, this.state.level)) client.send('goLevel', { level: profile.unlocked || 0 });
    }
    freePid() {
        const used = new Set([...this.state.players.values()].map((p) => p.pid));
        for (let i = 1; i < 255; i++) if (!used.has(i)) return i;
        return 255;
    }

    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['coins', 'totalCoins', 'gems', 'wins', 'blocks', 'playtime']) if (!finite(p[k])) p[k] = 0;
        p.coins = Math.max(0, Math.floor(p.coins));
        p.gems = Math.max(0, Math.floor(p.gems));
        p.unlocked = clamp(Math.floor(finite(p.unlocked) ? p.unlocked : 0), 0, LEVELS - 1);
        p.level = clamp(Math.floor(finite(p.level) ? p.level : 0), 0, p.unlocked);
        for (const k of ['best', 'clears', 'up', 'guns', 'ammoOwned', 'balls', 'passes', 'boosts', 'daily', 'codes']) p[k] = obj(p[k]);
        for (const u of UPGRADES) p.up[u.id] = clamp(Math.floor(finite(p.up[u.id]) ? p.up[u.id] : 0), 0, u.v.length - 1);
        for (const k of Object.keys(p.up)) if (!upgradeById[k]) delete p.up[k];
        p.guns.blaster = true;
        if (!gunById[p.gun] || !p.guns[p.gun]) p.gun = 'blaster';
        p.ammoOwned.normal = true;
        p.ammo = obj(p.ammo);
        for (const a of AMMO) if (a.id !== 'normal') p.ammo[a.id] = clamp(finite(p.ammo[a.id]) ? p.ammo[a.id] : 0, 0, a.max);
        if (!finite(p.ammo.at)) p.ammo.at = Date.now();
        p.balls.bubble = true;
        if (!skinById[p.ball] || !p.balls[p.ball]) p.ball = 'bubble';
        p.bag = obj(p.bag);
        p.bag.n = Math.max(0, Math.floor(finite(p.bag.n) ? p.bag.n : 0));
        p.bag.v = Math.max(0, finite(p.bag.v) ? p.bag.v : 0);
        p.q = obj(p.q);
        for (const k of ['tut', 'pt', 'a', 'pa', 'b', 'pb']) p.q[k] = Math.max(0, Math.floor(finite(p.q[k]) ? p.q[k] : 0));
        p.q.tut = Math.min(p.q.tut, TUTORIAL.length);
    }

    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_'), level: this.state.level });
        client.send('cube', this.cubeMsg());
        this.sendProfile(s, true);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (!s) return;
        const st = s.stats, p = s.profile;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, touch: st.touch, fps: st.fps,
            level: st.level, unlocked0: st.unlocked0, unlocked: p.unlocked, blocks: st.blocks, sells: st.sells, ups: st.ups, destroyed: st.destroyed,
            coins: (p.totalCoins || 0) - (st.coins0 || 0), buys: st.buys, tut: p.q.tut, gifts: Object.keys(s.giftClaimed).length,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(p.uid)) releaseProfile(p.uid, isOnline);
    }

    onDispose() { liveRooms.delete(this); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(s) {
        const p = s.profile, pl = s.player;
        pl.gun = p.gun || 'blaster';
        pl.ball = p.ball || 'bubble';
        pl.wins = Math.min(4294967295, p.wins || 0);
        pl.name = p.name;
    }
    // The player's private progress. Hits change it many times a second, so it goes out at most
    // four times a second (dirty()), straight away for anything the player clicked on.
    sendProfile(s, seal) {
        const p = s.profile;
        s.dirtyAt = 0;
        const now = Date.now();
        const m = {
            coins: p.coins, totalCoins: p.totalCoins, gems: p.gems, wins: p.wins, blocks: p.blocks, playtime: p.playtime,
            level: p.level, unlocked: p.unlocked, best: p.best, clears: p.clears, up: p.up, guns: p.guns, gun: p.gun,
            ammoOwned: p.ammoOwned, ammo: p.ammo, balls: p.balls, ball: p.ball, passes: p.passes, boosts: p.boosts,
            bag: p.bag, q: p.q, daily: p.daily, codes: p.codes, firstPlay: p.firstPlay,
            giftClaimed: s.giftClaimed, sessionSecs: s.playSecs, now,
        };
        if (seal || now - s.sealAt > 10000) { s.sealAt = now; m.save = sealProfile(p); }
        s.client.send('profile', m);
    }
    dirty(s) { if (!s.dirtyAt) s.dirtyAt = Date.now(); markDirty(); }
    changed(s) { this.syncPublic(s); this.sendProfile(s); saveSoon(); }
    toast(s, text, color) { s.client.send('toast', { text, color: color || '#ffffff' }); }
    mult(s) { return coinMult(s.profile, Date.now(), s.friends); }
    addCoins(s, n) {
        s.profile.coins += n;
        s.profile.totalCoins += n;
        this.bump(s, 'coins', n);
    }

    // ----- quests: the tutorial, then two lines of quests paying Gems -----
    bump(s, kind, n) {
        if (!n) return;
        const p = s.profile, q = p.q;
        if (q.tut < TUTORIAL.length) {
            const step = TUTORIAL[q.tut];
            if (step.kind !== kind) return;
            q.pt += n;
            if (q.pt >= step.n) {
                q.tut++; q.pt = 0;
                const done = q.tut >= TUTORIAL.length;
                if (done) p.gems += TUTORIAL_GEMS;
                s.client.send('quest', { tut: q.tut - 1, done, gems: done ? TUTORIAL_GEMS : 0 });
                this.sendProfile(s);
            }
            return;
        }
        for (const line of ['a', 'b']) {
            const Q = questAt(line === 'b' ? 1 : 0, q[line]);
            if (Q.kind !== kind) continue;
            q['p' + line] += n;
            if (q['p' + line] >= Q.n) {
                q['p' + line] = 0; q[line]++;
                p.gems += Q.gems;
                s.client.send('quest', { line, kind: Q.kind, n: Q.n, gems: Q.gems });
                this.sendProfile(s);
            }
        }
    }

    // ----- 20 times a second: what changed on the cube goes out in one batch -----
    update(ms) {
        const now = Date.now();
        this.secAcc += (ms || 50) / 1000;
        if (this.secAcc >= 1) { this.secAcc -= 1; this.tick(); }
        const P = this.pending;
        // blocks broke this tick: does everything still stand on something?
        if (this.support && this.state.phase === 0) { const s = this.sessions.get(this.support) || null; this.support = null; this.collapse(s); this.checkDone(); }
        if (P.b.length || P.h.size || P.x.length || P.sh.length || P.f.length) {
            const h = [];
            for (const [c, hp] of P.h) h.push(c, hp);
            this.broadcast('cb', { g: this.state.gen, b: P.b, h, x: P.x, sh: P.sh, f: P.f });
            P.b = []; P.h.clear(); P.x = []; P.sh = []; P.f = [];
        }
        for (const s of this.sessions.values()) if (s.dirtyAt && now - s.dirtyAt > 250) this.sendProfile(s);
    }
    // Every second: playtime
    tick() {
        for (const s of this.sessions.values()) {
            s.profile.playtime = (s.profile.playtime || 0) + 1;
            s.playSecs++;
        }
        markDirty();
    }

    // ----- movement -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, -4000, 4000); pl.y = clamp(m.y, -100, 400); pl.z = clamp(m.z, -4000, 4000);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.ap = finite(m.ap) ? clamp(m.ap, -1.6, 1.6) : 0;
        pl.anim = clamp(m.a | 0, 0, 2);
        s.pos = { x: pl.x, y: pl.y, z: pl.z };
    }

    // ----- shooting -----
    // m: { g: the cube's gen, c: [first block, then each block it bounced / punched on to], a: ammo, o: [x, y, z] muzzle }
    onHit(client, m) {
        const s = this.sessions.get(client.sessionId);
        const st = this.state, g = this.grid;
        if (!s || this.isLobby || st.phase !== 0 || (m.g | 0) !== st.gen || !Array.isArray(m.c) || !m.c.length) return;
        const p = s.profile, now = Date.now(), my = stats(p, now);
        // the fire rate: a small bucket of shots that refills at the blaster's rate (with slack for lag)
        const per = my.cd / my.gun.pellets;
        s.tokens = Math.min(5 + my.gun.pellets, s.tokens + (now - s.tokT) / 1000 / per * 1.3);
        s.tokT = now;
        if (s.tokens < 1) return;
        s.tokens -= 1;
        let ammo = typeof m.a === 'string' && AMMO_IDX[m.a] ? m.a : 'normal';
        if (ammo !== 'normal') {
            this.regenAmmo(p, now);
            if (!p.ammoOwned[ammo] || p.ammo[ammo] < 1) ammo = 'normal';
            else p.ammo[ammo] -= 1;
        }
        const chain = 1 + my.bounces + (ammo === 'bouncy' ? ammoById.bouncy.bounces : 0) + (my.gun.pierce || 0);
        const cells = m.c.slice(0, chain).map((v) => v | 0);
        const first = cells[0];
        if (first < 0 || first >= g.N) return;
        const dx = g.wx(first) - s.pos.x, dy = g.wy(first) - (s.pos.y + 4), dz = g.wz(first) - s.pos.z;
        if (dx * dx + dy * dy + dz * dz > (CFG.range + 30) ** 2) return;
        // the shot, for everyone else to see
        const o = Array.isArray(m.o) ? m.o : null;
        if (o && finite(o[0]) && finite(o[1]) && finite(o[2])) this.pending.sh.push(s.pid, Math.round(o[0] * 10) / 10, Math.round(o[1] * 10) / 10, Math.round(o[2] * 10) / 10, first, AMMO_IDX[ammo]);
        let prev = -1;
        for (const c of cells) {
            if (c < 0 || c >= g.N) break;
            if (prev >= 0 && !g.near(prev, c, CFG.bounceReach)) break;
            prev = c;
            this.damage(s, c, my.dmg);
        }
        const blast = Math.max(ammo === 'boom' ? my.blast : 0, my.gun.blast || 0);
        if (blast) this.explode(s, g.wx(first), g.wy(first), g.wz(first), blast, my.dmg, first);
        this.runTnt(s);
        if (ammo !== 'normal') this.dirty(s);
        this.checkDone();
    }
    regenAmmo(p, now) {
        const dt = Math.max(0, (now - (p.ammo.at || now)) / 1000);
        for (const a of AMMO) if (a.id !== 'normal' && p.ammoOwned[a.id]) p.ammo[a.id] = Math.min(a.max, (p.ammo[a.id] || 0) + dt / a.regen);
        p.ammo.at = now;
    }
    damage(s, c, dmg) {
        const g = this.grid;
        if (g.hp[c] <= 0) return false;
        g.hp[c] -= dmg;
        if (g.hp[c] > 0) { this.pending.h.set(c, g.hp[c]); return false; }
        this.breakBlock(s, c, true);
        return true;
    }
    // Blocks within r studs take up to dmg (half at the edge)
    explode(s, x, y, z, r, dmg, skip) {
        this.pending.x.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10, r);
        const list = this.grid.sphere(x, y, z, r, sph).slice();
        for (const [c, d] of list) if (c !== skip) this.damage(s, c, Math.max(1, Math.round(dmg * (1 - 0.5 * d / r))));
    }
    // TNT that broke goes off (and can set off more TNT)
    runTnt(s) {
        const g = this.grid;
        for (let k = 0; k < 40 && this.tnt.length; k++) {
            const c = this.tnt.shift();
            this.explode(s, g.wx(c), g.wy(c), g.wz(c), TNT_RADIUS * B, TNT_DAMAGE * TIER_HP[g.tier[c]], c);
        }
        this.tnt.length = 0;
    }
    breakBlock(s, c, drop, fall) {
        const g = this.grid, st = this.state;
        g.hp[c] = 0;
        st.left = Math.max(0, st.left - 1);
        this.pending.h.delete(c);
        (fall ? this.pending.f : this.pending.b).push(c, s ? s.pid : 0);
        if (s && st.phase === 0 && !fall) this.support = s.id;
        const kind = g.kind[c];
        if (kind === 3 && !fall) this.tnt.push(c);
        if (!s || !drop) return;
        const p = s.profile;
        s.drops.set(c, g.value(c) * (p.passes.LuckyBlocks ? 1.5 : 1));
        s.contrib++;
        p.blocks = (p.blocks || 0) + 1;
        s.stats.blocks++;
        this.bump(s, 'break', 1);
        if (g.depth[c] >= 2) this.bump(s, 'tier', 1);
        if (kind === 1) this.bump(s, 'gold', 1);
        if (kind === 3) this.bump(s, 'tnt', 1);
        if (kind === 2) { p.gems += 1; s.client.send('gem', { c }); }
        this.dirty(s);
    }
    // Blocks that lost their way down to the ground (through other blocks, side by side) fall and
    // shatter: a flood fill from the bottom layer finds everything still held up. The player whose
    // break cut them loose gets their cubes.
    collapse(s) {
        const g = this.grid, n = g.n, N = g.N, hp = g.hp;
        if (!this.seen || this.seen.length !== N) { this.seen = new Uint8Array(N); this.queue = new Int32Array(N); }
        const seen = this.seen, q = this.queue;
        seen.fill(0);
        let head = 0, tail = 0;
        for (let c = 0; c < n * n; c++) if (hp[c] > 0) { seen[c] = 1; q[tail++] = c; }
        while (head < tail) {
            const c = q[head++], x = c % n, z = ((c / n) | 0) % n, y = (c / (n * n)) | 0;
            if (x > 0 && !seen[c - 1] && hp[c - 1] > 0) { seen[c - 1] = 1; q[tail++] = c - 1; }
            if (x < n - 1 && !seen[c + 1] && hp[c + 1] > 0) { seen[c + 1] = 1; q[tail++] = c + 1; }
            if (z > 0 && !seen[c - n] && hp[c - n] > 0) { seen[c - n] = 1; q[tail++] = c - n; }
            if (z < n - 1 && !seen[c + n] && hp[c + n] > 0) { seen[c + n] = 1; q[tail++] = c + n; }
            if (y < n - 1 && !seen[c + n * n] && hp[c + n * n] > 0) { seen[c + n * n] = 1; q[tail++] = c + n * n; }
            if (y > 0 && !seen[c - n * n] && hp[c - n * n] > 0) { seen[c - n * n] = 1; q[tail++] = c - n * n; }
        }
        // each loose piece: small ones fall (chips, overhangs, a corner cut off); a big body that lost
        // its footing stays put, so cutting one layer can't drop the whole cube at once
        const cap = Math.max(40, Math.floor(N * CFG.fallShare));
        let fell = 0;
        for (let c0 = n * n; c0 < N; c0++) {
            if (hp[c0] <= 0 || seen[c0]) continue;
            let h2 = 0, t2 = 0;
            seen[c0] = 2; q[t2++] = c0;
            while (h2 < t2) {
                const c = q[h2++], x = c % n, z = ((c / n) | 0) % n, y = (c / (n * n)) | 0;
                const nb = [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, z > 0 ? c - n : -1, z < n - 1 ? c + n : -1, y < n - 1 ? c + n * n : -1, y > 0 ? c - n * n : -1];
                for (const k of nb) if (k >= 0 && !seen[k] && hp[k] > 0) { seen[k] = 2; q[t2++] = k; }
            }
            if (t2 > cap) continue;
            for (let i = 0; i < t2; i++) this.breakBlock(s, q[i], true, true);
            fell += t2;
        }
        return fell;
    }
    // The last few blocks crumble on their own, then the party, then a new cube
    checkDone() {
        const st = this.state, g = this.grid;
        if (this.isLobby || st.phase !== 0 || st.left > Math.max(2, Math.floor(st.total * CFG.finishShare))) return;
        for (let c = 0; c < g.N; c++) if (g.hp[c] > 0) this.breakBlock(null, c, false);
        st.left = 0;
        st.phase = 1;
        const now = Date.now(), secs = Math.max(1, Math.round((now - st.startAt) / 1000));
        st.nextAt = now + CFG.rebuildSecs * 1000;
        const L = st.level, def = CUBES[L];
        const list = [...this.sessions.values()];
        const mvp = list.reduce((a, b) => (b.contrib > (a ? a.contrib : 0) ? b : a), null);
        for (const s of list) {
            const p = s.profile;
            if (!s.contrib) { s.client.send('destroyed', { level: L, secs, helped: false, mvp: mvp ? mvp.profile.name : '' }); continue; }
            const first = !(p.clears[L] > 0);
            const coins = def.clear.coins * (first ? 2 : 1), gems = def.clear.gems * (first ? 2 : 1);
            p.gems += gems;
            this.addCoins(s, coins);
            p.wins = (p.wins || 0) + 1;
            p.clears[L] = (p.clears[L] || 0) + 1;
            p.best[L] = p.best[L] ? Math.min(p.best[L], secs) : secs;
            let opened = -1;
            if (L + 1 < LEVELS && p.unlocked <= L) { p.unlocked = L + 1; opened = L + 1; }
            // the cubes still lying around are sold for you, at half price
            let left = 0;
            for (const v of s.drops.values()) left += v;
            s.drops.clear();
            const leftover = left ? Math.max(1, Math.round(left * 0.5 * this.mult(s))) : 0;
            if (leftover) this.addCoins(s, leftover);
            s.stats.destroyed++;
            this.bump(s, 'destroy', 1);
            s.client.send('destroyed', {
                level: L, secs, best: p.best[L], coins, gems, first, opened, next: p.unlocked > L ? L + 1 : -1, leftover,
                blocks: s.contrib, helped: true, mvp: mvp ? mvp.profile.name : '', share: Math.round((s.contrib / Math.max(1, st.total)) * 100),
            });
            this.changed(s);
        }
        this.broadcastBoards();
        this.clock.setTimeout(() => { this.build(); this.broadcast('cube', this.cubeMsg()); }, CFG.rebuildSecs * 1000);
    }

    // ----- picking up dropped cubes (each is the block it came from, this cube only) -----
    onPick(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || this.isLobby || (m.g | 0) !== this.state.gen || !Array.isArray(m.ids)) return;
        const p = s.profile, g = this.grid, my = stats(p, Date.now()), instant = !!p.passes.InstantSell;
        let got = 0, full = false, value = 0;
        for (const raw of m.ids.slice(0, 600)) {
            const c = raw | 0, v = s.drops.get(c);
            if (v === undefined) continue;
            if (near2(s.pos, g.wx(c), g.wz(c)) > (my.range + 34) ** 2) continue;
            if (!instant && p.bag.n >= my.inv) { full = true; break; }
            s.drops.delete(c);
            if (instant) value += v; else { p.bag.n++; p.bag.v += v; }
            got++;
        }
        if (instant && got) {
            const coins = Math.max(1, Math.round(value * this.mult(s)));
            this.addCoins(s, coins);
            this.bump(s, 'sell', got);
            s.stats.sells += got;
            client.send('sold', { n: got, coins, instant: true });
        }
        if (got) this.bump(s, 'collect', got);
        client.send('bag', { n: p.bag.n, v: p.bag.v, full, got });
        this.dirty(s);
    }
    // ----- the sell machine -----
    onSell(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (near2(s.pos, SELL.x, SELL.z) > (CFG.sellReach + 8) ** 2 || p.bag.n <= 0) return;
        const n = p.bag.n, coins = Math.max(1, Math.round(p.bag.v * this.mult(s)));
        p.bag = { n: 0, v: 0 };
        this.addCoins(s, coins);
        this.bump(s, 'sell', n);
        s.stats.sells += n;
        client.send('sold', { n, coins });
        this.changed(s);
    }

    // ----- the upgrade computer -----
    onUpgrade(client, m) {
        const s = this.sessions.get(client.sessionId);
        const u = upgradeById[m.id];
        if (!s || !u) return;
        const p = s.profile, cost = upCost(p, u.id);
        if (cost === null) return this.toast(s, u.ic + ' ' + u.name + ' is maxed out!', BLUE);
        if (p.coins < cost) return client.send('broke', { need: cost - p.coins, price: cost, name: u.name, cur: 'coins' });
        p.coins -= cost;
        p.up[u.id] = upLevel(p, u.id) + 1;
        s.stats.ups++; s.stats.buys++;
        this.bump(s, 'upgrade', 1);
        client.send('upgraded', { id: u.id, lv: p.up[u.id] });
        this.changed(s);
    }
    // ----- blasters (Coins or Gems) -----
    onGun(client, m) {
        const s = this.sessions.get(client.sessionId);
        const gun = gunById[m.id];
        if (!s || !gun) return;
        const p = s.profile;
        if (!p.guns[gun.id]) {
            if (gun.gems) {
                if (p.gems < gun.gems) return client.send('broke', { need: gun.gems - p.gems, price: gun.gems, name: gun.name, cur: 'gems' });
                p.gems -= gun.gems;
            } else {
                if (p.coins < gun.price) return client.send('broke', { need: gun.price - p.coins, price: gun.price, name: gun.name, cur: 'coins' });
                p.coins -= gun.price;
            }
            p.guns[gun.id] = true;
            s.stats.buys++;
            client.send('fx', { kind: 'unlock', what: 'gun', id: gun.id });
            this.toast(s, gun.ic + ' ' + gun.name + ' unlocked!', GREEN);
        }
        p.gun = gun.id;
        this.changed(s);
    }
    // ----- ammo types (unlocked once with Coins, then they refill by themselves) -----
    onAmmo(client, m) {
        const s = this.sessions.get(client.sessionId);
        const a = ammoById[m.id];
        if (!s || !a || a.id === 'normal') return;
        const p = s.profile;
        if (p.ammoOwned[a.id]) return;
        if (p.coins < a.price) return client.send('broke', { need: a.price - p.coins, price: a.price, name: a.name, cur: 'coins' });
        p.coins -= a.price;
        this.regenAmmo(p, Date.now());
        p.ammoOwned[a.id] = true;
        p.ammo[a.id] = a.max;
        s.stats.buys++;
        client.send('fx', { kind: 'unlock', what: 'ammo', id: a.id });
        this.toast(s, a.ic + ' ' + a.name + ' unlocked! Pick them on the hotbar', GREEN);
        this.changed(s);
    }
    // ----- Gem passes and boosts -----
    onPass(client, m) {
        const s = this.sessions.get(client.sessionId);
        const key = String(m.id || ''), pass = PASSES[key];
        if (!s || !pass) return;
        const p = s.profile;
        if (p.passes[key]) return this.toast(s, pass.name + ' already owned!', BLUE);
        if (p.gems < pass.gems) return client.send('broke', { need: pass.gems - p.gems, price: pass.gems, name: pass.name, cur: 'gems' });
        p.gems -= pass.gems;
        p.passes[key] = true;
        s.stats.buys++;
        client.send('fx', { kind: 'unlock', what: 'pass', id: key });
        this.toast(s, pass.ic + ' ' + pass.name + ' unlocked!', GREEN);
        this.changed(s);
    }
    onBoost(client, m) {
        const s = this.sessions.get(client.sessionId);
        const key = String(m.id || ''), b = BOOSTS[key];
        if (!s || !b) return;
        const p = s.profile;
        if (p.gems < b.gems) return client.send('broke', { need: b.gems - p.gems, price: b.gems, name: b.name, cur: 'gems' });
        p.gems -= b.gems;
        this.giveBoost(p, key);
        s.stats.buys++;
        client.send('fx', { kind: 'boost', id: key });
        this.toast(s, b.ic + ' ' + b.name + ' for ' + b.mins + ' minutes!', GOLD);
        this.changed(s);
    }
    giveBoost(p, key) {
        const now = Date.now();
        p.boosts[key] = Math.max(now, p.boosts[key] || 0) + BOOSTS[key].mins * 60000;
    }
    // ----- ball skins (Coins) -----
    onBall(client, m) {
        const s = this.sessions.get(client.sessionId);
        const d = skinById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        if (!p.balls[d.id]) {
            if (p.coins < d.price) return client.send('broke', { need: d.price - p.coins, price: d.price, name: d.name + ' balls', cur: 'coins' });
            p.coins -= d.price;
            p.balls[d.id] = true;
            s.stats.buys++;
            this.toast(s, d.name + ' balls unlocked!', GREEN);
        }
        p.ball = d.id;
        this.changed(s);
    }

    // ----- rewards -----
    giveReward(s, r) {
        const p = s.profile;
        if (r.coins) this.addCoins(s, r.coins * coinScale(p));
        if (r.gems) p.gems += r.gems;
        if (r.boost) this.giveBoost(p, r.boost);
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.toast(s, 'Day ' + p.daily.streak + ' reward: ' + rewardText(r, p) + '!', GREEN);
        this.giveReward(s, r);
        client.send('fx', { kind: 'confetti' });
        this.changed(s);
    }
    onGift(client, m) {
        const s = this.sessions.get(client.sessionId);
        const k = m.k | 0, g = GIFTS[k];
        if (!s || !g || s.giftClaimed[k]) return;
        if (s.playSecs < g.min * 60 - 2) return this.toast(s, 'Keep playing to unlock this gift!', BLUE);
        s.giftClaimed[k] = true;
        this.toast(s, '🎁 ' + rewardText(g, s.profile) + '!', GREEN);
        this.giveReward(s, g);
        client.send('fx', { kind: 'confetti' });
        this.changed(s);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 24);
        const r = CODES[code];
        const p = s.profile;
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code' });
        if (p.codes[code]) return client.send('codeResult', { ok: false, text: 'Code already used' });
        p.codes[code] = true;
        client.send('codeResult', { ok: true, text: rewardText(r, p) + '!' });
        this.giveReward(s, r);
        this.changed(s);
    }
    // What the client tells us about itself, for the play stats
    onMeta(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        if (typeof m.touch === 'boolean') s.stats.touch = m.touch;
        if (finite(m.fps)) s.stats.fps = clamp(Math.round(m.fps), 0, 240);
    }

    broadcastBoards(client) {
        const row = (key) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const m = { wins: row('wins'), coins: row('totalCoins'), blocks: row('blocks') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(s);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
void GUNS; void fmt; void PINK;
