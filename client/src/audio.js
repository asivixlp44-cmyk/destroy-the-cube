// Procedural soundtrack and sound effects (Web Audio, no asset files).
//
// Music, "Cube Pop": an original, bright 112 BPM piece in F major (F - C - Dm - Bb, F - C - Bb - C).
// A woody marimba rolls arpeggios over a warm pad; then a soft kick, finger snaps, a shaker and a
// round bass join in, a bubbly bell sings the tune, it breaks down to the pad and little bubble
// pops, and comes back an octave up; 64 bars. How much of it plays follows the game
// (setMusicIntensity): menus and the cube's party are calm, blasting brings the groove in.
//
// The effects are made to feel nice (ASMR): soft "bloop" shots, plastic taps when a block is hit,
// squishy pops when it breaks, coin chimes, the sell machine's ka-ching, squishy steps on blocks.

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, asmrBus, reverb, roomVerb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, seqStep = 0, nextTime = 0, ducked = false;
const settings = { music: 0.5, sfx: 0.8, asmr: 0.9, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('dtc_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 112, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const CHORDS = [
    { root: 41, notes: [65, 69, 72] }, // F
    { root: 48, notes: [64, 67, 72] }, // C
    { root: 50, notes: [65, 69, 74] }, // Dm
    { root: 46, notes: [65, 70, 74] }, // Bb
    { root: 41, notes: [65, 69, 72] }, // F
    { root: 48, notes: [64, 67, 72] }, // C
    { root: 46, notes: [65, 70, 74] }, // Bb
    { root: 48, notes: [64, 67, 72] }, // C
];
// [step, midi, length] per bar
const LEAD = [
    [[0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
    [[0, 72, 2], [2, 74, 2], [4, 76, 4], [8, 79, 4], [12, 76, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 4], [12, 69, 4]],
    [[0, 70, 2], [2, 72, 2], [4, 74, 4], [8, 77, 2], [10, 74, 2], [12, 72, 4]],
    [[0, 81, 2], [2, 79, 2], [4, 77, 4], [8, 76, 2], [10, 77, 2], [12, 79, 4]],
    [[0, 79, 4], [4, 76, 2], [6, 72, 2], [8, 74, 2], [10, 76, 2], [12, 72, 4]],
    [[0, 74, 2], [2, 77, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 74, 4]],
    [[0, 76, 4], [4, 79, 4], [8, 84, 6], [14, 79, 2]],
];
const SECTION = (bar) => {
    const b = bar % 64;
    if (b < 8) return 'intro';
    if (b < 24) return 'groove';
    if (b < 40) return 'lead';
    if (b < 48) return 'break';
    return 'lead2';
};
let intensity = 1;
// 0 calm (menus, the party after a cube), 1 playing, 2 blasting away
export function setMusicIntensity(k) { intensity = Math.max(0, Math.min(2, k | 0)); }

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 9500; warm.Q.value = 0.3;
    musicOut = ctx.createGain();
    musicBus.connect(warm).connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    asmrBus = ctx.createGain(); asmrBus.connect(comp);
    applyVolumes();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = (secs, decay) => {
        const len = ctx.sampleRate * secs, b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
    };
    // a bright room for the music, a small one for the effects
    reverb = ctx.createConvolver(); reverb.buffer = ir(2.2, 3);
    const revGain = ctx.createGain(); revGain.gain.value = 0.3;
    reverb.connect(revGain).connect(musicBus);
    roomVerb = ctx.createConvolver(); roomVerb.buffer = ir(0.6, 3.5);
    const roomGain = ctx.createGain(); roomGain.gain.value = 0.22;
    roomVerb.connect(roomGain).connect(sfxBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2800;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.22;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}
function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.6 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
    asmrBus.gain.setTargetAtTime((settings.asmr ?? 1) * 1.1 * m, t, 0.05);
}
function save() { try { localStorage.setItem('dtc_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) { settings[kind] = Math.max(0, Math.min(1, v)); save(); applyVolumes(); }
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings }, intensity });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.32);
    noise(t, 0.012, 'lowpass', 1200, 0.7, gain * 0.2, musicBus);
}
function snap(t, gain) {
    noise(t, 0.05, 'bandpass', 2400, 2.5, gain, musicBus);
    noise(t + 0.004, 0.18, 'highpass', 3500, 0.6, gain * 0.35, reverb);
}
function clap(t, gain) {
    for (let k = 0; k < 3; k++) noise(t + k * 0.01, 0.02, 'bandpass', 1500, 1.4, gain * (k === 2 ? 1 : 0.7), musicBus);
    noise(t + 0.03, 0.25, 'highpass', 3000, 0.5, gain * 0.25, reverb);
}
function shaker(t, gain, accent) { noise(t, accent ? 0.07 : 0.045, 'bandpass', 6500, 1.2, gain * (accent ? 1.3 : 1), musicBus, 0, 0.012); }
// round bass: a sine with a soft triangle bite
function bass(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(260, t + dur); f.Q.value = 1.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(musicBus);
    for (const [type, k, a] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
}
// a woody marimba: a sine with a quickly-dying 4th harmonic
function marimba(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    g.connect(musicBus); g.connect(reverb);
    for (const [k, a, d] of [[1, 1, 0.55], [4.0, 0.35, 0.08], [10, 0.08, 0.03]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k;
        og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(og).connect(g); o.start(t); o.stop(t + d + 0.05);
    }
}
// the bubbly bell that sings the tune
function bell(t, n, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(gain * 0.4, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.3, dur * 1.4));
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.5; vg.gain.value = midi(n) * 0.006;
    vib.connect(vg);
    for (const [k, a] of [[1, 1], [2, 0.32], [3.01, 0.12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = k === 1 ? 'triangle' : 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        vg.connect(o.frequency);
        o.connect(og).connect(g); o.start(t); o.stop(t + dur * 1.4 + 0.35);
    }
    vib.start(t); vib.stop(t + dur * 1.4 + 0.35);
}
// a warm pad under everything
function pad(t, notes, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1300; f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g); g.connect(musicBus); g.connect(reverb);
    for (const n of notes) for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n - 12); o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.22;
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.3);
    }
}
function bubble(t, gain) { const f = 600 + Math.random() * 900; tone(t, 'sine', f, f * 2.2, 0.06, gain, musicBus, 0.004); }
function riser(t, dur, gain) { noise(t, dur, 'bandpass', 500, 2, gain, musicBus, 6000, dur * 0.9); }

function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, sec = SECTION(bar), b8 = bar % 8, ch = CHORDS[b8], k = intensity;
    const up = sec === 'lead2' ? 12 : 0;
    // the pad, every bar
    if (i === 0) pad(t, ch.notes, STEP * 16, sec === 'break' ? 0.05 : 0.035);
    // the marimba rolls the chord in eighth notes (sixteenths when it's busy)
    const busy = sec !== 'intro' && sec !== 'break' && k >= 1;
    if (i % 2 === 0 || (busy && k >= 2 && i % 4 === 3)) {
        const arp = [0, 1, 2, 1, 2, 0, 1, 2][(i >> 1) % 8];
        marimba(t, ch.notes[arp] + (i % 8 === 6 ? 12 : 0), sec === 'break' ? 0.05 : 0.07);
    }
    if (sec === 'break') {
        if (i % 4 === 2 && Math.random() < 0.7) bubble(t, 0.035);
        if (i === 0 && b8 === 7) riser(t, STEP * 16, 0.045);
        return;
    }
    if (sec === 'intro' && k < 2) { if (i % 2 === 1) shaker(t, 0.012, false); return; }
    if (k === 0) { if (i % 4 === 2) shaker(t, 0.012, false); return; }
    // the groove
    if (i === 0 || i === 8 || i === 10) kick(t, i === 10 ? 0.22 : 0.34);
    if (i === 4 || i === 12) { snap(t, 0.09); if (k >= 2) clap(t, 0.05); }
    if (i % 2 === 1) shaker(t, 0.018, i % 4 === 3);
    if (i === 0 || i === 6 || i === 10) bass(t, ch.root - 12 + (i === 10 ? 7 : 0), STEP * (i === 6 ? 3 : 4), 0.2);
    // the tune
    if (sec === 'lead' || sec === 'lead2') for (const [at, n, len] of LEAD[b8]) if (at === i) bell(t, n + up, STEP * len * 0.9, 0.05);
    if (bar % 16 === 15 && i === 0) riser(t, STEP * 16, 0.035);
}
function scheduler() {
    while (nextTime < ctx.currentTime + 0.2) {
        playStep(seqStep, nextTime);
        nextTime += STEP;
        seqStep++;
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    seqStep = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 30);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// =====================================================================================
// Footsteps
// =====================================================================================
const R = (a, b) => a + Math.random() * (b - a);
const STEPS = {
    // the plaza's tiles: a crisp tap
    tile(t, k) { noise(t, 0.022, 'bandpass', R(2300, 2900), 1.2, 0.12 * k, asmrBus); noise(t, 0.04, 'lowpass', 700, 1, 0.1 * k, asmrBus); },
    grass(t, k) { noise(t, 0.09, 'highpass', R(3000, 4200), 0.8, 0.07 * k, asmrBus, 0, 0.02); noise(t, 0.05, 'lowpass', 500, 1, 0.14 * k, asmrBus); },
    metal(t, k) { noise(t, 0.02, 'bandpass', R(2200, 2800), 6, 0.12 * k, asmrBus); tone(t, 'sine', R(520, 620), null, 0.16, 0.04 * k, asmrBus, 0.002); },
    // the cube's blocks: a soft squishy plastic squeak
    block(t, k) {
        const p = R(0.9, 1.15);
        tone(t, 'sine', 260 * p, 180 * p, 0.07, 0.12 * k, asmrBus, 0.004);
        noise(t, 0.05, 'bandpass', 1400 * p, 3, 0.1 * k, asmrBus, 700 * p, 0.006);
    },
    wood(t, k) { const p = R(0.9, 1.1); tone(t, 'triangle', 220 * p, 140 * p, 0.08, 0.15 * k, asmrBus, 0.002); noise(t, 0.03, 'bandpass', 900 * p, 3, 0.14 * k, asmrBus); },
};
export function step(surface, landing) {
    if (!ctx || (settings.asmr ?? 1) <= 0) return;
    const f = STEPS[surface] || STEPS.tile;
    f(ctx.currentTime + 0.004, landing ? 1.45 : 0.8);
}

// =====================================================================================
// Sound effects (sfx(name, arg): arg is a pitch / combo number for some)
// =====================================================================================
const SFX = {
    click(t) { tone(t, 'sine', 720, 1250, 0.05, 0.13); noise(t, 0.01, 'bandpass', 2400, 1, 0.08, sfxBus); },
    clickBuy(t) { tone(t, 'sine', 620, 1100, 0.05, 0.13); tone(t + 0.05, 'sine', 1100, 1650, 0.06, 0.1); },
    jump(t) { tone(t, 'sine', 330, 620, 0.09, 0.07); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.08); tone(t + 0.14, 'square', 180, 120, 0.18, 0.08); },
    // the blaster: a soft bubbly "bloop-pew" (big guns lower, the minigun quick and light)
    shoot(t, p) {
        p = p || 1;
        const j = R(0.94, 1.06) * p;
        tone(t, 'sine', 980 * j, 300 * j, 0.1, 0.075, sfxBus, 0.003);
        tone(t, 'triangle', 1960 * j, 600 * j, 0.05, 0.02, sfxBus, 0.002);
        noise(t, 0.03, 'bandpass', 3000 * j, 2, 0.05, sfxBus);
    },
    shootBig(t) {
        tone(t, 'sine', 420, 90, 0.28, 0.2, sfxBus, 0.004);
        noise(t, 0.18, 'lowpass', 1600, 0.8, 0.14, sfxBus, 300);
        tone(t, 'triangle', 820, 200, 0.12, 0.05, sfxBus, 0.002);
    },
    // a block hit: a hollow plastic tap
    tock(t, p) {
        const j = R(0.9, 1.12) * (p || 1);
        tone(t, 'triangle', 640 * j, 430 * j, 0.06, 0.08, asmrBus, 0.002);
        noise(t, 0.025, 'bandpass', 1900 * j, 2.2, 0.07, asmrBus);
    },
    // a block breaking: a squishy pop with a crunchy sparkle
    pop(t, p) {
        const j = R(0.85, 1.2) * (p || 1);
        tone(t, 'sine', 210 * j, 900 * j, 0.07, 0.16, asmrBus, 0.003);
        noise(t, 0.06, 'bandpass', 2800 * j, 1.4, 0.11, asmrBus, 5200 * j);
        noise(t + 0.01, 0.12, 'highpass', 5000, 0.7, 0.03, roomVerb);
        tone(t + 0.02, 'sine', 1400 * j, 2200 * j, 0.05, 0.03, asmrBus, 0.003);
    },
    popGold(t) { SFX.pop(t, 1.1); [88, 93, 96].forEach((n, i) => tone(t + 0.03 + i * 0.05, 'sine', midi(n), null, 0.25, 0.06)); },
    gem(t) { [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.045, 'sine', midi(n), null, 0.4, 0.07)); tone(t, 'triangle', 800, 3200, 0.3, 0.04); },
    boom(t) { tone(t, 'sine', 95, 30, 0.8, 0.45); noise(t, 0.9, 'lowpass', 1500, 0.8, 0.4, sfxBus, 90, 0.005); noise(t, 0.25, 'highpass', 2500, 0.6, 0.12, sfxBus); },
    // picking up a dropped cube: a soft blip that climbs with the combo
    pickup(t, n) {
        const k = Math.min(14, n || 0);
        tone(t, 'sine', midi(79 + k), midi(86 + k), 0.06, 0.07, asmrBus, 0.003);
        noise(t, 0.015, 'highpass', 6000, 0.8, 0.025, asmrBus);
    },
    // the sell machine: ka-ching and a shower of coins
    sell(t) {
        noise(t, 0.05, 'bandpass', 2400, 1.2, 0.18, sfxBus);
        tone(t + 0.03, 'square', midi(88), null, 0.08, 0.05); tone(t + 0.1, 'square', midi(93), null, 0.3, 0.05);
        tone(t + 0.03, 'sine', midi(100), null, 0.35, 0.05);
        for (let i = 0; i < 7; i++) tone(t + 0.15 + i * 0.045, 'sine', midi(91 + (i % 3) * 4), null, 0.12, 0.035);
    },
    coin(t) { tone(t, 'square', midi(88), null, 0.07, 0.04); tone(t + 0.07, 'square', midi(93), null, 0.2, 0.04); },
    upgrade(t) { [72, 76, 79, 84, 88].forEach((n, i) => { tone(t + i * 0.055, 'triangle', midi(n), null, 0.3, 0.09); tone(t + i * 0.055, 'sine', midi(n + 12), null, 0.2, 0.03); }); noise(t, 0.4, 'bandpass', 800, 1, 0.06, sfxBus, 7000, 0.05); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.13)); },
    quest(t) { [84, 88, 91].forEach((n, i) => tone(t + i * 0.07, 'triangle', midi(n), null, 0.35, 0.1)); SFX.gem(t + 0.2); },
    questBig(t) { [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => tone(t + i * 0.09, 'square', midi(n), null, 0.25, 0.05)); [60, 64, 67, 72].forEach((n) => tone(t + 0.63, 'triangle', midi(n), null, 1.2, 0.07)); },
    // CUBE DESTROYED!: a fanfare, a choir-ish chord and a big low boom
    destroyed(t) {
        SFX.boom(t);
        [65, 69, 72, 77, 72, 77, 81, 84].forEach((n, i) => tone(t + 0.25 + i * 0.1, 'square', midi(n), null, 0.28, 0.055));
        [53, 57, 60, 65, 69].forEach((n) => tone(t + 1.05, 'triangle', midi(n), null, 1.8, 0.07));
        noise(t + 1.05, 1.4, 'highpass', 3000, 0.6, 0.07, sfxBus);
        tone(t + 1.05, 'sine', 87, null, 1.6, 0.18);
    },
    full(t) { tone(t, 'sawtooth', 160, 120, 0.22, 0.05); tone(t + 0.12, 'sawtooth', 140, 100, 0.22, 0.05); },
    unlock(t) { SFX.buy(t); noise(t, 0.5, 'bandpass', 700, 1.2, 0.08, sfxBus, 6000, 0.05); },
    teleport(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.028, 'sine', midi(74 + i * 3), null, 0.16, 0.06); noise(t, 0.35, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.26, sfxBus); },
    equip(t) { tone(t, 'triangle', midi(79), midi(84), 0.12, 0.1); noise(t, 0.04, 'bandpass', 3000, 2, 0.08, sfxBus); },
    // aim down the sights: a soft click and a breath of air
    ads(t) { tone(t, 'sine', 1600, 1200, 0.03, 0.05); noise(t, 0.12, 'bandpass', 900, 1.5, 0.05, sfxBus, 2200, 0.02); },
    whoosh(t) { noise(t, 0.3, 'bandpass', 400, 1.6, 0.12, sfxBus, 1800, 0.08); },
    // a hit marker: a tiny crisp tick (higher when a block breaks)
    hitmark(t, p) { tone(t, 'square', 2600 * (p || 1), 2300 * (p || 1), 0.025, 0.025, sfxBus); },
    // a loose chunk letting go: a plastic creak
    creak(t) { const o = tone(t, 'sawtooth', 140, 90, 0.5, 0.05, sfxBus, 0.06); void o; noise(t, 0.5, 'bandpass', 900, 6, 0.08, sfxBus, 400, 0.05); },
    // a falling block hitting the ground: a deep thud and a crunch
    crash(t) { tone(t, 'sine', 120, 45, 0.3, 0.3); noise(t, 0.25, 'lowpass', 1800, 0.8, 0.22, sfxBus, 200, 0.004); noise(t + 0.01, 0.12, 'bandpass', 3200, 1.2, 0.08, sfxBus); },
    build(t) { for (let i = 0; i < 16; i++) tone(t + i * 0.09, 'sine', midi(60 + (i % 8) * 2), null, 0.12, 0.04); },
};
export function sfx(name, arg) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005, arg);
}
// Many effects in one frame (a TNT chain, a big blast): only a few actually sound
let burstT = 0, burstN = 0;
export function sfxSome(name, arg, cap) {
    if (!ctx) return;
    if (ctx.currentTime - burstT > 0.05) { burstT = ctx.currentTime; burstN = 0; }
    if (burstN++ >= (cap || 4)) return;
    sfx(name, arg);
}
