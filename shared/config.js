// Game data shared by the client and the Colyseus server.
// [ASMR] Destroy the Cube!: a giant cube of soft, squishy blocks stands in the middle of the arena.
// Blast it apart with your bubble blaster, collect the little cubes that drop, sell them at the base
// for Coins, upgrade your blaster on the upgrade computer and destroy the whole cube. Every cube you
// destroy unlocks a bigger, tougher one (ten in all). Quests pay Gems; Gems buy the best passes.
// There are no in-app purchases: every price is in Coins or Gems.

export const CFG = {
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs: one block)
    grav: 196.2,
    jumpV: 50,
    walk: 20,
    sprint: 1.45,             // Shift: x walk speed
    maxPlayers: 8,            // players sharing one cube
    lobbyPlayers: 24,         // players in one lobby
    block: 5,                 // studs per block
    friendBoost: 0.1,
    friendMax: 5,
    boostMinutes: 15,
    range: 160,               // how far the blaster reaches (studs)
    bounceReach: 3,           // a bouncing ball jumps to a block at most this many blocks away
    finishShare: 0.012,       // when this share of the cube is left, it collapses by itself
    highlightShare: 0.06,     // ...and the last blocks glow so you can find them
    fallShare: 0.05,          // a loose piece up to this share of the cube falls and shatters
    rebuildSecs: 9,           // the CUBE DESTROYED! party, then the cube builds itself again
    dropLifeSecs: 600,        // dropped cubes nobody picks up vanish after this long
    sellReach: 13,            // how close to the sell machine counts as "at" it
};

// ----- block tiers: hit points and what one dropped cube sells for -----
export const TIER_HP = [0, 10, 25, 62, 156, 390, 975, 2440, 6100, 15250, 38150, 95400, 238000, 596000];
export const TIER_VAL = [0, 1, 2, 3, 6, 10, 19, 34, 61, 110, 198, 357, 643, 1157];
export const TIER_NAMES = ['', 'Soft', 'Squishy', 'Bouncy', 'Crunchy', 'Glassy', 'Chunky', 'Steel', 'Crystal', 'Obsidian', 'Plasma', 'Cosmic', 'Mythic', 'Godly'];

// ----- special blocks (kinds) -----
// 0 a normal block, 1 GOLD (sells for 10x), 2 GEM (a Gem as well), 3 TNT (blows up its neighbours),
// 4 RAINBOW (sells for 50x). hp: x the tier's hit points.
export const KINDS = [
    { id: 'normal', name: 'Block', hp: 1, val: 1 },
    { id: 'gold', name: 'Gold Block', hp: 1.5, val: 10, color: 0xffd21e },
    { id: 'gem', name: 'Gem Block', hp: 2, val: 3, color: 0xd23cff },
    { id: 'tnt', name: 'TNT', hp: 1, val: 2, color: 0xff3a3a },
    { id: 'rainbow', name: 'Rainbow Block', hp: 3, val: 50, color: 0xffffff },
];
export const TNT_RADIUS = 1.75;   // blocks
export const TNT_DAMAGE = 5;      // x the tier's hit points

// ----- the cubes (levels) -----
// n: blocks per side. Shells from the outside in are tier L+1 (2 deep), L+2 (2 deep) and L+3 (the
// core). colors: the block colour of each shell (outer, middle, core), stripes on the inner ones
// like the reference's Tier 2 blocks. accent: two colours one block in ten wears (just the look). odds: special blocks per thousand. clear: Coins / Gems for
// destroying it (x2 the first time).
export const CUBES = [
    { name: 'Sky Cube', ic: '🟦', n: 10, colors: [0x5ab4f0, 0x3a7ee0, 0x2a4ec8], neon: 0x3ae0ff, accent: [0x6ae86a, 0x4ae8d8], mood: 'sky', odds: { gold: 55, gem: 6, tnt: 0, rainbow: 2 }, clear: { coins: 150, gems: 5 } },
    { name: 'Bubblegum Cube', ic: '🩷', n: 11, colors: [0xff8ac8, 0xf05aa8, 0xc83a8a], neon: 0xff6ad8, accent: [0x5ad8ff, 0xffd6ee], mood: 'candy', odds: { gold: 55, gem: 6, tnt: 12, rainbow: 2 }, clear: { coins: 400, gems: 6 } },
    { name: 'Lime Jelly Cube', ic: '🟩', n: 12, colors: [0x8aea4a, 0x4ac83a, 0x2a9a3a], neon: 0x9aff4a, accent: [0x5ad0ff, 0xff9ad0], mood: 'jelly', odds: { gold: 50, gem: 6, tnt: 14, rainbow: 2 }, clear: { coins: 1100, gems: 7 } },
    { name: 'Lava Cube', ic: '🟧', n: 13, colors: [0xff8a3a, 0xe84a2a, 0xa82a2a], neon: 0xff6a1a, accent: [0x4a3a40, 0xffb06a], mood: 'lava', odds: { gold: 50, gem: 6, tnt: 22, rainbow: 2 }, clear: { coins: 3000, gems: 8 } },
    { name: 'Frost Cube', ic: '🧊', n: 14, colors: [0xc8f0ff, 0x7ad0f8, 0x4a9ae8], neon: 0x8af0ff, accent: [0xffffff, 0xff9ad8], mood: 'frost', odds: { gold: 45, gem: 7, tnt: 16, rainbow: 3 }, clear: { coins: 8000, gems: 10 } },
    { name: 'Toxic Cube', ic: '☢️', n: 15, colors: [0xb8f03a, 0x8a3ae8, 0x5a1ab8], neon: 0xc8ff2a, accent: [0x2affb8, 0xff7ae0], mood: 'toxic', odds: { gold: 45, gem: 7, tnt: 22, rainbow: 3 }, clear: { coins: 22000, gems: 12 } },
    { name: 'Golden Cube', ic: '🟨', n: 16, colors: [0xffd84a, 0xf0a828, 0xc87a1a], neon: 0xffe24a, accent: [0xffffff, 0xff9a4a], mood: 'gold', odds: { gold: 80, gem: 8, tnt: 18, rainbow: 4 }, clear: { coins: 60000, gems: 14 } },
    { name: 'Galaxy Cube', ic: '🌌', n: 17, colors: [0x7a5aff, 0x4a2ac8, 0x2a1a7a], neon: 0xb88aff, accent: [0x5ae0ff, 0xff6ad8], mood: 'galaxy', odds: { gold: 45, gem: 9, tnt: 22, rainbow: 5 }, clear: { coins: 160000, gems: 17 } },
    { name: 'Rainbow Cube', ic: '🌈', n: 18, colors: [0xff5a7a, 0x5ad8ff, 0x8a5aff], neon: 0xffffff, mood: 'rainbow', odds: { gold: 50, gem: 10, tnt: 22, rainbow: 12 }, clear: { coins: 450000, gems: 20 }, rainbowShells: true },
    { name: 'MEGA CUBE', ic: '👑', n: 19, colors: [0x2a2a3a, 0xff3a5a, 0xffd21e], neon: 0xff3a5a, accent: [0x5ae0ff, 0x7dff6a], mood: 'mega', odds: { gold: 60, gem: 12, tnt: 28, rainbow: 8 }, clear: { coins: 1200000, gems: 30 } },
];
export const LEVELS = CUBES.length;
export const cubeTier = (level, depth) => level + 1 + (depth >= 4 ? 2 : depth >= 2 ? 1 : 0);
export const cubeBlocks = (level) => CUBES[level].n ** 3;
export const cubeHalf = (level) => CUBES[level].n * CFG.block / 2;
export const levelOpen = (p, i) => i === 0 || (p && (p.unlocked || 0) >= i);

// ----- permanent upgrades (the upgrade computer's skill tree), bought with Coins -----
// v: the value at each level; cost[k]: the price of going from level k to k + 1
export const UPGRADES = [
    { id: 'dmg', name: 'Damage', ic: '💥', unit: '', desc: 'Every ball hits harder',
        v: [10, 16, 25, 40, 60, 90, 140, 210, 320, 480, 720, 1100, 1650, 2500, 3700, 5600, 8400, 12600, 19000, 28500, 43000, 64000, 96000],
        cost: [25, 80, 200, 450, 1000, 2200, 4800, 10000, 21000, 45000, 95000, 200000, 420000, 880000, 1850000, 3900000, 8200000, 17000000, 36000000, 75000000, 160000000, 330000000] },
    { id: 'rate', name: 'Fire Rate', ic: '⚡', unit: 's', desc: 'Less time between shots',
        v: [0.25, 0.21, 0.18, 0.15, 0.13, 0.11, 0.095, 0.085],
        cost: [25, 300, 3500, 35000, 400000, 4500000, 50000000] },
    { id: 'bounce', name: 'Bounces', ic: '🏓', unit: '', desc: 'Each ball bounces on to more blocks',
        v: [1, 2, 3, 4, 5, 6],
        cost: [10, 500, 15000, 450000, 14000000] },
    { id: 'inv', name: 'Backpack', ic: '🎒', unit: '', desc: 'Carry more cubes before you sell',
        v: [10, 20, 50, 100, 200, 400, 800, 1500, 3000, 6000],
        cost: [10, 100, 600, 3000, 15000, 75000, 400000, 2000000, 10000000] },
    { id: 'range', name: 'Pickup Range', ic: '🧲', unit: ' studs', desc: 'Dropped cubes fly to you from further away',
        v: [10, 15, 20, 28, 36, 46],
        cost: [100, 1500, 25000, 400000, 6000000] },
    { id: 'blast', name: 'Explosion Size', ic: '💣', unit: ' studs', desc: 'Bigger blasts from Exploding Balls',
        v: [6, 8, 10, 13, 16],
        cost: [20000, 250000, 3000000, 40000000] },
];
export const upgradeById = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export const upLevel = (p, id) => Math.max(0, Math.min(upgradeById[id].v.length - 1, ((p && p.up) || {})[id] | 0));
export const upValue = (p, id) => upgradeById[id].v[upLevel(p, id)];
export const upCost = (p, id) => { const u = upgradeById[id], k = upLevel(p, id); return k < u.cost.length ? u.cost[k] : null; };

// ----- blasters: dmg / cd multiply the upgrades; pellets: balls per shot -----
export const GUNS = [
    { id: 'blaster', name: 'Bubble Blaster', ic: '🔫', price: 0, dmg: 1, cd: 1, pellets: 1, spread: 0, size: 0.55, speed: 230, look: { body: 0xf4f8ff, accent: 0x2ac8ff, tank: 0x7aff3a }, desc: 'The trusty starter blaster' },
    { id: 'twin', name: 'Twin Blaster', ic: '🔫', price: 2500, dmg: 0.8, cd: 0.62, pellets: 1, spread: 0, size: 0.55, speed: 240, look: { body: 0xfff4f8, accent: 0xff5ab4, tank: 0xffd23a }, barrels: 2, desc: 'Two barrels, fires faster (+30%)' },
    { id: 'splash', name: 'Splash Blaster', ic: '💦', price: 15000, dmg: 0.72, cd: 1.1, pellets: 3, spread: 0.07, size: 0.5, speed: 220, look: { body: 0xf0fff4, accent: 0x3ae88a, tank: 0x3ab8ff }, barrels: 3, desc: 'Three balls at once (+95%)' },
    { id: 'mega', name: 'Mega Cannon', ic: '💣', price: 150000, dmg: 2.6, cd: 1.7, pellets: 1, spread: 0, size: 1.2, speed: 170, blast: 5.5, look: { body: 0x3a3a4a, accent: 0xff6a1a, tank: 0xffd23a }, desc: 'Huge balls that explode on impact' },
    { id: 'minigun', name: 'Minigun', ic: '🌀', gems: 40, dmg: 0.55, cd: 0.3, pellets: 1, spread: 0.025, size: 0.45, speed: 260, look: { body: 0xd8dce8, accent: 0xffb81c, tank: 0xff4a3a }, barrels: 6, desc: 'Sprays balls super fast (+85%)' },
    { id: 'plasma', name: 'Plasma Rifle', ic: '🔮', price: 2500000, dmg: 2.4, cd: 0.85, pellets: 1, spread: 0, size: 0.7, speed: 320, pierce: 2, look: { body: 0x1a1a2a, accent: 0xc84aff, tank: 0x4af0ff }, desc: 'Plasma bolts punch through 3 blocks' },
    { id: 'galaxy', name: 'Galaxy Blaster', ic: '🌌', price: 40000000, dmg: 3.2, cd: 0.55, pellets: 2, spread: 0.04, size: 0.8, speed: 300, blast: 4, look: { body: 0x2a1a5a, accent: 0xff7af0, tank: 0x7af0ff }, barrels: 2, desc: 'Twin exploding star bolts' },
];
export const gunById = Object.fromEntries(GUNS.map((g) => [g.id, g]));

// ----- ammo (the hotbar): Bubble Balls never run out; the others refill over time -----
export const AMMO = [
    { id: 'normal', name: 'Bubble Balls', ic: '🔵', price: 0, max: Infinity, regen: 0, color: 0x3ad8ff, desc: 'Never run out' },
    { id: 'bouncy', name: 'Bouncy Balls', ic: '🟢', price: 1000, max: 40, regen: 1.5, bounces: 3, color: 0x6aff3a, desc: '+3 bounces on every shot' },
    { id: 'boom', name: 'Exploding Balls', ic: '🟠', price: 25000, max: 15, regen: 4, color: 0xff8a2a, desc: 'Blow up every block nearby' },
];
export const ammoById = Object.fromEntries(AMMO.map((a) => [a.id, a]));

// ----- Gem passes (permanent) -----
export const PASSES = {
    InstantSell: { name: 'Instant Sell Magnet', ic: '🧲', gems: 12, desc: 'Cubes you pick up sell on the spot: no more trips to the sell machine!' },
    SuperMagnet: { name: 'Super Magnet', ic: '🌀', gems: 8, desc: 'x2 pickup range, forever' },
    BigBackpack: { name: 'Giant Backpack', ic: '🎒', gems: 15, desc: 'x2 backpack space, forever' },
    DoubleCoins: { name: 'x2 Coins', ic: '💰', gems: 60, desc: 'Every sale pays double, forever' },
    LuckyBlocks: { name: 'Lucky Hands', ic: '🍀', gems: 30, desc: 'Blocks you break drop x1.5 cubes value' },
};
// ----- boosts (timed), bought with Gems or won from gifts, daily rewards and codes -----
export const BOOSTS = {
    coins2: { name: 'x2 Coins', ic: '💰', gems: 5, mins: 15, desc: 'Sales pay double for 15 minutes' },
    dmg2: { name: 'x2 Damage', ic: '💥', gems: 5, mins: 10, desc: 'Double damage for 10 minutes' },
    fire2: { name: 'Rapid Fire', ic: '⚡', gems: 4, mins: 10, desc: 'Shoot 50% faster for 10 minutes' },
};
// ----- ball skins (cosmetic, Coins) -----
export const BALL_SKINS = [
    { id: 'bubble', name: 'Bubble', price: 0, color: 0x3ad8ff, glow: 0xb8f4ff },
    { id: 'slime', name: 'Slime', price: 500, color: 0x6aff3a, glow: 0xd8ffb8 },
    { id: 'candy', name: 'Candy', price: 2000, color: 0xff6ad8, glow: 0xffd0f4 },
    { id: 'lava', name: 'Lava', price: 8000, color: 0xff6a1a, glow: 0xffd08a },
    { id: 'gold', name: 'Gold', price: 30000, color: 0xffd21e, glow: 0xfff4b8 },
    { id: 'void', name: 'Void', price: 120000, color: 0x8a3aff, glow: 0xe0c8ff },
    { id: 'rainbow', name: 'Rainbow', price: 500000, color: 0xff5a8a, glow: 0xffffff, rainbow: true },
];
export const skinById = Object.fromEntries(BALL_SKINS.map((s) => [s.id, s]));

// ----- quests -----
// The tutorial first (the reference's), then two quests at a time on the left of the screen, each
// paying Gems. kind: what counts. n(k): the target of the k-th quest of that line.
export const TUTORIAL = [
    { kind: 'break', n: 5, text: 'Break cubes', tip: 'Aim at the cube and shoot!' },
    { kind: 'collect', n: 10, text: 'Collect dropped cubes', tip: 'Walk over the little cubes that fell' },
    { kind: 'sell', n: 10, text: 'Sell cubes', tip: 'Take them to the SELL machine at the base' },
    { kind: 'upgrade', n: 1, text: 'Buy an upgrade', tip: 'Use the upgrade computer at the base' },
];
export const TUTORIAL_GEMS = 5;
const QA = [['collect', 25], ['tier', 10], ['collect', 60], ['gold', 5], ['collect', 150], ['tier', 60], ['gold', 15], ['collect', 400], ['tnt', 5], ['tier', 250], ['collect', 1000], ['gold', 40]];
const QB = [['sell', 25], ['break', 1000], ['upgrade', 3], ['sell', 100], ['coins', 2000], ['break', 4000], ['upgrade', 5], ['sell', 500], ['coins', 30000], ['break', 15000], ['destroy', 2], ['coins', 400000]];
export const QUEST_TEXT = {
    break: 'Destroy cubes', collect: 'Collect cubes', sell: 'Sell cubes', upgrade: 'Buy upgrades', tier: 'Break inner (striped) cubes',
    gold: 'Break gold cubes', tnt: 'Blow up TNT', coins: 'Earn coins', destroy: 'Destroy whole Cubes',
};
// the k-th quest of line a (0) or b (1): after the list runs out, the last few repeat, bigger each round
export function questAt(line, k) {
    const L = line ? QB : QA;
    if (k < L.length) { const [kind, n] = L[k]; return { kind, n, gems: 1 + (k >= 6 ? 1 : 0) }; }
    const extra = k - L.length, [kind, n] = L[L.length - 4 + (extra % 4)];
    return { kind, n: Math.round(n * Math.pow(2.2, 1 + Math.floor(extra / 4))), gems: 3 };
}

// ----- playtime gifts (minutes played this session) -----
// coins: x the Coins your current cube pays per block (scales with your level)
export const GIFTS = [
    { min: 1, gems: 1 }, { min: 3, coins: 40 }, { min: 5, boost: 'coins2' }, { min: 8, gems: 2 }, { min: 12, coins: 120 },
    { min: 15, boost: 'dmg2' }, { min: 20, gems: 3 }, { min: 25, coins: 300 }, { min: 30, boost: 'fire2' }, { min: 45, gems: 5 }, { min: 60, coins: 900 },
];
// ----- daily rewards (7-day streak) -----
export const DAILY = [
    { gems: 2 }, { coins: 60 }, { gems: 3 }, { boost: 'coins2' }, { gems: 5 }, { coins: 300 }, { gems: 10, boost: 'dmg2' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    const today = dayKey(now), yest = dayKey(now - 86400000);
    if (!d || !d.last) return { can: true, day: 0, streak: 0 };
    if (d.last === today) return { can: false, day: d.streak % 7, streak: d.streak };
    const streak = d.last === yest ? d.streak : 0;
    return { can: true, day: streak % 7, streak };
}
export const CODES = {
    DESTROY: { gems: 3 },
    CUBE: { boost: 'coins2' },
    ASMR: { gems: 5 },
    BLASTER: { boost: 'dmg2' },
    LEGION: { gems: 4 },
    BLOXITY: { coins: 100 },
    RELEASE: { gems: 2, boost: 'fire2' },
};
// Reward Coins scale with the best cube you've unlocked: a gift is worth the same effort at any level
export const coinScale = (p) => TIER_VAL[Math.min(TIER_VAL.length - 1, ((p && p.unlocked) || 0) + 1)];
export function rewardText(r, p) {
    return [
        r.coins ? '+' + fmt(r.coins * (p ? coinScale(p) : 1)) + ' Coins' : '',
        r.gems ? '+' + r.gems + ' Gem' + (r.gems > 1 ? 's' : '') : '',
        r.boost ? BOOSTS[r.boost].name + ' (' + BOOSTS[r.boost].mins + ' min)' : '',
    ].filter(Boolean).join(' + ');
}

// ----- the player's stats, from their upgrades, blaster, passes and boosts -----
export function stats(p, now) {
    const g = gunById[p.gun] || GUNS[0];
    const boosts = p.boosts || {};
    const on = (k) => (boosts[k] || 0) > now;
    return {
        gun: g,
        dmg: Math.max(1, Math.round(upValue(p, 'dmg') * g.dmg * (on('dmg2') ? 2 : 1))),
        cd: Math.max(0.045, upValue(p, 'rate') * g.cd * (on('fire2') ? 0.66 : 1)),
        bounces: upValue(p, 'bounce'),
        inv: upValue(p, 'inv') * (p.passes && p.passes.BigBackpack ? 2 : 1),
        range: upValue(p, 'range') * (p.passes && p.passes.SuperMagnet ? 2 : 1),
        blast: upValue(p, 'blast'),
    };
}
// Coins multiplier on sales: x2 Coins pass, the x2 boost, Friend Boost
export function coinMult(p, now, friends) {
    let m = 1;
    if (p.passes && p.passes.DoubleCoins) m *= 2;
    if (((p.boosts || {}).coins2 || 0) > now) m *= 2;
    m *= 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0);
    return m;
}

// ----- the arena (layout in arena.js) -----
// The cube stands in the middle (0, 0); the base (sell machine, upgrade computer, shops) is south of
// it, open toward the cube. You spawn in front of the base, facing the cube.
export const SPAWN = { x: 0, y: 0, z: 72, yaw: Math.PI };
export const SELL = { x: 0, z: 96 };

// Player outfits for the blocky fallback body (cycle by join order)
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x24242c, socks: 0xffffff, hair: 0x8a4a1a },
    { shirt: 0x3ac8ff, shorts: 0x2a2a4a, socks: 0xffffff, hair: 0xffd028 },
    { shirt: 0xff7ab0, shorts: 0x3a3a5a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0x6aff5a, shorts: 0x2a3a2a, socks: 0xffffff, hair: 0x3a2618 },
    { shirt: 0xffd028, shorts: 0x3a2a1a, socks: 0xffffff, hair: 0xb8541c },
    { shirt: 0xc45aff, shorts: 0x2a1a3a, socks: 0xffffff, hair: 0xff8ad8 },
];
export const SKINS = [0xf2c9a0, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// ----- formatting -----
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export function playtimeText(s) {
    s = Math.floor(s || 0);
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
