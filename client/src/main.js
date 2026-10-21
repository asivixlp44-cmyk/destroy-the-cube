import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, hemi, ambient, renderer, solids, prompts, tickers, billboard, buildRig, animRig, airPose,
    floatText, updateEffects, lerpAngle, updateSky, SUN_DIRECTION,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, sfxSome, step as surfStep, setVolume, audioSuspended, setMusicIntensity } from './audio.js';
import { setMood } from './engine.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, getQuality, autoQualityAllowed, confetti, updateAmbient,
    fxWarmGroup, fxShowAll, setOverlay, hitSpark, breakPuff, blastFx, muzzleFlash, coinFountain, collectFx, trailDot,
} from './fx.js';
import { buildWorld, warmUp, renderBoards, setGuide, setTheme, sellBeamOn, setPlace } from './world.js';
import { buildLobby, setLobbyVisible, lobbyPads, quickPad, padAt, padCharge, setPadInfo } from './lobby.js';
import { cube, drops, shards, balls, dmgNums, fallers, U, groundAt } from './cube.js';
import { blasterModel, MUZZLE } from './blaster.js';
import {
    promptEl, promptTxtEl, animateCounters, bumpCoins, bumpGems, myStats, ammoLeft, bagCap, updateHud, renderSlots, toast, questPop, bigText, flash,
    setHint, setCrosshair, kickCrosshair, notEnough, showDestroyed, hideDestroyed, showWarp, setWarp, hideWarp, openModal, closeModal,
    refreshModal, codeResult, openDailyOnJoin, refreshDaily, closeTop, anyPopup, modalIs, hitMarker, setTarget, setPadHint, openDaily,
} from './ui.js';
import {
    CFG, CUBES, LEVELS, TIER_HP, TNT_RADIUS, TNT_DAMAGE, GUNS, gunById, AMMO, ammoById, skinById, TUTORIAL, upgradeById, SPAWN, KITS, SKINS,
    fmt, clamp, levelOpen,
} from '../../shared/config.js';
import { SPOTS, LOBBY } from '../../shared/arena.js';
import { KINDS, TIER_NAMES } from '../../shared/config.js';
import { B, bounceTarget } from '../../shared/cube.js';

const T0 = performance.now();
const gt = () => (performance.now() - T0) / 1000;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.25, PIVOT = 2.6;
const P = {
    pos: new V3(SPAWN.x, 0, SPAWN.z), vel: new V3(), hv: new V3(), onGround: true, ground: null, facing: SPAWN.yaw, moving: false,
    animPhase: 0, airTime: 0, peakY: 0, lastStepN: 0, squash: 1, squashV: 0, jumpPress: -9, coyote: 0, aimT: -9, recoil: 0, lean: 0,
};
let place = 'lobby';
const inLobby = () => place === 'lobby';
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.1, shake + a); }
let rig = null;

// ----- a character: rig (feet, yaw) -> pivot (hips) -> body (blocky or Bloxity); the blaster in hand -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length] });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, baseBody: body, blox: null, gun: null, gunId: '' };
    return g;
}
function setGun(g, id) {
    const u = g.userData;
    id = gunById[id] ? id : 'blaster';
    if (u.gunId === id) return;
    if (u.gun) scene.remove(u.gun);
    u.gun = blasterModel(id);
    u.gun.scale.setScalar(0.62);
    u.gunId = id;
    scene.add(u.gun);
}
// The blaster sits in the right hand, pointing where the player aims
const handV = new V3(), gripV = new V3(), eul = new T.Euler(0, 0, 0, 'YXZ');
const GRIP = new V3(0, -0.85, -0.55);
function placeGun(g, facing, aimUp, recoil) {
    const u = g.userData;
    if (!u.gun) return;
    u.gun.visible = g.visible;
    if (!g.visible) return;
    if (u.blox && (u.blox.bones.ArmR2_leaf || u.blox.bones.ArmR2)) {
        u.blox.model.updateMatrixWorld(true);
        (u.blox.bones.ArmR2_leaf || u.blox.bones.ArmR2).getWorldPosition(handV);
    } else {
        g.updateMatrixWorld(true);
        g.localToWorld(handV.set(1.45, 3.35, 1.55));
    }
    eul.set(-aimUp - (recoil || 0) * 0.25, facing, 0, 'YXZ');
    u.gun.rotation.copy(eul);
    gripV.copy(GRIP).multiplyScalar(0.62).applyEuler(eul);
    u.gun.position.copy(handV).sub(gripV);
}

// ----- the first-person blaster, drawn over the frame (its own little scene and light) -----
const vmScene = new T.Scene();
const vmHemi = new T.HemisphereLight(0xeaf4ff, 0xb8c8a8, 1.1), vmAmb = new T.AmbientLight(0xffffff, 0.45), vmSun = new T.DirectionalLight(0xfff4e0, 1.5);
vmSun.position.copy(SUN_DIRECTION).multiplyScalar(10);
vmScene.add(vmHemi, vmAmb, vmSun, vmSun.target);
let vm = null, vmId = '';
function setViewModel(id) {
    if (vmId === id && vm) return;
    if (vm) vmScene.remove(vm);
    vm = blasterModel(id, true);
    vm.scale.setScalar(0.3);
    vmId = id;
    vmScene.add(vm);
}
const vmLast = { yaw: 0, pitch: 0, sx: 0, sy: 0, equip: 0, id: '' };
const vmOff = new V3(), qCam = new T.Quaternion(), qFlip = new T.Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.PI), qKick = new T.Quaternion(), AX = new V3(1, 0, 0);
// turned a touch toward the middle, so the barrel points at the crosshair
const qAimIn = new T.Quaternion().setFromEuler(new T.Euler(0.03, 0.07, 0)), qFlat = new T.Quaternion();
// the muzzle flash: a bright star at the barrel for a moment (in the world, and over the first-person blaster)
const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 2, 64, 64, 60);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[120, 10], [10, 120]]) { const g2 = x.createRadialGradient(64, 64, 1, 64, 64, 60); g2.addColorStop(0, 'rgba(255,255,255,0.9)'); g2.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g2; x.fillRect(64 - w / 2, 64 - h / 2, w, h); }
    const t2 = new T.CanvasTexture(c); t2.colorSpace = T.SRGBColorSpace; return t2;
})();
const flashMk = () => { const sp = new T.Sprite(new T.SpriteMaterial({ map: flashTex, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false })); sp.visible = false; sp.renderOrder = 11; return sp; };
const flashW = flashMk(), flashV = flashMk();
scene.add(flashW); vmScene.add(flashV);
let flashT = -9, flashColor = 0xffffff;
function placeFlash() {
    const k = 1 - (clockT - flashT) / 0.07;
    const fp = isFP();
    flashW.visible = k > 0 && !fp; flashV.visible = k > 0 && fp && !!vm;
    if (k <= 0) return;
    const s2 = (0.9 + Math.random() * 0.5) * (0.6 + k * 0.6);
    if (fp && vm) { vm.localToWorld(flashV.position.copy(MUZZLE).add(tmpV.set(0, 0, 0.6))); flashV.scale.setScalar(s2 * 0.9); flashV.material.color.set(flashColor); flashV.material.rotation = Math.random() * 3; }
    else if (rig && rig.userData.gun) { rig.userData.gun.localToWorld(flashW.position.copy(MUZZLE).add(tmpV.set(0, 0, 0.6))); flashW.scale.setScalar(s2 * 2.2); flashW.material.color.set(flashColor); flashW.material.rotation = Math.random() * 3; }
}
const qSway = new T.Quaternion(), eSway = new T.Euler();
function placeViewModel(dt, t) {
    if (!vm) return;
    // sway: the blaster lags behind quick turns of the view, then catches up
    let dy = cam.yaw - vmLast.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const dp = cam.pitch - vmLast.pitch;
    vmLast.yaw = cam.yaw; vmLast.pitch = cam.pitch;
    const k = 1 - Math.exp(-dt * 10);
    vmLast.sx += (clamp(dy * 3, -0.14, 0.14) - vmLast.sx) * k;
    vmLast.sy += (clamp(dp * 3, -0.1, 0.1) - vmLast.sy) * k;
    if (vmLast.id !== (S.gun || '') + S.ammoSel) { vmLast.id = (S.gun || '') + S.ammoSel; vmLast.equip = 1; sfx('equip'); }
    vmLast.equip = Math.max(0, vmLast.equip - dt * 3.2);
    const eq = vmLast.equip * vmLast.equip;
    const run = sprinting ? 1 : 0, a = adsK;
    const bobA = P.moving && P.onGround ? (sprinting ? 0.07 : 0.035) * (1 - a * 0.8) : 0.01;
    const bob = P.moving && P.onGround ? Math.sin(P.animPhase) * bobA : Math.sin(t * 1.6) * 0.01;
    const side = P.moving && P.onGround ? Math.cos(P.animPhase * 0.5) * bobA * 0.8 : 0;
    vmOff.set(0.48 * (1 - a) + 0.02 * a + side + vmLast.sx * 0.6 - run * 0.08, -0.44 * (1 - a) - 0.3 * a + bob - run * 0.12 - eq * 0.6 + vmLast.sy * 0.5, -1.2 - a * 0.05 + P.recoil * 0.16).applyQuaternion(camera.quaternion);
    vm.position.copy(camera.position).add(vmOff);
    qKick.setFromAxisAngle(AX, P.recoil * 0.2 + eq * 0.9 - run * 0.35);
    eSway.set(vmLast.sy * 0.6, vmLast.sx * 0.9 + run * 0.5, -vmLast.sx * 0.8 - run * 0.35);
    qSway.setFromEuler(eSway);
    vm.quaternion.copy(camera.quaternion).multiply(qSway).multiply(a > 0.5 ? qFlat : qAimIn).multiply(qKick).multiply(qFlip);
    vm.updateMatrixWorld(true);
    vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor);
    vmSun.color.copy(sun.color); vmAmb.intensity = ambient.intensity;
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot and the blaster -----
function dressRig(group, avatar) {
    const u = group.userData, body = u.baseBody;
    body.children.forEach((c) => { c.visible = false; });
    body.add(avatar.root);
    u.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubbleLbl) { group.remove(group.userData.bubbleLbl); group.userData.bubbleLbl.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#10203a', px: 44 }], 9, 1024, new V3(0, 10, 0), group);
    group.userData.bubbleLbl = b;
    setTimeout(() => { if (group.userData.bubbleLbl === b) { group.remove(b); b.material.map.dispose(); group.userData.bubbleLbl = null; } }, 5000);
}
const nameLines = (name, wins) => [{ t: name || ' ', c: '#ffffff', s: '#10203a', px: 60 }, ...(wins ? [{ t: '🧊 ' + fmt(wins), c: '#9ae8ff', s: '#10203a', px: 40 }] : [])];

function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.gun) scene.remove(rig.userData.gun); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// =====================================================================================
// Collision: the arena's boxes near you, the cube's blocks around you, and the ground (y = 0)
// =====================================================================================
let nearBoxes = [], nearT = -9;
function refreshNear() {
    nearBoxes = solids.filter((c) => {
        const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2, r = Math.max(c.max.x - c.min.x, c.max.z - c.min.z) / 2 + 40;
        return (cx - P.pos.x) ** 2 + (cz - P.pos.z) ** 2 < r * r;
    });
}
const vpool = [], listA = [], listB = [];
let vk = 0;
function boxesAround(x, y, z, padW, out) {
    out.length = 0;
    for (const c of nearBoxes) out.push(c);
    const g = cube.grid;
    if (!g) return out;
    const n = g.n;
    const x0 = Math.max(0, Math.floor((x - HW - padW - g.x0) / B)), x1 = Math.min(n - 1, Math.floor((x + HW + padW - g.x0) / B));
    const z0 = Math.max(0, Math.floor((z - HW - padW - g.z0) / B)), z1 = Math.min(n - 1, Math.floor((z + HW + padW - g.z0) / B));
    const y0 = Math.max(0, Math.floor((y - padW) / B)), y1 = Math.min(n - 1, Math.floor((y + PH + padW) / B));
    if (x0 > x1 || z0 > z1 || y0 > y1) return out;
    for (let gy = y0; gy <= y1; gy++) for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
        if (g.hp[gx + n * (gz + n * gy)] <= 0) continue;
        const b = vpool[vk] || (vpool[vk] = { min: new V3(), max: new V3(), mat: 'block', cube: true });
        vk = (vk + 1) % 256;
        b.min.set(g.x0 + gx * B, gy * B, g.z0 + gz * B);
        b.max.set(b.min.x + B, b.min.y + B, b.min.z + B);
        out.push(b);
    }
    return out;
}
const GRASS = { mat: 'grass' }, TILE = { mat: 'tile' };
const groundMat = () => (inLobby() || P.pos.x ** 2 + P.pos.z ** 2 < 71 * 71 || (Math.abs(P.pos.x) < 14 && P.pos.z < 82) ? TILE : GRASS);
const overlaps = (c, x, y, z) => c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of boxesAround(x, y, z, 0.1, listB)) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of boxesAround(p.x, p.y, p.z, Math.abs(d) + 0.2, listA)) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { if (c.max.y - p.y > Math.max(STEP, -d + 0.05)) continue; p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { if (p.y + PH - c.min.y > d + 0.05) continue; p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
    if (axis === 'y' && p.y <= 0) { p.y = 0; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = groundMat(); }
}
function groundProbe(maxDrop) {
    const p = P.pos;
    let best = -Infinity, bs = null;
    for (const c of boxesAround(p.x, p.y - maxDrop, p.z, 0.1, listA)) {
        if (c.max.x <= p.x - HW || c.min.x >= p.x + HW || c.max.z <= p.z - HW || c.min.z >= p.z + HW) continue;
        if (c.max.y <= p.y + 0.01 && c.max.y >= p.y - maxDrop && c.max.y > best) { best = c.max.y; bs = c; }
    }
    if (!bs && p.y - maxDrop <= 0) { best = 0; bs = groundMat(); }
    if (bs) { p.y = best; P.onGround = true; P.ground = bs; P.vel.y = Math.max(0, P.vel.y); }
    return !!bs;
}
// Ray against the arena's boxes near the player (camera collision, shots into walls)
const AXES = ['x', 'y', 'z'];
function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of nearBoxes) {
        if (c.max.x - c.min.x < 1.5 && c.max.z - c.min.z < 1.5) continue;
        let t0 = 0, t1 = best, miss = false;
        for (const a of AXES) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { miss = true; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { miss = true; break; }
        }
        if (!miss && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}

function teleport(pos, yaw) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.hv.set(0, 0, 0);
    if (yaw !== undefined) { P.facing = yaw; cam.yaw = yaw + Math.PI; }
    P.peakY = pos.y; P.airTime = 0;
    refreshNear(); nearT = clockT;
    sendMove(true);
}
const spawnPos = () => (inLobby() ? new V3(LOBBY.spawn.x + (Math.random() - 0.5) * 10, 0, LOBBY.spawn.z) : new V3(SPAWN.x + (Math.random() - 0.5) * 6, 0, SPAWN.z));
function insideCube() {
    const g = cube.grid;
    if (!g) return false;
    for (const c of boxesAround(P.pos.x, P.pos.y + 0.2, P.pos.z, 0, listA)) if (c.cube && overlaps(c, P.pos.x, P.pos.y + 0.2, P.pos.z)) return true;
    return false;
}

// =====================================================================================
// Camera: over the shoulder (the crosshair is where the balls go), or first person
// =====================================================================================
const cam = { yaw: SPAWN.yaw + Math.PI, pitch: 0.06, dist: 13, fp: false };
let camD = 13, camSens = 1;
const dirV = new V3(), rightV = new V3(), pivotV = new V3(), backV = new V3(), camPos = new V3(), lookV = new V3();
let pivotY = 4.4;
// recoil: each shot kicks the view up a little; it springs back
let kick = 0, kickV = 0, fovKick = 0, ads = false, adsK = 0, sprinting = false;
function lookDir(out) { const p = cam.pitch - kick, cp = Math.cos(p); return out.set(-Math.sin(cam.yaw) * cp, -Math.sin(p), -Math.cos(cam.yaw) * cp); }
const isFP = () => !inLobby() && (cam.fp || cam.dist < 2.2);
actions.getFP = () => isFP();
actions.setFP = (on) => { cam.fp = !!on; if (!on && cam.dist < 3) cam.dist = 13; storageSet('dtc_fp', on ? '1' : '0'); };
// The sun's shadow camera follows you in steps of one shadow-map texel
const LZD = SUN_DIRECTION.clone().normalize(), LX = new V3(0, 1, 0).cross(LZD).normalize(), LY = LZD.clone().cross(LX), snapV = new V3();
function snapShadow(p) {
    const c = sun.shadow.camera, texel = (c.right - c.left) / sun.shadow.mapSize.x;
    const a = Math.round(p.dot(LX) / texel) * texel, b = Math.round(p.dot(LY) / texel) * texel;
    snapV.copy(LX).multiplyScalar(a).addScaledVector(LY, b).addScaledVector(LZD, p.dot(LZD));
    sun.target.position.copy(snapV);
    sun.position.copy(snapV).addScaledVector(LZD, 200);
}
let baseFov = camera.fov;
function updateCamera(dt) {
    const t = gt();
    lookDir(dirV);
    const fp = isFP();
    if (fp) {
        camPos.set(P.pos.x, P.pos.y + 4.75, P.pos.z);
        camD = 0.01;
    } else {
        rightV.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
        pivotY += (P.pos.y + 5.1 - pivotY) * (1 - Math.exp(-dt * 14));
        if (Math.abs(P.pos.y + 5.1 - pivotY) > 12) pivotY = P.pos.y + 5.1;
        pivotV.set(P.pos.x, pivotY, P.pos.z).addScaledVector(rightV, inLobby() ? 0 : 3.1 * (1 - adsK * 0.4));
        backV.copy(dirV).negate();
        let lim = inLobby() ? Math.max(8, cam.dist + 3) : cam.dist * (1 - adsK * 0.45);
        const g = cube.grid;
        if (g) { const r = g.raycast(pivotV.x, pivotV.y, pivotV.z, backV.x, backV.y, backV.z, lim + 1); if (r) lim = Math.min(lim, r.t - 0.7); }
        lim = Math.min(lim, rayHit(pivotV, backV, lim + 1) - 0.7);
        if (backV.y < -1e-3) lim = Math.min(lim, (0.7 - pivotV.y) / backV.y);
        lim = Math.max(1.2, lim);
        camD = lim < camD ? lim : camD + (lim - camD) * (1 - Math.exp(-dt * 4));
        camPos.copy(pivotV).addScaledVector(backV, camD);
    }
    camera.position.copy(camPos);
    camera.lookAt(lookV.copy(camPos).addScaledVector(dirV, 30));
    if (shake > 0.001) {
        const s = shake * shake * 0.8;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.4);
    }
    const want = ((innerWidth < innerHeight ? 82 : 70) + (fp ? 4 : 0) + (sprinting ? 7 : 0)) * (1 - adsK * 0.32) + fovKick;
    fovKick *= Math.exp(-dt * 12);
    // the recoil springs back
    kickV += (-kick * 220 - kickV * 22) * dt;
    kick = Math.max(-0.01, kick + kickV * dt);
    adsK += ((ads && !inLobby() ? 1 : 0) - adsK) * Math.min(1, dt * 12);
    baseFov += (want - baseFov) * Math.min(1, dt * 6);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    snapShadow(P.pos);
    updateSky(camera.position, t, dt);
    updateAmbient(camera.position, t, { color: CUBES[Math.max(0, S.roomLevel || 0)].neon, dir: 0.35 });
    // the character hides when the camera is inside it (first person, or squeezed against the cube)
    if (rig) rig.visible = !fp && camD > 2.2;
    if (rig) placeGun(rig, P.facing, -cam.pitch, P.recoil);
    if (fp) { setViewModel(S.gun || 'blaster'); placeViewModel(dt, t); }
    placeFlash();
}

// =====================================================================================
// Input: mouse aim (pointer lock), or drag-to-look + click / tap-to-blast; touch; controller
// =====================================================================================
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, running = false, locked = false, lockOK = !isTouch, mouseFire = false, fireBtn = false;
let autoFire = storageGet('dtc_auto') !== null ? storageGet('dtc_auto') === '1' : isTouch;
actions.getAuto = () => autoFire;
actions.setAuto = (on) => { autoFire = !!on; storageSet('dtc_auto', on ? '1' : '0'); $('#autoBtn').classList.toggle('on', autoFire); };
function pressJump() { P.jumpPress = clockT; }
function requestLock() {
    try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => lockFallback());
    } catch (e) { lockFallback(); }
}
function lockFallback() {
    if (!lockOK) return;
    lockOK = false;
    toast('🖱️ Drag to look around · click a block to blast it (hold to keep blasting)', '#ffffff');
}
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (!locked) { mouseFire = false; ads = false; } });
document.addEventListener('pointerlockerror', lockFallback);
const freeMouse = () => { if (document.pointerLockElement) document.exitPointerLock(); mouseFire = false; };
actions.onPanel = (open) => { if (open) freeMouse(); };

addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (!running || e.repeat) return;
    if (e.code === 'KeyE' && activePrompt) usePrompt();
    if (/^Digit[1-3]$/.test(e.code)) actions.selectAmmo(AMMO[+e.code.slice(5) - 1].id);
    if (e.code === 'KeyV') { actions.setFP(!isFP()); toast(isFP() ? '👁️ First person' : '🎥 Third person', '#ffffff'); }
    if (e.code === 'KeyF') { actions.setAuto(!autoFire); toast(autoFire ? '🎯 Auto fire ON: aim at the cube!' : '🎯 Auto fire OFF', '#ffffff'); }
    if (e.code === 'Tab') { if (modalIs('upgrades')) closeModal(); else openModal('upgrades'); }
    if (e.code === 'KeyG') { if (modalIs('shop')) closeModal(); else openModal('shop'); }
    if (e.code === 'KeyC') { if (modalIs('cubes')) closeModal(); else openModal('cubes'); }
    if (e.code === 'Escape') { if (closeTop()) return; if (BX.isEmbedded()) BX.showPortalMenu(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseFire = false; fireBtn = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// drags: look around; a short tap blasts where you tapped; holding still keeps blasting there
const drags = new Map();
canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    if (!running || anyPopup()) return;
    if (e.pointerType === 'mouse' && lockOK && !inLobby()) {
        if (!locked) { requestLock(); return; }
        if (e.button === 0) mouseFire = true;
        if (e.button === 2) { ads = true; sfx('ads'); }
        return;
    }
    canvas.setPointerCapture(e.pointerId);
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, mouse: e.pointerType === 'mouse' });
});
canvas.addEventListener('pointermove', (e) => {
    if (locked && e.pointerType === 'mouse') {
        const k = 0.0021 * camSens * (1 - adsK * 0.45);
        cam.yaw -= (e.movementX || 0) * k;
        cam.pitch = clamp(cam.pitch + (e.movementY || 0) * k, -1.25, 1.3);
        return;
    }
    const d = drags.get(e.pointerId);
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) d.moved = true;
    if (d.moved) {
        const k = (e.pointerType === 'touch' ? 0.0068 : 0.0045) * camSens;
        cam.yaw -= (e.clientX - d.x) * k;
        cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -1.25, 1.3);
    }
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => {
    if (e.pointerType === 'mouse' && locked) { if (e.button === 0) mouseFire = false; if (e.button === 2) ads = false; return; }
    const d = drags.get(e.pointerId);
    drags.delete(e.pointerId);
    if (d && e.type === 'pointerup' && !d.moved && performance.now() - d.t0 < 280 && running && !anyPopup()) { lastShot = -9; tryFire(e.clientX, e.clientY); }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
    cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2, 0, 26);
    cam.fp = false;
    e.preventDefault();
}, { passive: false });
(function touchControls() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(e); });
        el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
    };
    hold($('#jumpBtn'), () => { touchJump = true; pressJump(); }, () => { touchJump = false; });
    // FIRE: hold to blast; drag on it to aim at the same time
    let fx = 0, fy = 0;
    hold($('#fireBtn'), (e) => { fireBtn = true; fx = e.clientX; fy = e.clientY; $('#fireBtn').classList.add('on'); }, () => { fireBtn = false; $('#fireBtn').classList.remove('on'); });
    $('#fireBtn').addEventListener('pointermove', (e) => {
        if (!fireBtn) return;
        cam.yaw -= (e.clientX - fx) * 0.0068 * camSens;
        cam.pitch = clamp(cam.pitch + (e.clientY - fy) * 0.0068 * camSens, -1.25, 1.3);
        fx = e.clientX; fy = e.clientY;
    });
    $('#autoBtn').addEventListener('click', () => { actions.setAuto(!autoFire); toast(autoFire ? '🎯 Auto fire ON: just aim at the cube!' : '🎯 Auto fire OFF: hold FIRE', '#ffffff'); });
    $('#fpBtn').addEventListener('click', () => actions.setFP(!isFP()));
    $('#autoBtn').classList.toggle('on', autoFire);
})();

// Proximity prompts (the upgrade computer, the shop counters, the portal)
let activePrompt = null, promptX = -1, promptY = -1;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    for (const p of prompts) {
        const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
        if (d < p.r && d < bd && P.pos.y < 8) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best || anyPopup()) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 4).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    const px = Math.round((projV.x + 1) / 2 * innerWidth), py = Math.round((1 - projV.y) / 2 * innerHeight);
    if (px !== promptX || py !== promptY) { promptX = px; promptY = py; promptEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -110%)`; }
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) { freeMouse(); activePrompt.act(); } }
promptEl.addEventListener('click', usePrompt);

// Controller: popups first, then gameplay (RT fires, LB / RB pick the ball type)
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    if (p.has('B') && closeTop()) return;
    if (!running) return;
    if (p.has('X') && activePrompt) usePrompt();
    if (p.has('Y')) openModal('shop');
    if (p.has('LB') || p.has('RB')) {
        const own = AMMO.filter((a) => S.ammoOwned[a.id]).map((a) => a.id);
        const i = own.indexOf(S.ammoSel);
        actions.selectAmmo(own[(i + (p.has('RB') ? 1 : -1) + own.length) % own.length]);
    }
    if (p.has('BACK')) openModal('cubes');
    if (p.has('START')) openModal('upgrades');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 3, 0, 26);
    if (p.has('DOWN')) { cam.dist = clamp(cam.dist + 3, 0, 26); cam.fp = false; }
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected: RT to blast' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

actions.selectAmmo = (id) => {
    const a = ammoById[id];
    if (!a) return;
    if (!S.ammoOwned[id]) { openModal('shop', 'ammo'); return; }
    if (id !== 'normal' && ammoLeft(id) < 1) { toast(a.ic + ' Out of ' + a.name + '! They refill by themselves', '#ffd28a'); return; }
    S.ammoSel = id;
    sfx('equip');
    renderSlots();
};
actions.goSell = () => { toast('🎒 Walk onto the green SELL pad at the base to sell your cubes!', '#7dff6b'); };

// =====================================================================================
// Shooting. Each ball flies (the GPU draws it) and, when it lands, the hit is worked out here and
// sent to the server: the block it hit, every block it then punched through or bounced to, and the
// ball type. The cube on screen changes straight away (the server confirms a moment later; a hit
// it didn't agree with is put back after a couple of seconds).
// =====================================================================================
let lastShot = -9, lastFireT = -9;
const shots = [], hops = [];
const deadPending = new Map();   // blocks broken here, waiting for their ball to arrive to pop
const tntQueue = [];
const aimO = new V3(), aimD = new V3(), tmpV = new V3(), muzV = new V3(), ndc = new T.Vector2(), raycaster = new T.Raycaster();
function aimRay(sx, sy) {
    if (sx === undefined) { aimO.copy(camera.position); camera.getWorldDirection(aimD); return; }
    ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    aimO.copy(raycaster.ray.origin); aimD.copy(raycaster.ray.direction);
}
// where a ray from o along d first hits something (a block, the ground, a wall)
function aimPoint(o, d) {
    let t = CFG.range + camD, cell = -1, ground = false;
    const g = cube.grid;
    const r = g ? g.raycast(o.x, o.y, o.z, d.x, d.y, d.z, t) : null;
    if (r) { t = r.t; cell = r.c; }
    if (d.y < -1e-4) { const tg = -o.y / d.y; if (tg < t) { t = tg; cell = -1; ground = true; } }
    const tb = rayHit(o, d, t);
    if (tb < t) { t = tb; cell = -1; ground = true; }
    return { point: o.clone().addScaledVector(d, t), cell, ground, t };
}
function muzzleWorld() {
    if (isFP() && vm) return vm.localToWorld(muzV.copy(MUZZLE));
    const u = rig && rig.userData;
    if (u && u.gun) { u.gun.updateMatrixWorld(); return u.gun.localToWorld(muzV.copy(MUZZLE)); }
    return muzV.copy(P.pos).add(tmpV.set(0, 3.5, 0));
}
const ballColor = (ammo) => (ammo === 'normal' ? (skinById[S.ball] || skinById.bubble).color : ammoById[ammo].color);
function tryFire(sx, sy) {
    const now = gt(), my = myStats(), g = my.gun;
    if (inLobby() || now - lastShot < my.cd || !cube.grid || !rig) return false;
    lastShot = now; lastFireT = clockT;
    let ammo = S.ammoSel;
    if (ammo !== 'normal' && ammoLeft(ammo) < 1) {
        toast(ammoById[ammo].ic + ' Out of ' + ammoById[ammo].name + '! Back to Bubble Balls', '#ffd28a');
        ammo = S.ammoSel = 'normal';
    }
    if (ammo !== 'normal') S.spent[ammo] = (S.spent[ammo] || 0) + 1;
    aimRay(sx, sy);
    const muzzle = muzzleWorld().clone();
    const color = ballColor(ammo), size = g.size * (ammo === 'boom' ? 1.35 : 1);
    for (let k = 0; k < g.pellets; k++) {
        const d = aimD.clone();
        if (g.pellets > 1 || g.spread) {
            const fan = g.pellets > 1 ? (k - (g.pellets - 1) / 2) * g.spread * 1.6 : 0;
            const ax = new V3(0, 1, 0), side = new V3().crossVectors(d, ax).normalize();
            d.applyAxisAngle(ax, fan + (Math.random() - 0.5) * g.spread).applyAxisAngle(side, (Math.random() - 0.5) * g.spread).normalize();
        }
        const tgt = aimPoint(aimO, d);
        // from the muzzle to that point: the first block on the way is the one it hits
        const dir = tgt.point.clone().sub(muzzle);
        let dist = dir.length();
        dir.divideScalar(Math.max(1e-6, dist));
        let cell = -1, point = tgt.point;
        const r = cube.grid.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, dist + 2.5);
        if (r) { cell = r.c; dist = r.t; point = muzzle.clone().addScaledVector(dir, r.t); }
        const dur = Math.max(0.035, dist / g.speed);
        balls.fly(muzzle, point, dur, color, size, now);
        shots.push({ at: now + dur, t0: now, dur, cell, point, dir, ammo, gen: cube.gen, muzzle, ground: cell < 0 && tgt.ground, color, size });
    }
    P.recoil = 1; P.aimT = clockT;
    const kk = g.id === 'mega' ? 0.05 : g.id === 'minigun' ? 0.006 : g.id === 'plasma' ? 0.03 : 0.014;
    kickV += kk * 60 * (1 - adsK * 0.5); fovKick += g.id === 'mega' ? 3 : 1;
    flashT = clockT; flashColor = color;
    sprintBlock = clockT;
    kickCrosshair();
    muzzleFlash(muzzle, aimD, color);
    if (g.id === 'mega') { sfx('shootBig'); addShake(0.15); } else sfx('shoot', g.id === 'minigun' ? 1.35 : g.id === 'plasma' ? 0.75 : 1);
    rumble(0.12, 40);
    return true;
}
const tmpN = new V3();
const cx = (c) => cube.grid.wx(c), cy = (c) => cube.grid.wy(c), cz = (c) => cube.grid.wz(c);
// hit points come off right away; how it looks waits for the ball (delay)
function damageCell(c, dmg, mine, dir, delay, quiet) {
    const g = cube.grid;
    if (g.hp[c] <= 0) return;
    g.hp[c] -= dmg;
    cube.pend.set(c, gt());
    if (g.hp[c] > 0) { if (!delay) visHit(c, dmg, dir, mine, quiet); return; }
    g.hp[c] = 0;
    deadPending.set(c, { mine, dir });
    if (g.kind[c] === 3) tntQueue.push([c, mine]);
    if (!delay) visBreak(c, quiet);
}
function visHit(c, dmg, dir, mine, quiet) {
    const g = cube.grid;
    if (!g || g.hp[c] <= 0) return;
    cube.touch(c, U.uTime.value);
    if (quiet) return;
    const nx = dir ? -dir.x : 0, ny = dir ? -dir.y : 0, nz = dir ? -dir.z : 0;
    const p = tmpV.set(cx(c) + nx * 2.6, cy(c) + ny * 2.6, cz(c) + nz * 2.6);
    const col = cube.colorOf(c).getHex();
    hitSpark(p, col, nx, ny, nz);
    if (mine) {
        dmgNums.show(fmt(dmg), p.x, p.y + 1.5, p.z, '#ffffff', 2.6);
        sfxSome('tock', 1, 3);
        if (dir) ring(p, 0xffffff, 1.8, 0.3, tmpN.set(nx, ny, nz));
        hitMarker(false);
    }
}
const nbTmp = [];
function visBreak(c, quiet) {
    const g = cube.grid;
    if (!g) return;
    const info = deadPending.get(c) || { mine: false, dir: null };
    deadPending.delete(c);
    const col = cube.colorOf(c).getHex(), x = cx(c), y = cy(c), z = cz(c), kind = g.kind[c];
    cube.remove(c);
    const now = U.uTime.value;
    // the chunks fly out of the side the ball came in from, and land on what's below
    const d0 = info.dir, nx0 = d0 ? -d0.x : 0, ny0 = d0 ? -d0.y : 0, nz0 = d0 ? -d0.z : 0;
    const floorY = ny0 > 0.7 ? groundAt(g, x, z, y - B / 2 + 0.01) : 0;
    shards.burst(x, y, z, col, quiet ? 3 : 8, 1, now, nx0, ny0, nz0, floorY);
    if (!quiet) breakPuff(tmpV.set(x, y, z), col);
    // the blocks round it wobble like jelly
    for (const n of g.neighbours(c, nbTmp)) if (g.hp[n] > 0) cube.wobble(n, now);
    if (info.mine && !quiet) hitMarker(true);
    if (kind === 1) sfxSome('popGold', 1, 2);
    else if (kind === 2) sfxSome('gem', 1, 2);
    else if (kind !== 3) sfxSome('pop', 1, quiet ? 2 : 4);
    if (info.mine) {
        let nx = info.dir ? -info.dir.x : x, nz = info.dir ? -info.dir.z : z;
        const l = Math.hypot(nx, nz) || 1;
        if (info.dir && Math.abs(info.dir.y) > 0.85) { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); nz = Math.sin(a); } else { nx /= l; nz /= l; }
        drops.spawn(c, g, x, y, z, nx, nz, col, now, g.value(c));
    }
}
// an explosion: every block in reach takes up to dmg (half at the edge)
const sph = [];
let blastFxT = -9, blastFxAt = new V3();
function localBlast(x, y, z, r, dmg, skip, mine) {
    blastFx(tmpV.set(x, y, z), r);
    blastFxT = clockT; blastFxAt.set(x, y, z);
    sfxSome('boom', 1, 2);
    const near = camera.position.distanceTo(tmpV);
    if (near < 70) addShake(0.45 * (1 - near / 70) * Math.min(2, r / 6));
    const g = cube.grid;
    const list = g.sphere(x, y, z, r, sph).slice();
    for (const [c, d] of list) {
        if (c === skip) continue;
        const dir = new V3(g.wx(c) - x, g.wy(c) - y, g.wz(c) - z).normalize().negate();
        damageCell(c, Math.max(1, Math.round(dmg * (1 - 0.5 * d / r))), mine, dir, false, true);
    }
}
function runTnt() {
    const g = cube.grid;
    for (let k = 0; k < 40 && tntQueue.length; k++) {
        const [c, mine] = tntQueue.shift();
        localBlast(g.wx(c), g.wy(c), g.wz(c), TNT_RADIUS * B, TNT_DAMAGE * TIER_HP[g.tier[c]], c, mine);
    }
    tntQueue.length = 0;
}
// A ball reached the cube
function processShot(s) {
    const g = cube.grid;
    if (!g || s.gen !== cube.gen) return;
    let c0 = s.cell;
    if (c0 >= 0 && g.hp[c0] <= 0) {
        const r = g.raycast(s.point.x - s.dir.x, s.point.y - s.dir.y, s.point.z - s.dir.z, s.dir.x, s.dir.y, s.dir.z, 9);
        c0 = r ? r.c : -1;
    }
    if (c0 < 0) { if (s.ground) dust(s.point, 4, 0.6, 0xffffff); return; }
    const my = myStats(), gun = my.gun, chain = [c0];
    for (let k = 0; k < (gun.pierce || 0); k++) {
        const r = g.raycast(s.point.x, s.point.y, s.point.z, s.dir.x, s.dir.y, s.dir.z, 3 * B + 1, (c) => chain.includes(c));
        if (!r || !g.near(chain[chain.length - 1], r.c, 2)) break;
        chain.push(r.c);
    }
    const pierced = chain.length;
    const nb = my.bounces + (s.ammo === 'bouncy' ? ammoById.bouncy.bounces : 0);
    for (let k = 0; k < nb; k++) { const n = bounceTarget(g, chain[chain.length - 1], chain); if (n < 0) break; chain.push(n); }
    net.send('hit', { g: cube.gen, c: chain, a: s.ammo, o: [Math.round(s.muzzle.x * 10) / 10, Math.round(s.muzzle.y * 10) / 10, Math.round(s.muzzle.z * 10) / 10] });
    for (let i = 0; i < pierced; i++) damageCell(chain[i], my.dmg, true, s.dir, false);
    const blast = Math.max(s.ammo === 'boom' ? my.blast : 0, gun.blast || 0);
    if (blast) localBlast(g.wx(c0), g.wy(c0), g.wz(c0), blast, my.dmg, c0, true);
    // the bounces: the ball hops from block to block (their hit points are already off)
    let prev = chain[pierced - 1], t = gt();
    const from = new V3(), to = new V3();
    for (let i = pierced; i < chain.length; i++) {
        const c = chain[i];
        from.set(g.wx(prev), g.wy(prev), g.wz(prev)); to.set(g.wx(c), g.wy(c), g.wz(c));
        const dur = 0.07;
        balls.fly(from, to, dur, s.color, s.size * 0.85, t);
        t += dur;
        const dir = to.clone().sub(from).normalize();
        damageCell(c, my.dmg, true, dir, true);
        hops.push({ at: t, c, dmg: my.dmg, dir, gen: cube.gen });
        prev = c;
    }
    runTnt();
}
function updateShots() {
    const now = gt();
    for (const s2 of shots) {
        const k = (now - s2.t0) / s2.dur;
        if (k < 0 || k > 1) continue;
        trailDot(s2.muzzle.x + (s2.point.x - s2.muzzle.x) * k, s2.muzzle.y + (s2.point.y - s2.muzzle.y) * k, s2.muzzle.z + (s2.point.z - s2.muzzle.z) * k, s2.color, s2.size * 0.9);
    }
    for (let i = shots.length - 1; i >= 0; i--) if (shots[i].at <= now) { const s = shots[i]; shots.splice(i, 1); processShot(s); }
    for (let i = hops.length - 1; i >= 0; i--) {
        const h = hops[i];
        if (h.at > now) continue;
        hops.splice(i, 1);
        if (h.gen !== cube.gen) continue;
        if (deadPending.has(h.c)) visBreak(h.c); else visHit(h.c, h.dmg, h.dir, true);
    }
}
// a couple of seconds after a hit, anything the server never agreed with goes back to its numbers
let reconT = 0;
function reconcile() {
    const g = cube.grid;
    if (!g) return;
    const now = gt();
    for (const [c, t] of cube.pend) {
        if (now - t < 2.4) continue;
        cube.pend.delete(c);
        const s = cube.srv[c];
        if (g.hp[c] === s) continue;
        if (g.hp[c] <= 0 && s > 0) {
            g.hp[c] = s;
            deadPending.delete(c);
            drops.removeId(c);
            cube.restore(c);
            cube.touch(c);
        } else if (s <= 0) {
            g.hp[c] = 0;
            if (!deadPending.has(c)) deadPending.set(c, { mine: false, dir: null });
            visBreak(c, true);
        } else { g.hp[c] = s; cube.touch(c); }
    }
}

// =====================================================================================
// Dropped cubes: fly to you, into the backpack; the sell machine
// =====================================================================================
let grabbedPending = 0, pickT = 0, combo = 0, comboT = -9, sellT = -9, fullT = -9;
const pickQueue = [], reqSizes = [];
function notifyFull() {
    if (clockT - fullT < 3) return;
    fullT = clockT;
    toast('🎒 Inventory full! Sell your cubes at the base (or upgrade your Backpack)', '#ff8a9a');
    sfx('full');
}
function onGrab(d) {
    if (S.passes.InstantSell) { grabbedPending += d.n; return d.n; }
    const room = bagCap() - S.bag.n - grabbedPending;
    if (room <= 0) { notifyFull(); return 0; }
    const take = Math.min(room, d.n);
    grabbedPending += take;
    return take;
}
function onCollect(d) {
    for (const id of d.ids) pickQueue.push(id);
    if (clockT - comboT > 1.4) combo = 0;
    comboT = clockT;
    sfxSome('pickup', combo++, 3);
    collectFx(tmpV.set(P.pos.x, P.pos.y + 3, P.pos.z), (d.r * 255) << 16 | (d.g * 255) << 8 | (d.b * 255));
}
const SELL_AT = new V3(SPOTS.sell.x, 6, SPOTS.sell.z + 6);
function checkSell() {
    if (S.bag.n <= 0 || clockT - sellT < 0.8) return;
    if ((P.pos.x - SPOTS.sell.x) ** 2 + (P.pos.z - SPOTS.sell.z) ** 2 < 6.8 * 6.8 && P.pos.y < 3) { sellT = clockT; sendMove(true); net.send('sell'); }
}

// =====================================================================================
// The guide: where to go next (the tutorial, a full backpack)
// =====================================================================================
const guideV = new V3();
function tutBlock() {
    const g = cube.grid;
    if (!g) return null;
    const dx = -P.pos.x, dz = -P.pos.z, l = Math.hypot(dx, dz) || 1;
    const r = g.raycast(P.pos.x, 2.5, P.pos.z, dx / l, 0, dz / l, 400);
    if (!r) return null;
    return guideV.set(g.wx(r.c), g.wy(r.c) + B / 2, g.wz(r.c));
}
function guide() {
    const st = net.room && net.room.state;
    if (inLobby()) {
        // new players: follow the arrows to QUICK PLAY
        const q = S.q || {};
        if ((q.tut || 0) < TUTORIAL.length && quickPad && !anyPopup()) setGuide(guideV.set(quickPad.x, 1, quickPad.z), P.pos, true); else setGuide(null);
        sellBeamOn(false);
        return;
    }
    if (!st || st.phase !== 0 || switching || anyPopup()) { setGuide(null); sellBeamOn(S.bag.n > 0); return; }
    const instant = !!S.passes.InstantSell, full = !instant && S.bag.n >= bagCap();
    const q = S.q || {}, tut = q.tut < TUTORIAL.length ? TUTORIAL[q.tut].kind : null;
    let target = null;
    if (full || (tut === 'sell' && S.bag.n > 0)) target = guideV.set(SPOTS.sell.x, 0, SPOTS.sell.z);
    else if (tut === 'break') target = tutBlock();
    else if (tut === 'collect') { const d = drops.nearest(P.pos.x, P.pos.z); target = d ? guideV.set(d.x, d.y + 1, d.z) : tutBlock(); }
    else if (tut === 'sell') target = tutBlock();
    else if (tut === 'upgrade') target = guideV.set(SPOTS.computer.x, 0, SPOTS.computer.z);
    setGuide(target, P.pos, true);
    sellBeamOn(S.bag.n > 0 || tut === 'sell');
}

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.name = p.name; this.pid = p.pid;
        this.label = billboard(nameLines(p.name, p.wins), 6, 512, new V3(0, 7.8, 0), this.rig);
        this.labelKey = p.name + '|' + p.wins;
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0; this.recoil = 0;
        this.lastX = p.x; this.lastZ = p.z; this.stepN = 0;
        setGun(this.rig, p.gun);
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        this.name = p.name; this.pid = p.pid;
        const k = 1 - Math.exp(-dt * 12);
        const far = (r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900;
        if (far) r.position.set(p.x, p.y, p.z);
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        // far away: not drawn
        const vis = camera.position.distanceToSquared(r.position) < 320 * 320;
        if (r.visible !== vis) r.visible = vis;
        if (p.av !== this.av) this.setAvatar(p.av);
        setGun(r, p.gun);
        if (!vis) { if (u.gun) u.gun.visible = false; this.lastX = r.position.x; this.lastZ = r.position.z; return; }
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const air = p.anim === 2, moving = p.anim === 1 && this.vel > 1;
        this.recoil = Math.max(0, this.recoil - dt * 6);
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.3) : 0);
        if (air) airPose(u.body); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        u.body.userData.arms[1].rotation.set(-(Math.PI / 2 + p.ap), 0, 0);
        if (this.blox) this.blox.update(dt, { moving, air, speed: this.vel, t, hold: true, aimRx: -1.5708 - p.ap * 0.9 });
        placeGun(r, r.rotation.y, p.ap, this.recoil);
        const stepN = Math.floor(this.phase / Math.PI);
        if (moving && stepN !== this.stepN && camera.position.distanceToSquared(r.position) < 900) surfStep(r.position.y > 0.5 ? 'block' : 'tile', false);
        this.stepN = stepN;
        const key = p.name + '|' + p.wins;
        if (key !== this.labelKey) { this.labelKey = key; this.label.userData.set(nameLines(p.name, p.wins)); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.gun) scene.remove(this.rig.userData.gun);
        scene.remove(this.rig);
    }
}
const seenIds = new Set();
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    seenIds.clear();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            S.name = p.name; S.friends = p.friends; S.pid = p.pid;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; }
            return;
        }
        seenIds.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seenIds.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
}
function clearRemotes() { for (const r of remotes.values()) r.dispose(); remotes.clear(); }
const remoteByPid = (pid) => { for (const r of remotes.values()) if (r.pid === pid) return r; return null; };

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2667` : location.origin);
let lastEndpoint = null;
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) loadingText('Waking up a server…');
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        loadingText('Waking up a server…');
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await sleep(2000);
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), ap: +(-cam.pitch).toFixed(2), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + m.ap + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}
function playerUid() {
    let uid = storageGet('dtc_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('dtc_uid', uid);
    }
    return uid;
}
const sessionOf = (id) => (net.room && id === net.room.sessionId ? rig : remotes.get(id) && remotes.get(id).rig);
const myPid = () => S.pid || 0;

let lastCoins = null, lastGems = null, firstProfile = true, cubeWaiter = null, introDone = false, switching = false;
async function connect(name, endpoint, level) {
    const url = endpoint || await serverEndpoint();
    lastEndpoint = url;
    const client = new Client(url);
    const id = BX.identity();
    const room = await client.joinOrCreate('cube', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('dtc_save') || '', level,
    });
    net.room = room;
    S.roomLevel = level;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => { toast(m.name + ': ' + m.text, '#ffffff'); chatBubble(sessionOf(m.s), m.text); });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    // ----- the cube -----
    room.onMessage('cube', (m) => {
        if (m.lobby) {
            cube.clear(); cube.gen = -2; drops.clearAll(); fallers.clear();
            shots.length = 0; hops.length = 0; deadPending.clear(); tntQueue.length = 0;
            enterPlace('lobby');
            if (cubeWaiter) { cubeWaiter(); cubeWaiter = null; }
            return;
        }
        enterPlace('arena');
        const rebuilt = cube.gen >= 0 && m.level === cube.grid.level && m.gen !== cube.gen;
        cube.load(m, introDone);
        drops.clearAll();
        shots.length = 0; hops.length = 0; deadPending.clear(); tntQueue.length = 0;
        pickQueue.length = 0; reqSizes.length = 0; grabbedPending = 0;
        setTheme(m.level, !rebuilt);
        if (running && insideCube()) { teleport(spawnPos(), SPAWN.yaw); toast('🧊 The new cube pushed you out!', '#9ae8ff'); }
        if (rebuilt && running) { sfx('build'); bigText('🧊 NEW CUBE!', '#9ae8ff'); }
        if (cubeWaiter) { cubeWaiter(); cubeWaiter = null; }
    });
    room.onMessage('cb', (m) => {
        const g = cube.grid;
        if (!g || m.g !== cube.gen) return;
        const me = myPid(), many = m.b.length > 60, now = U.uTime.value;
        for (let i = 0; i < m.b.length; i += 2) {
            const c = m.b[i], pid = m.b[i + 1], mine = pid === me && pid !== 0;
            cube.srv[c] = 0; cube.pend.delete(c);
            if (g.hp[c] > 0) {
                g.hp[c] = 0;
                deadPending.set(c, { mine, dir: null });
                visBreak(c, many);
            } else if (deadPending.has(c)) { if (!mine) deadPending.get(c).mine = false; }
            else if (!mine) drops.removeId(c);
        }
        for (let i = 0; i < m.h.length; i += 2) {
            const c = m.h[i], hp = m.h[i + 1];
            cube.srv[c] = hp;
            if (g.hp[c] <= 0) continue;
            if (cube.pend.has(c)) { if (hp < g.hp[c]) { g.hp[c] = hp; cube.touch(c); } }
            else if (hp !== g.hp[c]) { const hit = hp < g.hp[c]; g.hp[c] = hp; cube.touch(c, hit ? now : undefined); }
        }
        if (m.f && m.f.length) {
            const list = [];
            for (let i = 0; i < m.f.length; i += 2) {
                const c = m.f[i], pid = m.f[i + 1], mine = pid === me && pid !== 0;
                cube.srv[c] = 0; cube.pend.delete(c);
                if (g.hp[c] > 0 || deadPending.has(c)) {
                    const info = deadPending.get(c);
                    deadPending.delete(c);
                    g.hp[c] = 0;
                    list.push({ c, mine: info ? info.mine && mine : mine, col: cube.colorOf(c).getHex(), x: g.wx(c), y: g.wy(c), z: g.wz(c), value: g.value(c) });
                    cube.remove(c);
                } else if (!mine) drops.removeId(c);
            }
            // where each one lands: on top of whatever still stands under it
            for (const b of list) fallers.fall(b.x, b.y, b.z, groundAt(g, b.x, b.z, b.y - B / 2 + 0.01) + B / 2, b.col, now, b);
            if (list.length > 4) { sfx('creak'); if (performance.now() - chunkToastAt > 5000) { chunkToastAt = performance.now(); toast('💥 A chunk broke off!', '#ffd28a'); } }
        }
        for (let i = 0; i < m.x.length; i += 4) {
            const p = tmpV.set(m.x[i], m.x[i + 1], m.x[i + 2]);
            if (clockT - blastFxT < 0.8 && p.distanceTo(blastFxAt) < 8) continue;
            blastFx(p, m.x[i + 3]);
            if (camera.position.distanceTo(p) < 90) sfxSome('boom', 1, 2);
        }
        for (let i = 0; i < m.sh.length; i += 6) {
            const pid = m.sh[i];
            if (pid === me) continue;
            const r = remoteByPid(pid), c = m.sh[i + 4];
            if (r) r.recoil = 1;
            if (c < 0 || c >= g.N) continue;
            const o = new V3(m.sh[i + 1], m.sh[i + 2], m.sh[i + 3]), to = new V3(g.wx(c), g.wy(c), g.wz(c));
            balls.fly(o, to, Math.min(0.2, o.distanceTo(to) / 240), [0x3ad8ff, 0x6aff3a, 0xff8a2a][m.sh[i + 5]] || 0x3ad8ff, 0.5, now);
        }
    });
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('dtc_save', m.save);
        delete m.save;
        if (m.now) net.offset = m.now - Date.now();
        delete m.now;
        Object.assign(S, m);
        S.spent = { bouncy: 0, boom: 0 };
        S.profileAt = Date.now();
        if (lastCoins !== null && S.coins > lastCoins) bumpCoins();
        if (lastGems !== null && S.gems > lastGems) bumpGems();
        lastCoins = S.coins; lastGems = S.gems;
        if (S.ammoSel !== 'normal' && !S.ammoOwned[S.ammoSel]) S.ammoSel = 'normal';
        if (firstProfile) {
            firstProfile = false;
            if (S.unlocked > 0 && S.roomLevel >= 0 && S.unlocked > S.roomLevel && storageGet('dtc_level') === null) setTimeout(() => toast('🧊 Your best cube is Cube ' + (S.unlocked + 1) + ': open CUBES to go there!', '#9ae8ff'), 3000);
        }
        renderSlots(); refreshModal(); refreshDaily();
        openDailyOnJoin();
    });
    room.onMessage('bag', (m) => {
        S.bag = { n: m.n, v: m.v };
        grabbedPending = Math.max(0, grabbedPending - (reqSizes.shift() || 0));
        if (m.full && !S.passes.InstantSell) notifyFull();
    });
    room.onMessage('sold', (m) => {
        if (m.instant) { floatText('+$' + fmt(m.coins), '#ffe24a', P.pos.clone().add(tmpV.set(0, 7.5, 0)), 3); sfxSome('coin', 1, 1); }
        else {
            coinFountain(SELL_AT, 34);
            floatText('+$' + fmt(m.coins), '#ffe24a', SELL_AT.clone().add(tmpV.set(0, 7, -3)), 8, true);
            sfx('sell'); flash('#ffe24a', 350, 0.22); rumble(0.4, 150);
            toast('💰 Sold ' + fmt(m.n) + ' cubes for ' + fmt(m.coins) + ' Coins!', '#ffe24a');
        }
        bumpCoins();
    });
    room.onMessage('quest', (m) => {
        if (m.tut !== undefined) {
            const step = TUTORIAL[m.tut];
            sfx('quest');
            if (m.done) {
                setTimeout(() => { questPop('+' + m.gems + ' GEMS', 'Tutorial complete!'); bigText('DESTROY THE CUBE!', '#ffe24a'); sfx('questBig'); confetti(P.pos); }, 400);
            } else bigText('✔ ' + step.text + '!', '#8aff7a');
        } else {
            questPop('+' + m.gems + ' GEM' + (m.gems > 1 ? 'S' : ''), 'Quest complete!');
            bigText('QUEST COMPLETE!', '#ffffff');
            sfx('quest');
        }
        sparkleColumn(P.pos, 0xd23cff);
    });
    room.onMessage('gem', (m) => {
        const g = cube.grid;
        if (!g) return;
        floatText('+1 💎', '#f0a8ff', new V3(g.wx(m.c), g.wy(m.c) + 4, g.wz(m.c)), 4, true);
        bumpGems();
    });
    room.onMessage('destroyed', (m) => {
        showDestroyed(m);
        freeMouse();
        sfx('destroyed'); rumble(1, 600); flash('#ffffff', 700, 0.6);
        const top = CUBES[m.level].n * B;
        fireworks(new V3(0, top * 0.5, 0), 18, () => sfxSome('firework', 1, 2));
        confetti(P.pos);
    });
    room.onMessage('upgraded', (m) => {
        const u = upgradeById[m.id];
        sfx('upgrade');
        sparkleColumn(P.pos, 0x5ae0ff);
        ring(P.pos, 0x5ae0ff, 9, 0.7);
        if (u) toast(u.ic + ' ' + u.name + ' upgraded!', '#8affff');
    });
    room.onMessage('fx', (m) => {
        sfx(m.kind === 'boost' ? 'buy' : 'unlock');
        sparkleColumn(P.pos, 0xffd21e); ring(P.pos, 0xffd21e, 10, 0.8); confetti(P.pos);
        if (m.what === 'gun') setTimeout(() => toast('🔫 Equipped! Try it on the cube', '#ffffff'), 600);
    });
    room.onMessage('goLevel', (m) => { setTimeout(() => actions.goLevel(m.level, true), 300); });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('broke', (m) => { notEnough(m); sfx('denied'); });
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('boards', renderBoards);
    room.onLeave((code) => {
        if (net.room === room) net.room = null;
        if (!switching && code !== 1000) $('#offline').hidden = false;
    });
    return room;
}
// Off to another cube: a quick warp to a room playing that one
actions.goLevel = async (L, forced) => {
    L = L === -1 ? -1 : clamp(L | 0, 0, LEVELS - 1);
    if (switching) return;
    if (net.room && L === S.roomLevel) { toast(L < 0 ? '🏠 You are in the lobby!' : '🧊 You are on this cube already!', '#9ae8ff'); return; }
    if (L >= 0 && !forced && !levelOpen(S, L)) { toast('🔒 Destroy Cube ' + L + ' first!', '#ffb0b0'); sfx('denied'); return; }
    switching = true;
    hideDestroyed(); closeModal(); freeMouse();
    showWarp(L);
    sfx('teleport');
    if (L >= 0) storageSet('dtc_level', String(L));
    const old = net.room;
    net.room = null;
    try { if (old) await old.leave(true); } catch (e) { /* gone anyway */ }
    clearRemotes();
    drops.clearAll();
    shots.length = 0; hops.length = 0;
    setWarp(0.35, 'Finding a server…');
    const wait = new Promise((res) => { cubeWaiter = res; });
    for (let attempt = 0; ; attempt++) {
        try { await connect('', attempt ? null : lastEndpoint, L); break; } catch (e) {
            console.warn('[warp]', e && e.message);
            if (attempt >= 3) { hideWarp(); switching = false; $('#offline').hidden = false; return; }
            await sleep(1200 * (attempt + 1));
        }
    }
    setWarp(0.75, L < 0 ? 'Landing in the lobby…' : 'Building the cube…');
    await Promise.race([wait, sleep(6000)]);
    setWarp(1, 'Ready!');
    teleport(spawnPos(), SPAWN.yaw);
    cam.pitch = 0.06;
    if (L >= 0) U.uBuild.value = 0;
    await sleep(300);
    hideWarp();
    switching = false;
    if (L < 0) { bigText('🏠 LOBBY', '#ffffff'); return; }
    const def = CUBES[L];
    bigText(def.ic + ' ' + def.name.toUpperCase() + '!', '#ffffff');
    toast(def.n + '×' + def.n + '×' + def.n + ' blocks: destroy it for ' + fmt(def.clear.coins) + ' Coins + ' + def.clear.gems + ' Gems!', '#9ae8ff');
};

// =====================================================================================
// The two places: the lobby (third person, pads, shops) and a cube's arena (first person, blasting)
// =====================================================================================
function enterPlace(p) {
    place = p;
    setPlace(p);
    setLobbyVisible(p === 'lobby');
    cube.mesh.visible = p === 'arena';
    cube.hidden = p !== 'arena';
    document.body.classList.toggle('inLobby', p === 'lobby');
    if (p === 'lobby') { setMood('lobby', true); ads = false; freeMouse(); cam.dist = 15; }
    else if (cam.dist > 13) cam.dist = 13;
    refreshNear();
    if (running) showTips();
}
let padOn = null, padT = 0, padWarned = null, countsT = 0, lobbyCountsV = {};
function lobbyPadsUpdate(dt) {
    const p = P.pos.y < 3 ? padAt(P.pos.x, P.pos.z) : null;
    if (p !== padOn) { padOn = p; padT = 0; if (p && p !== quickPad && !p.open && padWarned !== p) { padWarned = p; toast('🔒 Destroy Cube ' + p.level + ' first to open ' + CUBES[p.level].name + '!', '#ffb0b0'); sfx('denied'); } if (!p) padWarned = null; }
    const usable = p && (p === quickPad || p.open) && !switching && !anyPopup();
    padT = usable ? padT + dt : 0;
    const k = Math.min(1, padT / 1.3);
    padCharge(usable ? p : null, k);
    setPadHint(usable ? (k < 1 ? '⏳ Warping to ' + CUBES[p.level].name + '… ' + Math.ceil((1.3 - padT) * 10) / 10 + 's' : '🚀 GO!') : null);
    if (usable && padT >= 1.3) { padT = -99; actions.goLevel(p.level); }
}
// how many are playing each cube (the pads show it)
function lobbyCounts() {
    countsT -= 0.1;
    setPadInfo(S, lobbyCountsV);
    if (countsT > 0) return;
    countsT = 8;
    // straight from the game's host (Bloxity's matchmaking gateway only passes the room traffic)
    const base = String(SERVER_URL).replace(/^ws/, 'http').replace(/\/$/, '');
    fetch(base + '/api/rooms', { cache: 'no-store' }).then((r) => r.json()).then((m) => { lobbyCountsV = m || {}; }).catch(() => {});
}
// a falling chunk hit the ground: it shatters (and drops its cubes for whoever cut it loose)
let crashT = -9;
function onLand(b) {
    const now = U.uTime.value;
    shards.burst(b.x, b.y, b.z, b.col, 5, 1.1, now, 0, 0.6, 0, b.y - B / 2);
    dust(tmpV.set(b.x, b.y - B / 2, b.z), 6, 1.6, 0xf0f0f4);
    if (clockT - crashT > 0.08) { crashT = clockT; sfxSome('crash', 1, 2); const d = camera.position.distanceTo(tmpV.set(b.x, b.y, b.z)); if (d < 60) addShake(0.12 * (1 - d / 60)); }
    if (b.mine && cube.grid) { const a = Math.random() * Math.PI * 2; drops.spawn(b.c, cube.grid, b.x, b.y, b.z, Math.cos(a), Math.sin(a), b.col, now, b.value); }
}
let sprintBlock = -9, padAimWas = false;

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false, fire: false };
let clockT = 0, hudT = 0, metaT = 20;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();
function land(g, hard) {
    surfStep(surfaceOf(g), true);
    dust(P.pos, hard ? 10 : 5, hard ? 1.3 : 0.9);
    if (hard) ring(P.pos, 0xffffff, 4, 0.35);
    P.squashV -= hard ? 8 : 4;
}
const surfaceOf = (g) => (!g ? 'tile' : g.cube ? 'block' : g.mat === 'grass' ? 'grass' : g.mat === 'metal' || g.mat === 'floor' || g.mat === 'wall' ? 'metal' : g.mat === 'wood' ? 'wood' : 'tile');
const aimHit = { on: false };
function update(dt) {
    clockT += dt;
    const t = clockT;
    U.uTime.value = gt();
    if (U.uBuild.value < 99) { U.uBuild.value += dt; if (U.uBuild.value > 5) U.uBuild.value = 99; }
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.6 * dt * camSens;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.7 * dt * camSens, -1.25, 1.3);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if ((anyPopup() && !isTouch) || switching) mv.set(0, 0, 0);
    P.moving = mv.lengthSq() > 0.01;
    if (clockT - nearT > 0.25) { nearT = clockT; refreshNear(); }

    // ----- jumping, gravity -----
    const pressed = t - P.jumpPress < 0.2;
    if (P.onGround) P.coyote = 0.1; else P.coyote -= dt;
    if (pressed && (P.onGround || P.coyote > 0)) {
        P.vel.y = CFG.jumpV; P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
        sfx('jump'); P.squashV += 5;
    }
    P.vel.y -= CFG.grav * dt;
    // ----- moving -----
    // sprint: Shift (or L3, or the stick pushed all the way on a phone); firing stops it a moment
    const wantSprint = P.moving && P.onGround !== null && (keys.ShiftLeft || keys.ShiftRight || pad.sprint || (isTouch && Math.hypot(touchMove.x, touchMove.y) > 0.92)) && clockT - sprintBlock > 0.45 && !ads;
    if (wantSprint && !sprinting && P.onGround) sfx('whoosh');
    sprinting = wantSprint;
    const ws = CFG.walk * (sprinting ? CFG.sprint : 1) * (adsK > 0.5 ? 0.7 : 1);
    P.hv.set(mv.x * ws, 0, mv.z * ws);
    const vx = P.hv.x, vz = P.hv.z;
    const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.5));
    const sdt = dt / n;
    const wasOn = P.onGround;
    P.onGround = false; P.ground = null;
    let vy = P.vel.y + 0.5 * CFG.grav * dt;
    for (let i = 0; i < n; i++) {
        moveAxis('x', vx * sdt); moveAxis('z', vz * sdt);
        const before = P.vel.y;
        moveAxis('y', vy * sdt);
        if (P.vel.y !== before) vy = P.vel.y;
    }
    if (!P.onGround && wasOn && P.vel.y <= 0) groundProbe(0.7);
    else if (!P.onGround && P.vel.y <= 0) groundProbe(0.05);
    if (P.onGround) {
        if (P.airTime > 0.25 && P.ground) land(P.ground, P.airTime > 0.8);
        P.airTime = 0; P.peakY = P.pos.y;
    } else { P.airTime += dt; P.peakY = Math.max(P.peakY, P.pos.y); }
    // stuck inside a block (the cube grew back round you, a hit got undone): pop up on top
    if (cube.grid && insideCube()) { P.pos.y = groundAt(cube.grid, P.pos.x, P.pos.z, cube.grid.top + 1) + 0.01; P.vel.y = 0; }
    const ox = inLobby() ? LOBBY.x : 0, oz = inLobby() ? LOBBY.z : 0, R2 = (P.pos.x - ox) ** 2 + (P.pos.z - oz) ** 2;
    if (R2 > 560 * 560) { const k = 560 / Math.sqrt(R2); P.pos.x = ox + (P.pos.x - ox) * k; P.pos.z = oz + (P.pos.z - oz) * k; }
    if (P.pos.y < -60) { teleport(spawnPos(), SPAWN.yaw); toast('☁️ Whoops! Back to the plaza', '#ffffff'); }
    // the lobby's pads: stand on one a moment to warp into its cube
    if (inLobby()) lobbyPadsUpdate(dt);

    // ----- aiming, shooting -----
    lookDir(dirV);
    const fp = isFP();
    const aimYaw = Math.atan2(dirV.x, dirV.z);
    if (fp || clockT - P.aimT < 0.7) P.facing = lerpAngle(P.facing, aimYaw, 1 - Math.exp(-dt * 20));
    else if (P.moving) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));
    P.recoil = Math.max(0, P.recoil - dt * 7);
    // what the crosshair is on (auto fire, the yellow crosshair)
    aimHit.on = false; aimHit.c = -1;
    if (cube.grid && running && !switching && !inLobby()) {
        const r0 = cube.grid.raycast(camera.position.x, camera.position.y, camera.position.z, dirV.x, dirV.y, dirV.z, CFG.range + camD);
        aimHit.on = !!r0;
        if (r0) aimHit.c = r0.c;
    }
    U.uAimSlot.value = aimHit.c >= 0 ? cube.slotOf[aimHit.c] : -1;
    setCrosshair(aimHit.on);
    const busy = anyPopup() || switching || !running;
    if (pad.aim !== padAimWas) { ads = pad.aim; padAimWas = pad.aim; }
    let fireNow = !busy && !inLobby() && (mouseFire || fireBtn || pad.fire || botInput.fire || (autoFire && aimHit.on));
    if (fireNow) tryFire();
    // holding still on a tap (drag mode): keep blasting there
    if (!busy) for (const d of drags.values()) if (!d.moved && performance.now() - d.t0 > 260) tryFire(d.x, d.y);
    updateShots();
    runTnt();
    reconT -= dt;
    if (reconT <= 0) { reconT = 0.5; reconcile(); }

    // ----- dropped cubes, selling -----
    U.uPlayer.value.set(P.pos.x, P.pos.y + 3, P.pos.z);
    drops.update(U.uTime.value, cube.grid, P.pos.x, P.pos.y, P.pos.z, myStats().range, onGrab, onCollect);
    fallers.update(U.uTime.value, onLand);
    if (pickQueue.length && clockT - pickT > 0.12) {
        pickT = clockT;
        const ids = pickQueue.splice(0, 400);
        reqSizes.push(ids.length);
        sendMove(true);
        net.send('pick', { g: cube.gen, ids });
    }
    checkSell();

    updateEffects(dt);
    updateFx(dt);
    dmgNums.update(dt);
    for (const fn of tickers) fn(dt, t);
    syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // ----- the local character -----
    if (rig) {
        const u = rig.userData;
        rig.position.copy(P.pos);
        rig.rotation.y = P.facing;
        setGun(rig, S.gun);
        const hs = P.moving ? ws : 0;
        if (rig.visible === false && isFP()) { /* first person: the body isn't drawn */ }
        P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.3) : 0);
        if (!P.onGround) airPose(u.body); else if (P.moving) animRig(u.body, P.animPhase, 0.85); else animRig(u.body, 0, 0);
        u.body.userData.arms[1].rotation.set(-(Math.PI / 2 - cam.pitch), 0, 0);
        if (localAvatar) localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround, vy: P.vel.y, speed: hs, t, hold: true, sprint: sprinting, aimRx: -1.5708 + cam.pitch * 0.9 });
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && stepN !== P.lastStepN && P.ground) surfStep(surfaceOf(P.ground), false);
        P.lastStepN = stepN;
        const own = !localAvatar;
        u.pivot.position.y = PIVOT + (own && P.onGround && P.moving ? Math.abs(Math.sin(P.animPhase)) * 0.18 : 0);
        const leanTo = !own ? 0 : P.onGround && P.moving ? 0.12 : !P.onGround ? -0.06 : 0;
        P.lean += (leanTo - P.lean) * Math.min(1, dt * 9);
        u.pivot.rotation.set(P.lean, 0, 0);
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.72, 1.28);
        const sq = own ? P.squash : 1;
        rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    }
    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) {
        hudT = 0.1;
        const st = net.room && net.room.state;
        updateHud(st && (st.total || st.lobby) ? st : null);
        guide();
        hints();
        targetInfo();
        if (inLobby()) lobbyCounts();
        setMusicIntensity(!st || st.phase !== 0 || anyPopup() ? 0 : clockT - lastFireT < 3 ? 2 : 1);
    }
    metaT -= dt;
    if (metaT <= 0) { metaT = 30; net.send('meta', { touch: isTouch, fps: lastFps }); }
}
let lastFps = 60;
// the block you're aiming at: its name and hit points under the crosshair
let lastTarget = '';
function targetInfo() {
    const g = cube.grid, c = aimHit.c;
    if (!g || c < 0 || g.hp[c] <= 0 || inLobby()) { if (lastTarget) { lastTarget = ''; setTarget(null); } return; }
    const k = g.kind[c], name = k ? KINDS[k].name : TIER_NAMES[g.tier[c]] + ' Block' + (g.depth[c] >= 2 ? ' (inner)' : '');
    const key = c + '|' + g.hp[c];
    if (key === lastTarget) return;
    lastTarget = key;
    setTarget({ name, hp: g.hp[c], max: g.maxHp[c], color: cube.colorOf(c).getHexString(), value: g.value(c) });
}
function hints() {
    if (inLobby()) { setHint(''); return; }
    if (isTouch || !running || anyPopup() || switching) { setHint(''); return; }
    if (lockOK && !locked) setHint('🖱️ Click to aim and blast · WASD to move');
    else setHint('');
}

// =====================================================================================
// Boot
// =====================================================================================
let frameErrors = 0, chunkToastAt = 0;
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false, skipOdd = false, oddFrame = false;
const fpsWatch = { t: 0, low: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) return;
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 3) return;
    fpsWatch.low = fps < 40 ? fpsWatch.low + 0.5 : 0;
    if (fpsWatch.low < 2.5) return;
    fpsWatch.low = 0;
    const next = { high: 'medium', medium: 'low' }[getQuality()];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    requestAnimationFrame(frame);
    // phones with 120 Hz screens: a steady 60 (cooler, no throttling later)
    if (skipOdd) { oddFrame = !oddFrame; if (oddFrame) return; }
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) {
        const fps = fpsFrames / fpsAcc;
        lastFps = Math.round(fps);
        if (showFps) $('#fps').textContent = lastFps + ' FPS';
        if (isTouch && !skipOdd && fps > 100) skipOdd = true;
        watchFps(fps); fpsAcc = 0; fpsFrames = 0;
    }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running) {
        try {
            update(dt);
            updateCamera(dt);
            cube.flush(); shards.flush(); balls.flush(); fallers.flush(); drops.dirty.flush();
            render();
        } catch (e) {
            if (frameErrors++ < 5) console.error('[frame]', e);
        }
    }
}
function loadingText(t) { $('#loading').textContent = t; }

let joining = false, joinTask = null, worldReady = null;
const startLevel = () => clamp(parseInt(storageGet('dtc_level') || '0', 10) || 0, 0, LEVELS - 1);
const START_ROOM = -1;   // every visit starts in the lobby (the reference's)
async function joinServer() {
    const endpointTask = serverEndpoint();
    endpointTask.catch(() => {});
    await waitForLogin(400);
    const saved = (storageGet('dtc_name') || '').slice(0, 20);
    for (let attempt = 0; ; attempt++) {
        try { return await connect(BX.identity().loggedIn ? '' : saved, attempt === 0 ? await endpointTask : null, START_ROOM); } catch (e) {
            if (attempt >= 4) throw e;
            console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
            loadingText('Waking up a server…');
            await sleep(2000 * (attempt + 1));
        }
    }
}
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    if (!joinTask) joinTask = joinServer();
    initAudio();
    try {
        await worldReady;
        loadingText('Joining…');
        $('#loadBar').style.width = '90%';
        BX.loadingStep('Joining a server…');
        await joinTask;
        if (cube.gen === -1) { const wait = new Promise((res) => { cubeWaiter = res; }); await Promise.race([wait, sleep(6000)]); }
    } catch (e) {
        joinTask = null;
        console.error(e);
        joining = false;
        loadingText('');
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    running = true;
    S.joinedAt = Date.now();
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleport(spawnPos(), SPAWN.yaw);
    introDone = true;
    showTips();
    setTimeout(() => bigText('DESTROY THE CUBE!', '#ffe24a'), 500);
    toast('💥 Welcome! Step on a pad to start a game (QUICK PLAY in the middle)', '#ffffff');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere for the sound!', '#7de8ff'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
// the keys, once per place (the lobby has no blasting)
const tipsShown = {}, tipsT = [];
function showTips() {
    if (isTouch || tipsShown[place]) return;
    tipsShown[place] = true;
    const el = $('#tips'), lobby = place === 'lobby';
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? (lobby ? k('L', 'Move') + k('L3', 'Sprint') + k('A', 'Jump') + k('X', 'Use')
            : k('L', 'Move') + k('R', 'Look') + k('RT', 'Blast') + k('LT', 'Aim') + k('A', 'Jump') + k('LB/RB', 'Balls') + k('X', 'Use'))
        : lobby ? k('WASD', 'Move') + k('Shift', 'Sprint') + k('Space', 'Jump') + k('E', 'Use') + k('Tab', 'Upgrades')
            : k('WASD', 'Move') + k('Click', 'Blast') + k('Right click', 'Aim') + k('Shift', 'Sprint') + k('Space', 'Jump') + k('1-3', 'Balls') + k('V', 'Camera') + k('F', 'Auto fire');
    el.hidden = false; el.style.opacity = 1;
    for (const t of tipsT) clearTimeout(t);
    tipsT.length = 0;
    tipsT.push(setTimeout(() => { el.style.opacity = 0; }, 12000), setTimeout(() => { el.hidden = true; }, 12900));
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (running) teleport(spawnPos(), SPAWN.yaw); }
        else if (event === 'open_daily') openDaily();
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}

// ----- build the arena and warm up the GPU while the loading screen is up -----
const pause = () => new Promise((r) => setTimeout(r, 0));
async function prepareWorld() {
    const step = (t, k) => { loadingText(t); BX.loadingStep(t); if (k) $('#loadBar').style.width = Math.round(k * 100) + '%'; };
    step('Loading fonts…', 0.12);
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('900 40px Montserrat')]), sleep(2500)]); } catch (e) { /* fallback font */ }
    step('Building the arena…', 0.3);
    await buildWorld(pause);
    step('Building the lobby…', 0.42);
    await buildLobby(pause);
    // a stand-in cube until the server's arrives (the block shader needs something to compile).
    // Already in the lobby (-2, the join beat the world build): an empty one, and keep the lobby.
    if (cube.gen === -1) { cube.load({ level: startLevel(), seed: 1, gen: -1 }, false); cube.gen = -1; setTheme(startLevel(), true); }
    else if (cube.gen === -2) { cube.load({ level: startLevel(), seed: 1, gen: -1 }, false); cube.clear(); cube.gen = -2; }
    refreshNear();
    step('Charging the blaster…', 0.55);
    camera.position.set(SPAWN.x, 8, SPAWN.z + 14); camera.lookAt(0, 20, 0); camera.updateMatrixWorld();
    // stand-ins for the warm-up: the player model, every blaster (in the world and in first
    // person), one of each effect. Never disposed (that keeps their shaders alive).
    const extras = [fxWarmGroup()];
    const blocky = buildRig({ ...KITS[0], skin: SKINS[0] }); blocky.position.set(0, 0, 60); extras.push(blocky);
    const vmExtras = [];
    for (const g of GUNS) {
        const m = blasterModel(g.id); m.position.set(0, 4, 60); extras.push(m);
        const f = blasterModel(g.id, true); f.position.set(0, 4, 60); vmExtras.push(f);
    }
    for (const f of vmExtras) vmScene.add(f);
    try {
        const base = await Promise.race([loadBase(), sleep(4000)]);
        const a = base ? await createAvatar(null) : null;
        if (a) {
            a.root.position.set(0, 0, 60);
            a.update(1 / 60, { t: 0, hold: true });
            extras.push(a.root, avatarVariants(a.root));
        }
    } catch (e) { /* the player model's shaders compile when it first shows instead */ }
    for (const o of extras) scene.add(o);
    fxShowAll(true);
    step('Polishing the cube…', 0.75);
    await warmUp(renderer, camera, pause, [vmScene]);
    render();
    fxShowAll(false);
    for (const o of extras) scene.remove(o);
    for (const f of vmExtras) vmScene.remove(f);
    console.info('[prewarm] ready,', renderer.info.programs.length, 'shaders');
}
function avatarVariants(root) {
    const tex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    const g = new T.Group();
    g.position.set(0, 0, 60);
    let sk = null;
    root.traverse((c) => { if (!sk && c.isSkinnedMesh) sk = c; });
    if (sk) {
        const s = new T.SkinnedMesh(sk.geometry, new T.MeshLambertMaterial({ map: tex }));
        s.bind(sk.skeleton, sk.bindMatrix);
        s.castShadow = true; s.receiveShadow = true;
        g.add(s);
    }
    const m = new T.Mesh(new T.BoxGeometry(0.1, 0.1, 0.1), new T.MeshLambertMaterial({ map: tex }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
}
async function boot() {
    BX.initBloxity();
    // first person in the arena by default, like the reference
    cam.fp = storageGet('dtc_fp') !== '0';
    setOverlay(vmScene, () => running && isFP() && !switching);
    joinTask = joinServer();
    joinTask.catch(() => {});
    loadBase().catch(() => {});
    worldReady = prepareWorld();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    addEventListener('pagehide', () => { try { if (net.room) net.room.leave(true); } catch (e) { /* closing anyway */ } });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        P, S, cam, cube, drops, fallers, net, scene, camera, renderer: () => renderer, audio: () => audioDebug(),
        input: (o) => Object.assign(botInput, o), jump: () => pressJump(),
        teleport: (x, y, z, yaw) => teleport(new V3(x, y, z), yaw),
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; if (dist !== undefined) cam.dist = dist; },
        // point the view at a world point (from the player's head)
        aimAt: (x, y, z) => { const d = new V3(x - P.pos.x, y - (P.pos.y + 4.6), z - P.pos.z).normalize(); cam.pitch = -Math.asin(d.y); cam.yaw = Math.atan2(-d.x, -d.z); },
        fire: () => { lastShot = -9; return tryFire(); },
        quality: (q) => setQuality(q), fp: (on) => actions.setFP(on), auto: (on) => actions.setAuto(on),
        goLevel: (L) => actions.goLevel(L, true),
        state: () => ({
            x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), onGround: P.onGround, ground: P.ground && (P.ground.cube ? 'block' : P.ground.mat),
            level: S.roomLevel, coins: S.coins, gems: S.gems, bag: S.bag, alive: cube.grid ? cube.alive() : -1, shown: cube.count, gen: cube.gen,
            drops: drops.list.length, fp: isFP(), locked, tut: S.q && S.q.tut, phase: net.room && net.room.state.phase, programs: renderer.info.programs.length,
        }),
        sim: (secs, f, jumpEvery) => { for (let i = 0; i < Math.round(secs * 60); i++) { if (jumpEvery && i % jumpEvery === 0) pressJump(); botInput.f = f || 0; update(1 / 60); updateCamera(1 / 60); } botInput.f = 0; return window.__qa.state(); },
        step: (n) => { for (let i = 0; i < n; i++) { update(1 / 60); updateCamera(1 / 60); } return window.__qa.state(); },
        frame: () => { updateCamera(1 / 60); cube.flush(); shards.flush(); balls.flush(); fallers.flush(); drops.dirty.flush(); render(); },
        place: () => place, pads: () => lobbyPads, sprint: (on) => { keys.ShiftLeft = !!on; }, ads: (on) => { ads = !!on; },
    };
}
