// The arena's layout, shared by the client (to build it) and the server (to check you're really at
// the sell machine). The cube stands at the origin; the base opens toward it from the south (+z).
export const BASE = { x: 0, z: 110, r: 32 };          // the curved building: centre and wall radius
export const SPOTS = {
    sell: { x: 0, z: 96 },                            // the SELL pad (in front of the machine)
    computer: { x: -20, z: 103 },                     // the upgrade computer
    guns: { x: -17, z: 127 },                         // blasters counter
    ammo: { x: 0, z: 133 },                           // ball types counter
    gems: { x: 17, z: 127 },                          // the gem machine
    skins: { x: 20, z: 103 },                         // ball skins
    portal: { x: 40, z: 74 },                         // CUBE SELECT
};
export const PLAZA_R = 64;

// The lobby: a floating island far away from the arena (only one of the two is drawn at a time).
// Its pads (lobby.js) warp you into a cube room.
export const LOBBY = { x: 0, z: -2600, r: 118, spawn: { x: 0, z: -2600 + 80 }, yaw: Math.PI };
