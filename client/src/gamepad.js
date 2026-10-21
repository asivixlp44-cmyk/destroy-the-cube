// Controller support through the Gamepad API ("standard" mapping, Xbox-style names).
// Sticks and triggers are read every frame; face buttons fire on press.

const DEAD = 0.18;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const prev = new Map();
let activeIndex = null;
let onConnect = null;

export const pad = {
    connected: false,
    lx: 0, ly: 0, rx: 0, ry: 0,
    jump: false, sprint: false, fire: false, aim: false,
    pressed: new Set(), // names of buttons pressed this frame
    lastUsed: 0,        // performance.now() of the last controller input
};

function dz(v) {
    const a = Math.abs(v);
    return a < DEAD ? 0 : Math.sign(v) * (a - DEAD) / (1 - DEAD);
}
const isDown = (b) => !!b && (b.pressed || b.value > 0.5);

addEventListener('gamepadconnected', (e) => {
    if (e.gamepad.mapping !== 'standard') return;
    activeIndex = e.gamepad.index;
    pad.connected = true;
    if (onConnect) onConnect(e.gamepad, true);
});
addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === activeIndex) {
        activeIndex = null;
        pad.connected = false;
        if (onConnect) onConnect(e.gamepad, false);
    }
});
export function onGamepadConnection(cb) { onConnect = cb; }

// Only controllers with the browser's "standard" layout: anything else (a wheel, a flight stick, a
// virtual device some drivers install) maps its buttons anywhere, and its "Y" would open the Shop
const usable = (g) => !!g && g.connected && g.mapping === 'standard';
function currentPad() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    if (activeIndex !== null && usable(list[activeIndex])) return list[activeIndex];
    for (const g of list) if (usable(g)) { activeIndex = g.index; pad.connected = true; return g; }
    return null;
}

export function pollGamepad() {
    pad.pressed.clear();
    const g = currentPad();
    if (!g) { pad.lx = pad.ly = pad.rx = pad.ry = 0; pad.jump = pad.sprint = pad.fire = pad.aim = false; return pad; }
    const ax = g.axes;
    pad.lx = dz(ax[0] || 0); pad.ly = dz(ax[1] || 0);
    pad.rx = dz(ax[2] || 0); pad.ry = dz(ax[3] || 0);
    const b = g.buttons;
    pad.jump = isDown(b[BTN.A]);
    pad.fire = isDown(b[BTN.RT]);
    pad.aim = isDown(b[BTN.LT]);
    pad.sprint = isDown(b[BTN.L3]);
    const now = b.map(isDown);
    // the first look at a controller: buttons already held down don't count as presses
    const was = prev.get(g.index) || now;
    for (const [name, i] of Object.entries(BTN)) if (now[i] && !was[i]) pad.pressed.add(name);
    prev.set(g.index, now);
    if (pad.pressed.size || pad.lx || pad.ly || pad.rx || pad.ry || pad.sprint || pad.fire) pad.lastUsed = performance.now();
    return pad;
}

// Short rumble; ignored by controllers or browsers that can't vibrate
export function rumble(strength, ms) {
    const g = currentPad();
    const act = g && g.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms || 150, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.7) }).catch(() => {});
}
