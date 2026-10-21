// HUD and panels: the cube's progress bar along the top (with its name, the timer and the
// tutorial step, like the reference), Coins / Gems and the two quests on the left (below the
// Bloxity overlay's corner), the backpack bottom left, the big Upgrades / Shop / Cubes / Instant
// Sell buttons on the right, the menu icons top right, the ball types on the hotbar, the crosshair,
// the quest pop-ups, the CUBE DESTROYED! card, the warp between cubes and every panel.
import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import { sfx, sfxSome, setMusicDuck, getVolumes, setVolume } from './audio.js';
import * as BX from './bloxity.js';
import { getQuality, setQuality } from './fx.js';
import {
    CFG, CUBES, LEVELS, UPGRADES, upLevel, upValue, upCost, GUNS, gunById, AMMO, ammoById, PASSES, BOOSTS, BALL_SKINS, TUTORIAL, QUEST_TEXT,
    questAt, GIFTS, DAILY, dailyStatus, rewardText, fmt, fmtComma, clock, playtimeText, stats, coinMult, levelOpen, cubeBlocks,
} from '../../shared/config.js';

const C = (n) => '<span class="cup"></span>' + fmt(n);
const G = (n) => '💎 ' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const promptEl = $('#promptBtn'), promptTxtEl = $('#promptTxt');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
// Every button clicks
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) sfx(b.classList.contains('g-green') ? 'clickBuy' : 'click'); }, true);

// ----- Coins / Gems counters (count up smoothly) -----
let shownCoins = 0, shownText = -1, shownGems = -1;
export function animateCounters(dt) {
    if (Math.abs(shownCoins - S.coins) < 0.5) shownCoins = S.coins;
    else shownCoins += (S.coins - shownCoins) * Math.min(1, dt * 8);
    const n = Math.round(shownCoins);
    if (n !== shownText) { shownText = n; setText($('#coinVal'), n < 1e6 ? fmtComma(n) : fmt(n)); }
    if (S.gems !== shownGems) { shownGems = S.gems; setText($('#gemVal'), fmtComma(S.gems)); }
}
const replay = (el, cls) => { el.classList.remove(cls); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add(cls))); };
export function bumpCoins() { replay($('#coinPill'), 'bump'); }
export function bumpGems() { replay($('#gemPill'), 'bump'); }

// ----- what the player can do right now -----
export const myStats = () => stats(S, net.now());
export function ammoLeft(id) {
    const a = ammoById[id];
    if (!a || id === 'normal') return Infinity;
    if (!S.ammoOwned[id]) return 0;
    const at = S.ammo.at || net.now();
    return Math.max(0, Math.min(a.max, (S.ammo[id] || 0) + Math.max(0, net.now() - at) / 1000 / a.regen) - (S.spent[id] || 0));
}
export const bagCap = () => myStats().inv;

// =====================================================================================
// HUD refresh (10x a second, only touching what changed)
// =====================================================================================
const sessionSecs = () => (S.sessionSecs || 0) + (Date.now() - S.profileAt) / 1000;
let lastPct = -1;
export function updateHud(st) {
    const now = net.now();
    // the lobby: how many are here, the console line
    if (st && st.lobby) {
        let n = 0; if (st.players) st.players.forEach(() => { n++; });
        setText($('#cubeLine'), '🏠 LOBBY · ' + n + ' player' + (n === 1 ? '' : 's') + ' here');
    } else if (st) {
        const total = Math.max(1, st.total), left = st.left;
        const pct = st.phase === 0 ? Math.min(99, Math.floor((1 - left / total) * 100)) : 100;
        if (pct !== lastPct) { lastPct = pct; $('#progFill').style.width = pct + '%'; }
        setText($('#progTxt'), st.phase === 0 ? pct + '% Progress' : '💥 DESTROYED! New cube in ' + Math.max(0, Math.ceil((st.nextAt - now) / 1000)) + 's');
        const def = CUBES[st.level];
        const secs = st.phase === 0 ? (now - st.startAt) / 1000 : 0;
        setText($('#cubeLine'), def.ic + ' Cube ' + (st.level + 1) + ': ' + def.name + (st.phase === 0 ? ' · ⏱ ' + clock(secs) + ' · ' + fmtComma(left) + ' blocks left' : ''));
    }
    // tutorial or quests
    const q = S.q || {};
    const lobby = !!(st && st.lobby);
    const tut = q.tut < TUTORIAL.length && !(lobby && q.tut > 0) ? TUTORIAL[q.tut] : null;
    $('#tutBanner').hidden = !tut;
    if (tut && lobby) {
        setText($('#tutTxt'), 'Go to a pad to start a game!');
        setText($('#tutTip'), 'Follow the arrows to QUICK PLAY');
        $('#tutBar i').style.width = '0%';
        setHtml($('#quests'), '');
    } else if (tut) {
        setText($('#tutTxt'), tut.text + (tut.n > 1 ? ' (' + Math.min(q.pt, tut.n) + '/' + tut.n + ')' : ''));
        setText($('#tutTip'), tut.tip);
        const tw = Math.round(Math.min(1, q.pt / tut.n) * 100) + '%';
        if ($('#tutBar i').style.width !== tw) $('#tutBar i').style.width = tw;
        setHtml($('#quests'), '');
    } else {
        const row = (line) => {
            const Q = questAt(line, line ? q.b : q.a), p = Math.min(Q.n, line ? q.pb : q.pa);
            return `<div class="quest o1"><span class="box">${p >= Q.n ? '✔' : ''}</span><span>${QUEST_TEXT[Q.kind]} ${fmtComma(p)}/${fmtComma(Q.n)}<small>💎${Q.gems}</small></span></div>`;
        };
        setHtml($('#quests'), row(0) + row(1));
    }
    // the backpack
    const my = myStats(), instant = !!S.passes.InstantSell;
    const bag = $('#bag');
    const full = !instant && S.bag.n >= my.inv;
    bag.classList.toggle('full', full);
    $('#fullTag').hidden = !full;
    setText($('#bagTxt'), instant ? '🧲' + fmt(S.bag.n) : fmt(S.bag.n) + '/' + fmt(my.inv));
    setText($('#bagVal'), S.bag.v ? '$' + fmt(S.bag.v * coinMult(S, now, S.friends)) : '');
    // boosts, gifts, badges
    const chip = (id, key, ic) => {
        const left = Math.max(0, Math.ceil(((S.boosts || {})[key] - now) / 1000));
        $(id).hidden = !(left > 0);
        if (left > 0) setText($(id), ic + ' ' + clock(left));
    };
    chip('#chipCoins', 'coins2', '💰 x2'); chip('#chipDmg', 'dmg2', '💥 x2'); chip('#chipFire', 'fire2', '⚡');
    const secs = sessionSecs();
    const next = GIFTS.findIndex((g, k) => !S.giftClaimed[k]);
    const ready = GIFTS.some((g, k) => !S.giftClaimed[k] && secs >= g.min * 60);
    $('#giftBadge').hidden = !ready;
    const gc = $('#giftChip');
    gc.classList.toggle('ready', ready);
    gc.hidden = next < 0 && !ready;
    setText(gc, ready ? '🎁 CLAIM YOUR GIFT!' : next < 0 ? '' : '🎁 Gift in ' + clock(GIFTS[next].min * 60 - secs));
    $('#dailyBadge').hidden = !dailyStatus(S.daily, now).can;
    $('#upBadge').hidden = !UPGRADES.some((u) => { const c = upCost(S, u.id); return c !== null && c <= S.coins && (u.id !== 'blast' || S.ammoOwned.boom); });
    $('#btnInstant').hidden = !!S.passes.InstantSell;
    $('#cubeBadge').hidden = !(S.unlocked > (S.roomLevel || 0) && !(S.clears || {})[S.unlocked]);
    setText($('#friendBoost'), S.friends ? 'Friend Boost: +' + Math.round(Math.min(CFG.friendMax, S.friends) * CFG.friendBoost * 100) + '%' : '');
    renderSlots();
}

// ----- the hotbar: the three ball types -----
let slotKey = '';
export function renderSlots() {
    const key = AMMO.map((a) => a.id + ':' + (S.ammoOwned[a.id] ? 1 : 0) + ':' + Math.floor(ammoLeft(a.id))).join(',') + '|' + S.ammoSel + '|' + S.gun;
    if (key === slotKey) return;
    slotKey = key;
    const box = $('#slots');
    box.innerHTML = '';
    AMMO.forEach((a, i) => {
        const own = !!S.ammoOwned[a.id], n = ammoLeft(a.id);
        const b = document.createElement('button');
        b.className = 'slot' + (S.ammoSel === a.id ? ' on' : '') + (own ? '' : ' lock') + (own && n < 1 ? ' empty' : '');
        b.style.setProperty('--c', hex(a.color));
        b.innerHTML = `<span class="ball"></span><span class="n o1">${own ? (n === Infinity ? '∞' : Math.floor(n)) : C(a.price)}</span><span class="k o1">${i + 1}</span>`;
        b.title = a.name + ' (' + (i + 1) + ')';
        b.addEventListener('click', () => actions.selectAmmo(a.id));
        box.appendChild(b);
    });
    const g = gunById[S.gun] || GUNS[0];
    setText($('#gunName'), g.ic + ' ' + g.name);
}

// ----- toasts, pop-ups, big words -----
export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o';
    d.style.color = color || '#fff';
    d.textContent = text;
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 2900);
}
let qpTimer;
export function questPop(title, sub, icon) {
    const el = $('#questPop');
    setText($('#qpTitle'), title); setText($('#qpSub'), sub);
    setText(el.querySelector('.gi'), icon || '💎');
    el.hidden = false; replay(el, 'go');
    clearTimeout(qpTimer);
    qpTimer = setTimeout(() => { el.hidden = true; }, 2800);
}
let bigTimer;
export function bigText(text, color) {
    const el = $('#bigText');
    setText(el, text); el.style.color = color || '#ffffff';
    el.hidden = false; replay(el, 'go');
    clearTimeout(bigTimer);
    bigTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
export function flash(color, ms, peak) {
    const f = $('#flash');
    f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = peak ?? 0.85;
    requestAnimationFrame(() => { f.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease'; f.style.opacity = 0; });
}
let hintKey = '';
export function setHint(text) { if (text === hintKey) return; hintKey = text; $('#hint').hidden = !text; if (text) setText($('#hint'), text); }
export function setCrosshair(on) { $('#crosshair').classList.toggle('on', !!on); }
export function hitMarker(kill) {
    const el = $('#hitX');
    el.classList.remove('on', 'kill');
    void el.offsetWidth;
    el.classList.add(kill ? 'kill' : 'on');
    sfxSome('hitmark', kill ? 1.25 : 1, 1);
}
// the block under the crosshair: its name, a health bar and its hit points
export function setTarget(t) {
    const el = $('#target');
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    setText($('#tgName'), t.name);
    $('#tgName').style.color = '#' + t.color;
    $('#tgBar').style.width = Math.max(0, Math.min(100, t.hp / t.max * 100)).toFixed(0) + '%';
    setText($('#tgHp'), fmtComma(t.hp) + ' / ' + fmtComma(t.max) + ' HP · $' + fmt(t.value));
}
// the lobby's console line (a pad's countdown, or the reference's "GO TO A PAD...")
export function setPadHint(text) { setText($('#padTxt'), text || 'GO TO A PAD TO START A GAME!'); }
export function kickCrosshair() { const c = $('#crosshair'); c.classList.add('kick'); setTimeout(() => c.classList.remove('kick'), 70); }
export function notEnough(m) {
    toast('Not enough ' + (m.cur === 'gems' ? 'Gems' : 'Coins') + '! You need ' + fmt(m.need) + ' more for ' + m.name, '#ff7a8a');
}

// =====================================================================================
// CUBE DESTROYED!
// =====================================================================================
let dsTimer = null, dsNext = -1;
export function showDestroyed(m) {
    const def = CUBES[m.level];
    setText($('#dsName'), def.ic + ' Cube ' + (m.level + 1) + ': ' + def.name);
    const stat = (ic, label, v) => `<div class="stat"><small>${ic} ${label}</small><b class="o1">${v}</b></div>`;
    if (m.helped) {
        setHtml($('#dsStats'),
            stat('⏱️', m.best === m.secs ? 'NEW BEST!' : 'Time', clock(m.secs)) +
            stat('💥', 'You broke', fmtComma(m.blocks)) +
            stat('💰', 'Coins', '+' + fmt(m.coins + (m.leftover || 0))) +
            stat('💎', 'Gems', '+' + m.gems));
    } else setHtml($('#dsStats'), stat('🏆', 'MVP', esc(m.mvp || '-')) + stat('⏱️', 'Time', clock(m.secs)));
    $('#dsFirst').parentElement.hidden = !(m.helped && m.first);
    dsNext = m.helped && m.next >= 0 && m.next !== m.level ? m.next : -1;
    setText($('#dsNext'), !m.helped ? 'Break some blocks next time to share the rewards!' : m.opened >= 0 ? '🔓 ' + CUBES[m.opened].ic + ' ' + CUBES[m.opened].name + ' unlocked!' : m.leftover ? '🎒 Leftover cubes sold (half price): +' + fmt(m.leftover) + ' Coins' : '');
    const go = $('#dsGo');
    go.hidden = dsNext < 0;
    if (dsNext >= 0) setText(go, '▶ NEXT CUBE: ' + CUBES[dsNext].name);
    $('#destroyed').hidden = false;
    clearTimeout(dsTimer);
    dsTimer = setTimeout(hideDestroyed, (CFG.rebuildSecs - 0.6) * 1000);
    setMusicDuck(true);
}
export function hideDestroyed() { if ($('#destroyed').hidden) return; $('#destroyed').hidden = true; clearTimeout(dsTimer); setMusicDuck(false); }
$('#dsGo').addEventListener('click', () => { const n = dsNext; hideDestroyed(); if (n >= 0) actions.goLevel(n); });
$('#dsStay').addEventListener('click', hideDestroyed);
$('#dsLobby').addEventListener('click', () => { hideDestroyed(); actions.goLevel(-1); });
$('#btnLobby').addEventListener('click', () => actions.goLevel(-1));

// ----- the warp between cubes -----
export function showWarp(level, text) {
    const def = level < 0 ? { ic: '🏠', name: 'Lobby', colors: [0x7ad0ff, 0x2a8aff] } : CUBES[level];
    setText($('#warpTitle'), def.ic + ' ' + def.name.toUpperCase());
    $('#warpCube').style.background = `linear-gradient(135deg, ${hex(def.colors[0])}, ${hex(def.colors[1])})`;
    setText($('#warpText'), text || 'Charging the blaster…');
    $('#warpBar').style.width = '10%';
    $('#warp').hidden = false;
}
export const setWarp = (k, text) => { $('#warpBar').style.width = Math.round(k * 100) + '%'; if (text) setText($('#warpText'), text); };
export const hideWarp = () => { $('#warp').hidden = true; };

// =====================================================================================
// Purchases: a confirm card for the bigger ones (the server checks and takes the price)
// =====================================================================================
let pendingAct = null;
export function askConfirm(ic, title, text, costHtml, yesText, affordable, act, note) {
    pendingAct = act;
    setHtml($('#confirmIc'), ic);
    setText($('#confirmTitle'), title);
    setText($('#confirmText'), text);
    setHtml($('#confirmCost'), costHtml || '');
    const yes = $('#confirmYes');
    yes.disabled = !affordable;
    setText(yes, yesText);
    setText($('#confirmNote'), note || '');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
function closeConfirm() { $('#confirm').hidden = true; pendingAct = null; if (!modalOpen()) setMusicDuck(false); }
$('#confirmYes').addEventListener('click', () => { const a = pendingAct; closeConfirm(); if (a) a(); });
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmClose').addEventListener('click', closeConfirm);
const shortBy = (price, gems) => price - (gems ? S.gems : S.coins);
function buyWith(ic, name, desc, price, gems, act) {
    const short = shortBy(price, gems);
    askConfirm(ic, name, desc, gems ? G(price) + ' Gems' : C(price) + ' Coins', short > 0 ? 'Need ' + fmt(short) + ' more' : 'Buy', short <= 0, act,
        short > 0 ? (gems ? 'Earn Gems from quests, gem blocks, gifts and daily rewards!' : 'Blast blocks and sell the cubes for Coins!') : 'You have ' + fmtComma(gems ? S.gems : S.coins) + (gems ? ' Gems' : ' Coins'));
}
export function buyGun(id) {
    const g = gunById[id];
    if (!g) return;
    if (S.guns[id]) { net.send('gun', { id }); return; }
    buyWith(g.ic, g.name, g.desc, g.gems || g.price, !!g.gems, () => net.send('gun', { id }));
}
export function buyAmmo(id) {
    const a = ammoById[id];
    if (!a || S.ammoOwned[id]) return;
    buyWith(a.ic, a.name, a.desc + '. Refills by itself (' + a.max + ' max).', a.price, false, () => net.send('ammo', { id }));
}
export function buyPass(key) {
    const p = PASSES[key];
    if (!p) return;
    if (S.passes[key]) { toast(p.name + ' already owned!', '#6fe0ff'); return; }
    buyWith(p.ic, p.name, p.desc, p.gems, true, () => net.send('pass', { id: key }));
}
export function buyBoost(key) { const b = BOOSTS[key]; buyWith(b.ic, b.name, b.desc, b.gems, true, () => net.send('boost', { id: key })); }

// =====================================================================================
// Panels
// =====================================================================================
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(true); $('#modal').hidden = false; setMusicDuck(true); if (actions.onPanel) actions.onPanel(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); if (actions.onPanel) actions.onPanel(false); }
export function refreshModal() { if (!$('#modal').hidden && modalKind !== 'invite' && modalKind !== 'config') renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
export const modalIs = (k) => modalOpen() && modalKind === k;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });
function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function sec(body, text) { body.appendChild(el('div', 'sec o1', esc(text))); }
function note(body, text) { body.appendChild(el('p', 'note o1', text)); }
function card(o) {
    const d = el('div', 'card' + (o.cls ? ' ' + o.cls : ''));
    d.innerHTML = `<div class="ic">${o.ic}</div><div class="nm">${esc(o.name)}</div>${o.desc ? `<div class="ds">${o.desc}</div>` : ''}`;
    if (o.btn) {
        const b = el('button', 'btn ' + (o.btnCls || 'g-green') + ' o1', o.btn);
        b.disabled = !!o.disabled;
        b.addEventListener('click', o.onClick);
        d.appendChild(b);
    }
    return d;
}
let tabsEl = null;
function tabs(list) {
    const t = tabsEl;
    t.innerHTML = '';
    if (!list) return;
    for (const [id, label] of list) {
        const b = el('button', 'btn g-blue o1' + (modalTab === id ? ' on' : ''), label);
        b.addEventListener('click', () => { modalTab = id; renderModal(true); });
        t.appendChild(b);
    }
}
// Builds the panel off-screen and swaps it in only when something on it changed: the profile
// arrives several times a second while you collect, and replacing the buttons under the pointer
// would swallow clicks
function renderModal(force) {
    const body = $('#modalBody'), tabBox = $('#modalTabs');
    const nb = document.createElement('div'), nt = document.createElement('div');
    tabsEl = nt;
    const titles = { upgrades: 'Upgrades', shop: 'SHOP', cubes: 'CUBES', config: 'SETTINGS', gifts: 'GIFTS', invite: 'INVITE' };
    setText($('#modalTitle'), titles[modalKind] || '');
    tabs(null);
    ({ upgrades: renderUpgrades, shop: renderShop, cubes: renderCubes, config: renderConfig, gifts: renderGifts, invite: renderInvite }[modalKind] || (() => {}))(nb);
    if (!force && nb.innerHTML === body.innerHTML && nt.innerHTML === tabBox.innerHTML) return;
    const scroll = body.scrollTop;
    body.replaceChildren(...nb.childNodes);
    tabBox.replaceChildren(...nt.childNodes);
    body.scrollTop = scroll;
}
// ----- the upgrade computer (the reference's skill tree) -----
const showV = (u, v) => (u.id === 'rate' ? v + 's' : fmt(v) + (u.unit && u.unit !== 's' ? u.unit : ''));
function renderUpgrades(body) {
    note(body, '🖥️ Skill Tree: spend Coins on permanent upgrades. You have ' + C(S.coins) + ' Coins.');
    const g = el('div', 'grid2');
    for (const u of UPGRADES) {
        const lv = upLevel(S, u.id), max = u.v.length - 1, cost = upCost(S, u.id), v = u.v[lv];
        const d = el('div', 'up');
        const pips = Array.from({ length: Math.min(max, 12) }, (_, i) => `<i class="${i < Math.round(lv / max * Math.min(max, 12)) ? 'f' : ''}"></i>`).join('');
        const locked = u.id === 'blast' && !S.ammoOwned.boom;
        d.innerHTML = `<span class="ic">${u.ic}</span><span class="nm">${u.name.toUpperCase()}</span>
            <span class="cost">${cost === null ? 'MAX' : C(cost)}</span>
            <span class="vv">${showV(u, v)}${cost === null ? '' : ' &gt; ' + showV(u, u.v[lv + 1])}</span>
            <span class="lv">${locked ? '🔒 needs Exploding Balls' : 'Lv ' + lv + '/' + max + ' · ' + esc(u.desc)}<span class="pips">${pips}</span></span>`;
        const b = el('button', 'btn ' + (cost !== null && cost <= S.coins && !locked ? 'g-green' : 'g-grey') + ' o1', cost === null ? 'MAX' : 'UPGRADE');
        b.disabled = cost === null || locked;
        b.addEventListener('click', () => { if (cost !== null && cost > S.coins) { notEnough({ need: cost - S.coins, name: u.name }); sfx('denied'); return; } net.send('up', { id: u.id }); });
        d.appendChild(b);
        g.appendChild(d);
    }
    body.appendChild(g);
    const my = myStats();
    note(body, `Now: ${my.dmg} damage · ${(1 / my.cd).toFixed(1)} shots/s · ${my.bounces} bounce${my.bounces > 1 ? 's' : ''} · backpack ${fmt(my.inv)} · pickup ${my.range} studs`);
}
// ----- the shop -----
function renderShop(body) {
    tabs([['guns', '🔫 Blasters'], ['ammo', '🟢 Balls'], ['gems', '💎 Gem Shop'], ['skins', '✨ Ball Skins']]);
    const tab = modalTab || 'guns';
    const g = el('div', 'grid');
    if (tab === 'guns') {
        for (const gun of GUNS) {
            const own = !!S.guns[gun.id], on = S.gun === gun.id;
            const dps = (gun.dmg * gun.pellets / gun.cd);
            g.appendChild(card({
                ic: gun.ic, name: gun.name, desc: esc(gun.desc) + '<br><b>x' + dps.toFixed(1) + ' power</b>' + (gun.blast ? ' · 💣' : '') + (gun.pierce ? ' · pierces' : ''),
                cls: (own ? 'own' : '') + (gun.gems ? ' gem' : ''),
                btn: on ? 'Equipped' : own ? 'Equip' : gun.gems ? G(gun.gems) : C(gun.price),
                btnCls: on ? 'g-blue' : own ? 'g-blue' : (gun.gems ? S.gems >= gun.gems : S.coins >= gun.price) ? 'g-green' : 'g-grey', disabled: on,
                onClick: () => buyGun(gun.id),
            }));
        }
    } else if (tab === 'ammo') {
        for (const a of AMMO) {
            const own = !!S.ammoOwned[a.id];
            g.appendChild(card({
                ic: `<span style="display:inline-block;width:2.4rem;height:2.4rem;border-radius:50%;border:3px solid #10203a;background:radial-gradient(circle at 35% 30%,#fff,${hex(a.color)} 50%);box-shadow:0 0 0.8rem ${hex(a.color)}"></span>`,
                name: a.name, desc: esc(a.desc) + (a.max !== Infinity ? '<br>' + a.max + ' max · +1 every ' + a.regen + 's' : ''), cls: own ? 'own' : '',
                btn: own ? (S.ammoSel === a.id ? 'Selected' : 'Use') : C(a.price), btnCls: own ? 'g-blue' : S.coins >= a.price ? 'g-green' : 'g-grey', disabled: own && S.ammoSel === a.id,
                onClick: () => (own ? (actions.selectAmmo(a.id), renderModal(true)) : buyAmmo(a.id)),
            }));
        }
    } else if (tab === 'gems') {
        for (const [key, p] of Object.entries(PASSES)) {
            const own = !!S.passes[key];
            g.appendChild(card({ ic: p.ic, name: p.name, desc: esc(p.desc), cls: 'gem' + (own ? ' own' : ''), btn: own ? 'Owned' : G(p.gems), btnCls: own ? 'g-blue' : S.gems >= p.gems ? 'g-green' : 'g-grey', disabled: own, onClick: () => buyPass(key) }));
        }
        for (const [key, b] of Object.entries(BOOSTS)) g.appendChild(card({ ic: b.ic, name: b.name + ' ⏱️', desc: esc(b.desc), cls: 'hot', btn: G(b.gems), btnCls: S.gems >= b.gems ? 'g-green' : 'g-grey', onClick: () => buyBoost(key) }));
    } else if (tab === 'skins') {
        for (const s of BALL_SKINS) {
            const own = !!S.balls[s.id], on = S.ball === s.id;
            const bg = s.rainbow ? 'conic-gradient(#ff5a7a,#ffd21e,#46ec50,#3ad8ff,#8a5aff,#ff5a7a)' : `radial-gradient(circle at 35% 30%,#fff,${hex(s.color)} 50%)`;
            g.appendChild(card({
                ic: `<span style="display:inline-block;width:2.4rem;height:2.4rem;border-radius:50%;border:3px solid #10203a;background:${bg};box-shadow:0 0 0.8rem ${hex(s.color)}"></span>`,
                name: s.name, desc: s.price ? '' : 'Free', cls: on ? 'own' : '', btn: on ? 'Equipped' : own ? 'Equip' : C(s.price), btnCls: own ? 'g-blue' : S.coins >= s.price ? 'g-green' : 'g-grey',
                disabled: on || (!own && S.coins < s.price), onClick: () => net.send('ball', { id: s.id }),
            }));
        }
    }
    body.appendChild(g);
    if (tab === 'gems') note(body, '💎 Gems come from quests, gem blocks (purple), destroying cubes, gifts and daily rewards. You have ' + fmtComma(S.gems) + '.');
    else if (tab === 'ammo') note(body, 'Pick a ball type on the hotbar (1 / 2 / 3). Special balls refill by themselves.');
    else note(body, 'Everything costs Coins (or Gems): blast blocks, collect the cubes and sell them at the base.');
}
// ----- cube select -----
function renderCubes(body) {
    note(body, 'Every cube you destroy unlocks a bigger, tougher one. Rewards pay x2 the first time!');
    if (S.roomLevel >= 0) {
        const lb = el('button', 'btn g-purple o1', '🏠 Back to the Lobby');
        lb.addEventListener('click', () => { closeModal(); actions.goLevel(-1); });
        body.appendChild(lb);
    }
    const list = el('div', 'grid2');
    CUBES.forEach((c, i) => {
        const open = levelOpen(S, i), here = i === S.roomLevel && S.roomLevel >= 0, cleared = (S.clears || {})[i] || 0;
        const d = el('div', 'cubeCard' + (here ? ' here' : '') + (open ? '' : ' lock'));
        d.innerHTML = `<span class="sw" style="background:linear-gradient(135deg,${hex(c.colors[0])},${hex(c.colors[1])} 60%,${hex(c.colors[2])})"></span>
            <span><b>${open ? c.ic : '🔒'} Cube ${i + 1}: ${esc(c.name)}</b><small>${c.n}×${c.n}×${c.n} · ${fmtComma(cubeBlocks(i))} blocks · ${cleared ? '✔ destroyed ' + cleared + 'x · best ' + clock((S.best || {})[i] || 0) : open ? 'reward ' + fmt(c.clear.coins) + ' Coins + ' + c.clear.gems + ' Gems' : 'Destroy Cube ' + i + ' to unlock'}</small></span>`;
        const b = el('button', 'btn ' + (here ? 'g-blue' : open ? 'g-green' : 'g-grey') + ' o1', here ? 'HERE' : open ? 'PLAY' : 'LOCKED');
        b.disabled = here || !open;
        b.addEventListener('click', () => { closeModal(); actions.goLevel(i); });
        d.appendChild(b);
        list.appendChild(d);
    });
    body.appendChild(list);
}
// ----- settings -----
function slider(body, ic, label, kind) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx" style="flex:0 0 8rem"><b class="o1">${label}</b></span>`;
    const s = el('input');
    s.type = 'range'; s.min = 0; s.max = 100; s.value = Math.round((getVolumes()[kind] ?? 1) * 100);
    s.setAttribute('aria-label', label);
    s.addEventListener('input', () => setVolume(kind, s.value / 100));
    r.appendChild(s);
    body.appendChild(r);
}
function toggleRow(body, ic, label, small, get, set) {
    const f = el('div', 'row');
    f.innerHTML = `<span class="ic">${ic}</span><span class="tx"><b class="o1">${label}</b><small class="o1">${small}</small></span>`;
    const b = el('button', 'btn ' + (get() ? 'g-green' : 'g-grey') + ' o1', get() ? 'ON' : 'OFF');
    b.addEventListener('click', () => { set(!get()); renderModal(true); });
    f.appendChild(b);
    body.appendChild(f);
}
function renderConfig(body) {
    sec(body, 'Sound');
    slider(body, '🎵', 'Music', 'music');
    slider(body, '🫧', 'Pops & steps', 'asmr');
    slider(body, '🔔', 'Effects', 'sfx');
    sec(body, 'Graphics & controls');
    const q = el('div', 'row');
    q.innerHTML = '<span class="ic">✨</span><span class="tx"><b class="o1">Quality</b><small class="o1">Low is smoothest on older PCs and phones</small></span>';
    for (const [k, n] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = el('button', 'btn ' + (getQuality() === k ? 'g-green' : 'g-grey') + ' o1', n);
        b.addEventListener('click', () => { setQuality(k); renderModal(true); });
        q.appendChild(b);
    }
    body.appendChild(q);
    toggleRow(body, '👁️', 'First person', 'See through your own eyes, like the reference (V)', () => actions.getFP(), (v) => actions.setFP(v));
    toggleRow(body, '🎯', 'Auto fire', 'Shoot by itself while you aim at the cube (F)', () => actions.getAuto(), (v) => actions.setAuto(v));
    sec(body, 'Codes');
    const c = el('div', 'row');
    c.innerHTML = '<span class="ic">🎟️</span>';
    const inp = el('input', 'input'); inp.placeholder = 'Enter a code'; inp.maxLength = 24;
    const go = el('button', 'btn g-green o1', 'Redeem');
    go.addEventListener('click', () => { if (inp.value.trim()) net.send('code', { code: inp.value.trim() }); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); });
    c.appendChild(inp); c.appendChild(go);
    body.appendChild(c);
    const stats2 = el('div', 'row');
    stats2.innerHTML = `<span class="ic">📊</span><span class="tx"><b class="o1">Cubes destroyed ${fmt(S.wins)} · Blocks broken ${fmt(S.blocks)}</b><small class="o1">Playtime ${playtimeText(S.playtime)} · Coins earned ${fmt(S.totalCoins)} · Best cube: ${CUBES[S.unlocked].name}</small></span>`;
    body.appendChild(stats2);
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff7a8a'); }
// ----- playtime gifts -----
function renderGifts(body) {
    note(body, 'Keep playing to unlock gifts! (' + Math.floor(sessionSecs() / 60) + ' min played this session)');
    const g = el('div', 'grid');
    const secs = sessionSecs();
    GIFTS.forEach((gift, k) => {
        const claimed = !!S.giftClaimed[k], ready = secs >= gift.min * 60;
        g.appendChild(card({
            ic: gift.boost ? BOOSTS[gift.boost].ic : gift.gems ? '💎' : '💰', name: rewardText(gift, S), desc: gift.min + ' min',
            cls: claimed ? 'own' : ready ? 'hot' : '', btn: claimed ? 'Claimed' : ready ? 'CLAIM' : clock(gift.min * 60 - secs), btnCls: ready && !claimed ? 'g-green' : 'g-grey',
            disabled: claimed || !ready, onClick: () => net.send('gift', { k }),
        }));
    });
    body.appendChild(g);
}
// ----- invite -----
function renderInvite(body) {
    note(body, 'Destroy cubes together! Friend Boost gives +' + Math.round(CFG.friendBoost * 100) + '% Coins for every Bloxity friend in your server (up to +' + Math.round(CFG.friendBoost * CFG.friendMax * 100) + '%).');
    const r = el('div', 'row');
    r.innerHTML = '<span class="ic">🔗</span><span class="tx"><b class="o1">Invite link</b><small class="o1">Send it to a friend</small></span>';
    const b = el('button', 'btn g-green o1', 'Copy');
    b.addEventListener('click', async () => {
        const link = BX.getInviteLink() || location.href;
        try { await navigator.clipboard.writeText(link); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast(link, '#ffffff'); }
    });
    r.appendChild(b);
    body.appendChild(r);
    const list = el('div', 'grid');
    body.appendChild(list);
    if (BX.bloxity.ready && BX.identity().loggedIn) {
        BX.getFriends().then((fr) => {
            if (!fr.length) { list.appendChild(el('p', 'note o1', 'No Bloxity friends yet.')); return; }
            for (const f of fr.slice(0, 24)) {
                const nm = f.displayName || f.username || 'Friend';
                list.appendChild(card({ ic: '🙂', name: nm, btn: 'Invite', onClick: async () => { const ok = await BX.inviteFriend(f._id || f.id); toast(ok ? 'Invited ' + nm + '!' : 'Could not invite ' + nm, ok ? '#7dff6b' : '#ff7a8a'); } }));
            }
        });
    } else note(body, 'Log in to Bloxity to invite your friends directly.');
}

// =====================================================================================
// Daily rewards (they pop up once the tutorial is done, never in the middle of it)
// =====================================================================================
export function openDailyOnJoin() {
    if (openDailyOnJoin.done || !dailyStatus(S.daily, net.now()).can) return;
    if ((S.q.tut || 0) < TUTORIAL.length) return;
    openDailyOnJoin.done = true;
    setTimeout(() => { if (!anyPopup()) openDaily(); else openDailyOnJoin.done = false; }, 2500);
}
export function openDaily() { renderDaily(); $('#daily').hidden = false; setMusicDuck(true); if (actions.onPanel) actions.onPanel(true); }
function renderDaily() {
    const st = dailyStatus(S.daily, net.now());
    const cards = $('#dailyCards');
    cards.innerHTML = '';
    DAILY.forEach((r, i) => {
        const done = i < st.day || (!st.can && i === st.day);
        const now = st.can && i === st.day;
        const d = el('div', 'dcard o1' + (done ? ' done' : '') + (now ? ' now' : ''));
        d.innerHTML = `<span class="d">Day ${i + 1}</span><span class="i">${r.gems ? '💎' : r.boost ? BOOSTS[r.boost].ic : '💰'}</span><span>${esc(rewardText(r, S))}</span>`;
        cards.appendChild(d);
    });
    $('#dailyClaim').disabled = !st.can;
    setText($('#dailyLeft'), st.can ? 'Your daily reward is ready!' : 'Come back tomorrow for Day ' + ((st.streak % 7) + 1) + '!');
}
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(renderDaily, 300); });
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; setMusicDuck(false); if (actions.onPanel) actions.onPanel(false); });
export const refreshDaily = () => { if (!$('#daily').hidden) renderDaily(); };

// =====================================================================================
// HUD buttons
// =====================================================================================
$('#btnUp').addEventListener('click', () => openModal('upgrades'));
$('#btnShop').addEventListener('click', () => openModal('shop'));
$('#btnCubes').addEventListener('click', () => openModal('cubes'));
$('#btnInstant').addEventListener('click', () => buyPass('InstantSell'));
$('#coinPill').addEventListener('click', () => openModal('upgrades'));
$('#gemPill').addEventListener('click', () => openModal('shop', 'gems'));
$('#bag').addEventListener('click', () => { if (actions.goSell) actions.goSell(); });
$('#btnConfig').addEventListener('click', () => openModal('config'));
$('#btnInvite').addEventListener('click', () => openModal('invite'));
$('#btnGift').addEventListener('click', () => openModal('gifts'));
$('#giftChip').addEventListener('click', () => {
    const secs = sessionSecs(), k = GIFTS.findIndex((g, i) => !S.giftClaimed[i] && secs >= g.min * 60);
    if (k >= 0) net.send('gift', { k }); else openModal('gifts');
});
$('#btnDaily').addEventListener('click', openDaily);
actions.openUpgrades = () => openModal('upgrades');
actions.openShop = (tab) => openModal('shop', tab);
actions.openCubes = () => openModal('cubes');
actions.openDaily = () => openDaily();

// Closes the topmost popup (Escape / controller B); false when nothing was open
export function closeTop() {
    if (!$('#confirm').hidden) { closeConfirm(); return true; }
    if (!$('#daily').hidden) { $('#dailyClose').click(); return true; }
    if (modalOpen()) { closeModal(); return true; }
    if (!$('#destroyed').hidden) { hideDestroyed(); return true; }
    return false;
}
export const anyPopup = () => ['#confirm', '#daily', '#modal', '#destroyed', '#warp'].some((id) => !$(id).hidden);
void LEVELS; void upValue;
