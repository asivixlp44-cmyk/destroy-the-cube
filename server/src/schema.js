import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (Coins, upgrades, quests, the backpack...) goes
// only to its owner in the "profile" message. The cube's blocks aren't in here either: they're sent
// as a bitmask on join and as batches of broken / damaged blocks ('cb', up to 20 times a second).
export const PlayerState = schema({
    name: t.string().default(''),
    pid: t.uint8().default(0),       // short id for this room's messages (who broke a block, who shot)
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    ap: t.float32().default(0),      // aim pitch (the blaster arm follows it)
    anim: t.uint8().default(0),      // 0 idle, 1 run, 2 air
    gun: t.string().default('blaster'),
    ball: t.string().default('bubble'),
    friends: t.uint8().default(0),   // Friend Boost: Bloxity friends in this server
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    wins: t.uint32().default(0),
    av: t.string().default(''),      // packed Bloxity avatar (equipped ids + proportions)
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
    lobby: t.boolean().default(false), // the lobby: no cube, everyone between games
    level: t.uint8().default(0),
    seed: t.uint32().default(1),
    gen: t.uint16().default(0),      // +1 every time the cube is rebuilt
    phase: t.uint8().default(0),     // 0 standing, 1 destroyed (the party), 2 building again
    left: t.uint32().default(0),     // blocks still standing
    total: t.uint32().default(0),
    startAt: t.float64().default(0), // server ms when this cube was built (the timer)
    nextAt: t.float64().default(0),  // server ms when it builds again (phase 1)
}, 'GameState');
