import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Player progress, keyed by uid ('legion_<id>' for Bloxity users, 'guest_...' / browser ids otherwise).
// On Bloxity hosting Legion provides MONGODB_URI: profiles live in MongoDB, shared by every pod,
// and this process only caches the players it is hosting right now.
// Without MONGODB_URI (local dev) everything is kept in a JSON file.
const MONGODB_URI = process.env.MONGODB_URI || '';
export const USE_DB = !!MONGODB_URI;

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');

const profiles = new Map();
let dirty = false;
let db = null;          // { profiles, sessions } collections once connected
let dbReady = null;     // promise of the connection

if (USE_DB) {
    dbReady = connectDb();
} else {
    try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        for (const [uid, p] of Object.entries(raw)) profiles.set(uid, p);
        console.log(`Loaded ${profiles.size} profiles`);
    } catch (e) {
        if (e.code !== 'ENOENT') console.warn('Could not read profiles:', e.message);
    }
}

async function connectDb() {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const d = client.db(process.env.MONGODB_DB || undefined);
    db = { profiles: d.collection('profiles'), sessions: d.collection('sessions') };
    await Promise.all([
        db.profiles.createIndex({ totalCoins: -1 }),
        db.profiles.createIndex({ wins: -1 }),
        db.profiles.createIndex({ blocks: -1 }),
        db.profiles.createIndex({ playtime: -1 }),
        db.sessions.createIndex({ at: -1 }),
    ]).catch((e) => console.warn('[DB] index:', e.message));
    console.log('[DB] connected to MongoDB');
    return db;
}
// Resolves once the store can be used (instantly in file mode)
export async function storeReady() {
    if (!USE_DB) return;
    try { await dbReady; } catch (e) {
        console.warn('[DB] connect failed, retrying:', e.message);
        dbReady = connectDb();
        await dbReady;
    }
}

export function defaultProfile(uid, name) {
    return {
        uid, name,
        coins: 0, totalCoins: 0, gems: 0, wins: 0, blocks: 0, playtime: 0,
        level: 0, unlocked: 0, best: {}, clears: {},
        up: {}, guns: { blaster: true }, gun: 'blaster', ammoOwned: { normal: true }, ammo: { bouncy: 0, boom: 0, at: 0 },
        balls: { bubble: true }, ball: 'bubble', passes: {}, boosts: {},
        bag: { n: 0, v: 0 }, q: { tut: 0, pt: 0, a: 0, pa: 0, b: 0, pb: 0 },
        daily: {}, codes: {},
        firstPlay: Date.now(),
    };
}

const fromDoc = (doc) => { const { _id, ...p } = doc; return { ...p, uid: _id }; };

// Pulls a player's saved profile into the cache. Call before getProfile in DB mode.
export async function loadProfile(uid) {
    if (!USE_DB || !uid || profiles.has(uid)) return;
    await storeReady();
    const doc = await db.profiles.findOne({ _id: uid });
    if (doc && !profiles.has(uid)) profiles.set(uid, fromDoc(doc));
}

// A blank name keeps the saved one; new players without a name get a random one
export function getProfile(uid, name, fallbackName) {
    let p = profiles.get(uid);
    if (!p) {
        p = defaultProfile(uid, name || fallbackName);
    } else {
        // Reconcile profiles saved by older versions
        p = Object.assign(defaultProfile(uid, name), p);
    }
    profiles.set(uid, p);
    if (name) p.name = name;
    dirty = true;
    return p;
}

// First Bloxity login on a browser that already played as a guest keeps that progress
export async function adoptGuestProgress(legionUid, guestUid, name) {
    if (!guestUid) return;
    await Promise.all([loadProfile(legionUid), loadProfile(guestUid)]);
    if (profiles.has(legionUid) || !profiles.has(guestUid)) return;
    const g = profiles.get(guestUid);
    profiles.set(legionUid, { ...JSON.parse(JSON.stringify(g)), uid: legionUid, name: name || g.name });
    dirty = true;
}

// Whether this uid is known here (in DB mode: call loadProfile first)
export function hasProfile(uid) { return profiles.has(uid); }
export function markDirty() { dirty = true; }
// Profiles cached in this process (in DB mode: the players online on this pod)
export function allProfiles() { return profiles.values(); }

async function writeDocs(list) {
    if (!list.length) return;
    await storeReady();
    await db.profiles.bulkWrite(list.map((p) => {
        const { uid, ...rest } = p;
        return { replaceOne: { filter: { _id: uid }, replacement: { ...rest, updatedAt: Date.now() }, upsert: true } };
    }), { ordered: false });
}

let saving = null, soonTimer = null;
// Soon (debounced): a checkpoint, a purchase or a win shouldn't wait for the 10 s save
export function saveSoon() {
    dirty = true;
    if (soonTimer) return;
    soonTimer = setTimeout(() => { soonTimer = null; saveProfiles(); }, 1500);
    if (soonTimer.unref) soonTimer.unref();
}
export function saveProfiles() {
    if (!dirty) return saving || Promise.resolve();
    dirty = false;
    if (USE_DB) {
        const list = [...profiles.values()].map((p) => JSON.parse(JSON.stringify(p)));
        saving = writeDocs(list).catch((e) => { dirty = true; console.warn('[DB] save failed:', e.message); })
            .finally(() => { saving = null; });
        return saving;
    }
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(profiles)));
        fs.renameSync(tmp, FILE);
    } catch (e) {
        dirty = true;
        console.warn('Could not save profiles:', e.message);
    }
    return Promise.resolve();
}

// A player left this pod: save them and drop them from the cache, so a later visit
// (maybe after playing on another pod) reads fresh data from the database.
// stillOnline is checked again after the write: the player may have rejoined while it ran,
// and dropping their live profile from the cache then would lose everything they earn next.
export async function releaseProfile(uid, stillOnline) {
    if (!USE_DB) return;
    const p = profiles.get(uid);
    if (!p) return;
    try {
        await writeDocs([JSON.parse(JSON.stringify(p))]);
        if (!(stillOnline && stillOnline(uid)) && profiles.get(uid) === p) profiles.delete(uid);
    } catch (e) {
        console.warn('[DB] release failed:', e.message);
    }
}

// Best players across every pod, refreshed in the background
const BOARD_KEYS = ['totalCoins', 'wins', 'blocks'];
const board = { totalCoins: [], wins: [], blocks: [] };
async function refreshBoards() {
    if (!USE_DB || !db) return;
    try {
        for (const key of BOARD_KEYS) {
            const docs = await db.profiles.find({}, { projection: { name: 1, totalCoins: 1, wins: 1, blocks: 1 } }).sort({ [key]: -1 }).limit(10).toArray();
            board[key] = docs.map(fromDoc);
        }
    } catch (e) { console.warn('[DB] boards:', e.message); }
}
// Top 10 by key: database leaders merged with the (fresher) players online here
export function topProfiles(key) {
    const byUid = new Map();
    for (const p of board[key] || []) byUid.set(p.uid, p);
    for (const p of profiles.values()) byUid.set(p.uid, p);
    return [...byUid.values()].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 10);
}

// Rooms also save on dispose: Colyseus disposes rooms (and awaits onDispose) on SIGTERM,
// which is how a pod is stopped on every deploy
setInterval(saveProfiles, USE_DB ? 10000 : 30000).unref();
if (USE_DB) {
    storeReady().then(refreshBoards).catch(() => {});
    setInterval(refreshBoards, 30000).unref();
}

// ----- Play stats: one record per finished session (no names or ids), read by /api/stats -----
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.jsonl');
export async function recordSession(doc) {
    if (USE_DB) { await storeReady(); await db.sessions.insertOne(doc); return; }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(SESSIONS_FILE, JSON.stringify(doc) + '\n');
}
export async function loadSessions(sinceMs, limit) {
    if (USE_DB) {
        await storeReady();
        return db.sessions.find({ at: { $gte: new Date(sinceMs) } }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray();
    }
    try {
        return fs.readFileSync(SESSIONS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
            .filter((d) => new Date(d.at).getTime() >= sinceMs).slice(-limit).reverse();
    } catch (e) { return []; }
}
