import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { listen } from '@colyseus/tools';
import { defineRoom, matchMaker } from 'colyseus';
import express from 'express';
import { CubeRoom } from './CubeRoom.js';
import { installStatReporter } from './bloxity.js';
import { statsSummary } from './stats.js';
import { USE_DB } from './profiles.js';

// Serves the built client (client/dist) and the game room on the same port,
// so one Node host is enough to run the whole game.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

// Play stats are private: /api/stats needs ?key=<stats key>. Only the key's SHA-256 lives in the
// public repo (the key itself is in server/STATS_KEY.local.txt); locally (not on Legion) they're open.
const STATS_KEY_SHA256 = 'c635c19cd7507d25f10446721fd52bac3e4e8cc3b832363cbfe11ee365d94b40';
const ON_LEGION = !!process.env.BLOXITY_GAME_ID;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (key) => !!key && crypto.timingSafeEqual(sha256(key), Buffer.from(STATS_KEY_SHA256, 'hex'));

const app = config({
    rooms: {
        // one room per cube: players join a room of the cube level they're playing (the busiest first)
        cube: defineRoom(CubeRoom).filterBy(['level']).sortBy({ clients: -1 }),
    },
    initializeExpress: (expressApp) => {
        expressApp.get('/health', (req, res) => res.json({ ok: true, db: USE_DB }));
        // How many are playing each cube right now (the lobby's pads show it)
        expressApp.get('/api/rooms', async (req, res) => {
            try {
                const list = await matchMaker.query({ name: 'cube' });
                const by = {};
                for (const r of list) { const L = r.metadata && r.metadata.level; if (L === undefined) continue; by[L] = (by[L] || 0) + (r.clients || 0); }
                res.set('Cache-Control', 'no-store').json(by);
            } catch (e) { res.json({}); }
        });
        // Play stats (aggregate, no names): /api/stats?key=<stats key>&days=7
        expressApp.get('/api/stats', async (req, res) => {
            const key = typeof req.query.key === 'string' ? req.query.key : '';
            if (ON_LEGION && !keyOk(key)) return res.status(401).json({ error: 'bad key' });
            const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
            try { res.json(await statsSummary(days)); } catch (e) { res.status(503).json({ error: e.message }); }
        });
        if (fs.existsSync(CLIENT_DIST)) expressApp.use(express.static(CLIENT_DIST));
    },
});

const reporter = installStatReporter();
process.once('beforeExit', () => { reporter.flush(); });

// 2667 locally so this game can run beside the other Legion games; Legion sets PORT
listen(app, Number(process.env.PORT) || 2667);
