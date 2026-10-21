// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    coins: 0, totalCoins: 0, gems: 0, wins: 0, blocks: 0, playtime: 0,
    level: 0, unlocked: 0, best: {}, clears: {},
    up: {}, guns: { blaster: true }, gun: 'blaster', ammoOwned: { normal: true }, ammo: { bouncy: 0, boom: 0, at: 0 },
    balls: { bubble: true }, ball: 'bubble', passes: {}, boosts: {},
    bag: { n: 0, v: 0 }, q: { tut: 0, pt: 0, a: 0, pa: 0, b: 0, pb: 0 },
    daily: null, codes: {}, firstPlay: Date.now(), giftClaimed: {}, sessionSecs: 0,
    joinedAt: Date.now(), profileAt: Date.now(), name: '', friends: 0,
    // this device only
    ammoSel: 'normal', spent: { bouncy: 0, boom: 0 }, roomLevel: 0,
};

// Game actions that world objects (pads, machines, boards) and panels trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so timers line up for everyone (QA runs can pin it)
    fixedNow: null,
    now() { return this.fixedNow ?? Date.now() + this.offset; },
};
