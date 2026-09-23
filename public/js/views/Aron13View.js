/**
 * /is/aron13ara — a hidden birthday page for Aron (13 on 2026-09-06).
 *
 * Three mini games played in order; each reveals a message. All copy is
 * hardcoded Icelandic: the route is locale-locked (server/config/i18n.js) and
 * adding is-only keys would trip `npm run check:i18n`. Progress lives in
 * localStorage so a reload — or closing the tab — keeps the unlocked gifts.
 *
 * The page paints its own palette (see aron13.css) so it looks identical
 * under every html[data-theme]. Artwork is inline pixel SVG from
 * aron13-sprites.js, titles are a pixel font (aron13-font.js), and sound is
 * synthesized WebAudio (aron13-fx.js) — no assets, nothing new for the CSP.
 */
import { escHtml } from '../utils/escHtml.js';
import { getServerEnv } from '../services/themePrefs.js';
import { px } from './aron13-sprites.js';
import { pixelText } from './aron13-font.js';
import { fx } from './aron13-fx.js';
import { mountMining, formatTime } from './aron13-games/mining.js';
import { mountCatch } from './aron13-games/catch.js';
import { mountCrafting } from './aron13-games/crafting.js';

// The page's stylesheet is product-owned (public/css/aron13.css) and the
// engine's main.css does not @import it (the base's did — the import was lost
// in the 2026-09-22 graft, which is why the crafting cells measured 0×0 in
// e2e/aron13.spec.js). The view loads it itself, once, and waits for it so
// the first paint is styled — no hook on an engine file.
const STYLESHEET = '/css/aron13.css';
function ensureStylesheet() {
  const existing = document.querySelector('link[data-aron13-css]');
  if (existing) return existing.sheet ? Promise.resolve() : new Promise(res => existing.addEventListener('load', res, { once: true }));
  return new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLESHEET;
    link.dataset.aron13Css = '1';
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true }); // render unstyled rather than never
    document.head.appendChild(link);
  });
}

const STORAGE_KEY = 'aron13:step';
const BEST_KEY = 'aron13:best';
const CONFETTI_COUNT = 110;
const CONFETTI_TTL_MS = 4500;
const IDLE_HINT_MS = 60_000;
const FIREWORKS_MS = 9000;

const GAMES = [
  {
    id: 'nama',
    theme: 'mc',
    level: 'LEIKUR 1',
    name: 'DEMANTANÁMA',
    label: 'Leikur 1 · Demantanáma',
    icon: 'pickaxe',
    intro: 'Brjóttu kubbana með hakanum og finndu demantana þrjá sem fela sig í námunni. Gull er bónus. Passaðu þig á TNT!',
    controls: 'Smelltu eða pikkaðu á kubb til að höggva. Steinn þarf þrjú högg.',
    hints: [
      'Demantarnir fela sig undir kubbunum – brjóttu þá!',
      'Steinn þarf þrjú högg. Demantar eru alltaf í neðstu þremur röðunum.',
      'Brjóttu bara alla kubbana – þá finnurðu alla þrjá.',
    ],
    mount: mountMining,
    reveal: 'Já þetta ert þú Aron',
    achievement: 'DEMANTAVEIÐARI',
    achievementBody: 'Fannst alla þrjá demantana',
    stat: { label: 'Tími', fmt: formatTime, better: (a, b) => a < b },
  },
  {
    id: 'robux',
    theme: 'rb',
    level: 'LEIKUR 2',
    name: 'NÁÐU ROBUX',
    label: 'Leikur 2 · Náðu Robux',
    icon: 'robuxCoin',
    intro: 'Myntir falla af himnum. Hlauptu til hliðar og gríptu 10 Robux. TNT fellur líka – forðastu það!',
    controls: 'Örvatakkar eða A/D. Í síma: dragðu kallinn með fingrinum eða haltu inni ◀ ▶.',
    hints: [
      'Notaðu örvatakkana, eða dragðu kallinn með fingrinum.',
      'Stattu undir myntinni áður en hún lendir – og víkðu frá TNT.',
      'Þú þarft 10 Robux. Það má missa eins margar myntir og þú vilt.',
    ],
    mount: mountCatch,
    reveal: 'Fyrri gjöfin er Claude Code áskrift út árið 2026',
    achievement: 'ROBUX-MEISTARI',
    achievementBody: 'Greip 10 Robux',
    stat: { label: 'Besta combo', fmt: (n) => `×${n}`, better: (a, b) => a > b },
  },
  {
    id: 'smidi',
    theme: 'mc',
    level: 'LEIKUR 3',
    name: 'SMÍÐABORÐ',
    label: 'Leikur 3 · Smíðaborð',
    icon: 'sword',
    intro: 'Settu réttu hlutina á réttu staðina í smíðaborðinu og smíðaðu demantssverð.',
    controls: 'Pikkaðu á hlut og svo á reit – eða dragðu hlutinn beint á reitinn.',
    hints: [
      'Sverð er langt og mjótt – hlutirnir fara í eina lóðrétta röð.',
      'Tveir demantar efst og í miðju, prik neðst.',
      'Miðjudálkur: demantur, demantur, prik. Svo „Smíða!"',
    ],
    mount: mountCrafting,
    reveal: 'Seinni gjöfin er NBA 2K26',
    achievement: 'MEISTARASMIÐUR',
    achievementBody: 'Smíðaði demantssverð',
    stat: { label: 'Tilraunir', fmt: (n) => String(n), better: (a, b) => a < b },
  },
];

const FLOATING_BLOCKS = [
  { name: 'grassBlock',   left: '4%',  top: '12%', delay: '0s',    scale: 6 },
  { name: 'diamondBlock', left: '90%', top: '18%', delay: '-2s',   scale: 5 },
  { name: 'tnt',          left: '8%',  top: '58%', delay: '-4s',   scale: 5 },
  { name: 'goldBlock',    left: '93%', top: '62%', delay: '-1s',   scale: 6 },
  { name: 'dirtBlock',    left: '15%', top: '85%', delay: '-3s',   scale: 5 },
  { name: 'robloxBlock',  left: '84%', top: '88%', delay: '-5s',   scale: 6 },
  { name: 'stoneBlock',   left: '2%',  top: '38%', delay: '-2.5s', scale: 4 },
  { name: 'plank',        left: '95%', top: '42%', delay: '-3.5s', scale: 4 },
  { name: 'cloud',        left: '22%', top: '4%',  delay: '-1.5s', scale: 5 },
  { name: 'cloud',        left: '70%', top: '7%',  delay: '-4.5s', scale: 4 },
];

const wait = (ms, timers) => new Promise((r) => {
  if (fx.reduced) { r(); return; }
  timers.push(setTimeout(r, ms));
});

export class Aron13View {
  constructor() {
    this._el = null;
    // /is/aron13ara?reset — a fresh start link (best scores are kept).
    if (/[?&]reset(?:=|&|$)/.test(window.location.search)) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
    this._step = this._loadStep();
    this._best = this._loadBest();
    this._fails = 0;
    this._hintsShown = 0;
    this._timers = [];
    this._confettiEl = null;
    this._game = null;
    this._creeperTaps = 0;
    this._token = 0; // bumps on every stage change so stale async sequences bail out
  }

  async render() {
    await ensureStylesheet();
    const view = document.createElement('div');
    view.className = 'view a13-view';
    // Return visits get a compact hero so the game is near the top.
    const compact = this._step > 0;
    view.innerHTML = `
      <main class="main aron13" id="main-content">
        <div class="a13-bg" aria-hidden="true">${this._floatingHtml()}</div>

        <header class="a13-hero${compact ? ' a13-hero--compact' : ''}">
          <button type="button" class="a13-mute" data-mute aria-pressed="${fx.sfx.muted}" aria-label="Hljóð af/á" data-testid="aron13-mute">${px(fx.sfx.muted ? 'speakerOff' : 'speakerOn', { scale: 4 })}</button>
          <div class="a13-hero__side a13-bob">
            <button type="button" class="a13-creeper" data-creeper aria-label="Creeper">${px('creeperFace', { scale: compact ? 6 : 9 })}</button>
          </div>
          <div class="a13-hero__mid">
            <div class="a13-hero__cake" data-cake>${px('cake', { scale: 7, title: 'Afmæliskaka' })}</div>
            <p class="a13-eyebrow">6. september 2026</p>
            <h1 class="a13-visually-hidden">Til hamingju með 13 ára afmælið, Aron!</h1>
            <div class="a13-hero__name">${pixelText('ARON', { scale: compact ? 5 : 9 })}</div>
            <div class="a13-hero__age">${pixelText('13 ÁRA', { scale: compact ? 3 : 4, colour: 'y', outline: 'k' })}</div>
            <p class="a13-hero__greet">Til hamingju með afmælið!</p>
            <p class="a13-sub">Kláraðu 3 leiki til að opna gjafirnar</p>
          </div>
          <div class="a13-hero__side a13-bob a13-bob--late">${px('blockyGuy', { scale: compact ? 5 : 7 })}</div>
        </header>

        <section class="a13-progress" aria-label="Framvinda" data-progress></section>
        <section class="a13-stage" data-stage></section>
        <section class="a13-unlocked" data-unlocked></section>

        <footer class="a13-foot">
          <button type="button" class="a13-btn a13-btn--ghost" data-reset data-testid="aron13-reset">Byrja upp á nýtt</button>
        </footer>

        <div class="a13-ground" aria-hidden="true"></div>
      </main>
    `;
    this._el = view;
    this._bindRoot();
    this._renderProgress();
    this._renderUnlocked();
    this._renderStage();
    if (compact) {
      this._timers.push(setTimeout(() => {
        this._el.querySelector('[data-stage]')?.scrollIntoView({ block: 'start', behavior: fx.reduced ? 'auto' : 'smooth' });
      }, 80));
    }
    if (getServerEnv() === 'test') {
      // Test-only hook so Playwright can finish the real-time game. Never in prod.
      window.__aron13 = { win: (v) => { if (this._game) this._solve(v); }, step: () => this._step };
    }
    return view;
  }

  destroy() {
    this._token += 1;
    this._unmountGame();
    this._timers.forEach(clearTimeout);
    this._timers = [];
    if (this._confettiEl) { this._confettiEl.remove(); this._confettiEl = null; }
    fx.cleanupFx();
    if (window.__aron13) delete window.__aron13;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  _loadStep() {
    try {
      const n = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isInteger(n) && n >= 0 && n <= GAMES.length ? n : 0;
    } catch { return 0; }
  }

  _saveStep() {
    try { localStorage.setItem(STORAGE_KEY, String(this._step)); } catch { /* private mode */ }
  }

  _loadBest() {
    try {
      const v = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  }

  _saveBest() {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(this._best)); } catch { /* ignore */ }
  }

  _reset() {
    this._token += 1;
    this._unmountGame();
    this._step = 0;
    this._fails = 0;
    this._hintsShown = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    fx.sfx.blip();
    this._renderProgress();
    this._renderUnlocked();
    this._renderStage();
    this._el.querySelector('[data-stage]')?.scrollIntoView({ block: 'start', behavior: fx.reduced ? 'auto' : 'smooth' });
  }

  // ── Static chrome ──────────────────────────────────────────────────────────

  _floatingHtml() {
    return FLOATING_BLOCKS.map((b) =>
      `<span class="a13-float" style="left:${b.left};top:${b.top};animation-delay:${b.delay}">${px(b.name, { scale: b.scale })}</span>`
    ).join('');
  }

  _bindRoot() {
    this._el.querySelector('[data-reset]').addEventListener('click', () => this._reset());

    const mute = this._el.querySelector('[data-mute]');
    mute.addEventListener('click', () => {
      const next = !fx.sfx.muted;
      fx.sfx.setMuted(next);
      mute.setAttribute('aria-pressed', String(next));
      mute.innerHTML = px(next ? 'speakerOff' : 'speakerOn', { scale: 4 });
      if (!next) { fx.sfx.unlock(); fx.sfx.blip(); }
    });

    // Candle flicker.
    if (!fx.reduced) {
      const cake = this._el.querySelector('[data-cake]');
      let on = false;
      this._timers.push(setInterval(() => {
        if (!cake.isConnected) return;
        on = !on;
        cake.innerHTML = px(on ? 'cakeFlicker' : 'cake', { scale: 7, title: 'Afmæliskaka' });
      }, 420));
    }

    // Easter egg: poke the creeper five times.
    const creeper = this._el.querySelector('[data-creeper]');
    creeper.addEventListener('click', () => {
      fx.sfx.unlock();
      this._creeperTaps += 1;
      fx.sfx.blip();
      if (this._creeperTaps < 5) { fx.shake(creeper); return; }
      this._creeperTaps = 0;
      fx.sfx.hiss();
      creeper.classList.add('a13-inflate');
      this._timers.push(setTimeout(() => {
        creeper.classList.remove('a13-inflate');
        fx.sfx.boom();
        fx.screenShake();
        fx.flash('rgba(46,204,64,.4)');
        fx.particles.boom(creeper);
        this._confetti();
        fx.toast('AFREK', 'Creeper-tamari – þú fannst leyndarmálið', px('creeperFace', { scale: 4 }));
      }, 900));
    });
  }

  _renderProgress() {
    const host = this._el.querySelector('[data-progress]');
    const pct = Math.round((this._step / GAMES.length) * 100);
    host.innerHTML = `
      <div class="a13-progress__chests">
        ${GAMES.map((g, i) => `
          <div class="a13-progress__chest${i < this._step ? ' is-open' : ''}" data-testid="aron13-chest-${i + 1}">
            ${px(i < this._step ? 'chestOpen' : 'chestClosed', { scale: 4, title: i < this._step ? `Kista ${i + 1} opin` : `Kista ${i + 1} lokuð` })}
            <span class="a13-progress__num">${i + 1}</span>
          </div>`).join('')}
      </div>
      <div class="a13-xp" role="progressbar" aria-valuemin="0" aria-valuemax="${GAMES.length}" aria-valuenow="${this._step}" aria-label="Kláraðir leikir">
        <div class="a13-xp__fill" style="width:${pct}%"></div>
      </div>
      <p class="a13-progress__text">${this._step} af ${GAMES.length} leikjum kláraðir</p>
    `;
  }

  _renderUnlocked() {
    const host = this._el.querySelector('[data-unlocked]');
    const solved = GAMES.slice(0, this._step);
    // Hidden while nothing is open, and on the finale (which lists the gifts itself).
    host.hidden = solved.length === 0 || this._step >= GAMES.length;
    host.innerHTML = host.hidden ? '' : `
      <h2 class="a13-h2">Opnaðar kistur</h2>
      <ul class="a13-unlocked__list">
        ${solved.map((g, i) => `
          <li class="a13-unlocked__item a13-unlocked__item--${g.theme}" data-testid="aron13-result-${i + 1}">
            ${px('chestOpen', { scale: 4 })}
            <span class="a13-unlocked__msg">${escHtml(g.reveal)}</span>
            ${this._best[g.id] !== undefined ? `<span class="a13-unlocked__best">${g.stat.label}: ${escHtml(g.stat.fmt(this._best[g.id]))}</span>` : ''}
          </li>`).join('')}
      </ul>
    `;
  }

  // ── Stage ──────────────────────────────────────────────────────────────────

  _renderStage() {
    const host = this._el.querySelector('[data-stage]');
    this._token += 1;
    this._unmountGame();
    this._fails = 0;
    this._hintsShown = 0;
    if (this._step >= GAMES.length) {
      this._renderDone(host);
      return;
    }
    const g = GAMES[this._step];
    host.innerHTML = this._cardHtml(g);
    this._bindCard(g);
  }

  _cardHtml(g) {
    return `
      <div class="a13-card a13-card--${g.theme}" data-puzzle="${g.id}">
        <div class="a13-card__head">
          ${px(g.icon, { scale: 5 })}
          <h2 class="a13-card__label">${escHtml(g.label)}</h2>
        </div>
        <div class="a13-gamebox">
          <div class="a13-intro" data-intro>
            <div class="a13-intro__level">${pixelText(g.level, { scale: 3, colour: 'y' })}</div>
            <div class="a13-intro__name">${pixelText(g.name, { scale: 5 })}</div>
            <p class="a13-intro__desc">${escHtml(g.intro)}</p>
            <p class="a13-intro__ctl">${escHtml(g.controls)}</p>
            <button type="button" class="a13-btn a13-btn--go a13-btn--big" data-start data-testid="aron13-start">
              ${pixelText('BYRJA', { scale: 3, colour: 'w', outline: 'k' })}
            </button>
          </div>
          <div class="a13-game" data-game data-testid="aron13-game" hidden></div>
        </div>
        <p class="a13-status" id="a13-status" role="status" aria-live="polite" data-testid="aron13-status"></p>
        <div class="a13-hintbox">
          <button type="button" class="a13-btn a13-btn--hint" data-hint aria-expanded="false" aria-controls="a13-hints" data-testid="aron13-hint">
            ${px('torch', { scale: 3 })} Vísbending <span class="a13-btn__count" data-hint-count>0/${g.hints.length}</span>
          </button>
          <ol class="a13-hints" id="a13-hints" data-hints data-testid="aron13-hints" hidden></ol>
        </div>
      </div>
    `;
  }

  _bindCard(g) {
    const card = this._el.querySelector('[data-puzzle]');
    card.querySelector('[data-start]').addEventListener('click', () => this._startGame(g), { once: true });
    card.querySelector('[data-hint]').addEventListener('click', () => this._showHint(g));
  }

  async _startGame(g) {
    const token = this._token;
    const card = this._el.querySelector('[data-puzzle]');
    if (!card) return;
    fx.sfx.unlock();
    fx.sfx.blip();
    card.querySelector('[data-intro]')?.remove();
    const gameHost = card.querySelector('[data-game]');
    gameHost.hidden = false;
    await fx.countdown(card.querySelector('.a13-gamebox'), this._timers);
    if (token !== this._token || !gameHost.isConnected) return;
    this._mountGame(g, gameHost);
  }

  _mountGame(g, gameHost) {
    const card = this._el.querySelector('[data-puzzle]');
    const status = card.querySelector('#a13-status');
    const api = {
      px,
      fx,
      onWin: (value) => this._solve(value),
      onFail: () => {
        this._fails += 1;
        if (this._fails >= 3) this._pulseHint();
      },
      onStatus: (text) => { status.textContent = text; },
    };
    this._game = g.mount(gameHost, api);
    this._timers.push(setTimeout(() => this._pulseHint(), IDLE_HINT_MS));
  }

  _unmountGame() {
    if (this._game) {
      try { this._game.destroy(); } catch { /* ignore */ }
      this._game = null;
    }
  }

  _pulseHint() {
    const btn = this._el?.querySelector('[data-hint]');
    if (btn && !btn.disabled) btn.classList.add('a13-pulse');
  }

  _showHint(g) {
    const card = this._el.querySelector('[data-puzzle]');
    const list = card.querySelector('[data-hints]');
    const btn = card.querySelector('[data-hint]');
    if (this._hintsShown >= g.hints.length) return;
    fx.sfx.blip();
    const li = document.createElement('li');
    li.className = 'a13-hints__item';
    li.textContent = g.hints[this._hintsShown];
    list.appendChild(li);
    list.hidden = false;
    this._hintsShown += 1;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.remove('a13-pulse');
    btn.querySelector('[data-hint-count]').textContent = `${this._hintsShown}/${g.hints.length}`;
    if (this._hintsShown >= g.hints.length) btn.disabled = true;
    if (this._game && this._game.hint) this._game.hint(this._hintsShown);
  }

  // ── Solve + reveal ─────────────────────────────────────────────────────────

  async _solve(value) {
    if (this._step >= GAMES.length) return;
    const g = GAMES[this._step];
    this._token += 1;
    const token = this._token;
    this._unmountGame();
    this._step += 1;
    this._saveStep();

    let newBest = false;
    if (value !== undefined && Number.isFinite(value)) {
      const prev = this._best[g.id];
      if (prev === undefined || g.stat.better(value, prev)) { this._best[g.id] = value; newBest = prev !== undefined; }
      this._saveBest();
    }
    this._renderProgress();
    this._renderUnlocked();

    const host = this._el.querySelector('[data-stage]');
    const last = this._step >= GAMES.length;
    const statLine = value !== undefined && Number.isFinite(value)
      ? `${g.stat.label}: ${escHtml(g.stat.fmt(value))}${newBest ? ' · NÝTT MET!' : (this._best[g.id] !== undefined && this._best[g.id] !== value ? ` · Besta: ${escHtml(g.stat.fmt(this._best[g.id]))}` : '')}`
      : '';
    host.innerHTML = `
      <div class="a13-reveal a13-reveal--${g.theme} a13-pop" tabindex="-1" data-testid="aron13-reveal">
        <div class="a13-reveal__art"><span class="a13-reveal__chest" data-chest>${px('chestClosed', { scale: 6 })}</span></div>
        <div class="a13-reveal__rett" data-rett hidden>${pixelText('KISTA OPNUÐ', { scale: 4, colour: 'y', shadow: null })}</div>
        <p class="a13-reveal__msg" role="status" aria-live="polite" data-msg></p>
        <p class="a13-reveal__stat" data-stat ${statLine ? '' : 'hidden'}>${statLine}</p>
        <button type="button" class="a13-btn a13-btn--go" data-next data-testid="aron13-next" hidden>${last ? 'Sjá gjafirnar' : 'Áfram →'}</button>
      </div>
    `;
    const reveal = host.querySelector('.a13-reveal');
    reveal.focus({ preventScroll: true });
    const alive = () => token === this._token && reveal.isConnected;

    const chest = reveal.querySelector('[data-chest]');
    fx.sfx.pop();
    chest.classList.add('a13-chest-open');
    await wait(450, this._timers);
    if (!alive()) return;
    chest.innerHTML = px('chestOpen', { scale: 6 });
    fx.sfx.diamond();
    fx.particles.sparkle(chest);
    await wait(250, this._timers);
    if (!alive()) return;
    reveal.querySelector('[data-rett]').hidden = false;
    fx.sfx.win();
    await wait(350, this._timers);
    if (!alive()) return;
    await fx.typewriter(reveal.querySelector('[data-msg]'), g.reveal, this._timers);
    if (!alive()) return;
    this._confetti();
    fx.toast(g.achievement, g.achievementBody, px(g.icon, { scale: 4 }));
    const next = reveal.querySelector('[data-next]');
    next.hidden = false;
    next.classList.add('a13-pop');
    next.addEventListener('click', () => { fx.sfx.blip(); this._renderStage(); });
    next.focus({ preventScroll: true });
  }

  // ── Done ───────────────────────────────────────────────────────────────────

  async _renderDone(host) {
    const token = this._token;
    const gifts = GAMES.slice(1);
    const stats = GAMES.filter(g => this._best[g.id] !== undefined)
      .map(g => `<span>${g.stat.label}: <b>${escHtml(g.stat.fmt(this._best[g.id]))}</b></span>`).join('');
    host.innerHTML = `
      <div class="a13-done a13-pop" data-testid="aron13-done">
        <div class="a13-done__head">
          <div class="a13-done__fw" aria-hidden="true">
            ${px('firework', { scale: 5 })}${px('trophy', { scale: 6 })}${px('firework', { scale: 5 })}
          </div>
          <div class="a13-done__title">${pixelText('TIL HAMINGJU', { scale: 4, colour: 'y', shadow: null })}</div>
          <div class="a13-done__name">${pixelText('ARON', { scale: 8, colour: 'w', shadow: 'c' })}</div>
        </div>
        <h2 class="a13-visually-hidden">Til hamingju með 13 ára afmælið, Aron!</h2>
        <p class="a13-done__sub">Þú kláraðir alla leikina. Hér eru gjafirnar þínar:</p>
        <ul class="a13-gifts">
          ${gifts.map((g, i) => `
            <li class="a13-gift">
              ${px('diamondBlock', { scale: 5 })}
              <span class="a13-gift__n">Gjöf ${i + 1}</span>
              <span class="a13-gift__msg" data-gift="${i}"></span>
            </li>`).join('')}
        </ul>
        ${stats ? `<div class="a13-done__stats">${stats}</div>` : ''}
        <div class="a13-done__crew" aria-hidden="true">
          ${px('creeperFace', { scale: 5 })}${px('blockyGuy', { scale: 4 })}${px('pickaxe', { scale: 4 })}${px('sword', { scale: 4 })}${px('robuxCoin', { scale: 5 })}${px('cake', { scale: 4 })}
        </div>
        <button type="button" class="a13-btn a13-btn--ghost" data-again>Spila aftur</button>
      </div>
    `;
    host.querySelector('[data-again]').addEventListener('click', () => this._reset());

    // Fireworks show.
    fx.sfx.win();
    if (!fx.reduced) {
      const until = Date.now() + FIREWORKS_MS;
      const fire = () => {
        if (token !== this._token || !host.isConnected) return;
        const x = 40 + Math.random() * (window.innerWidth - 80);
        const y = 60 + Math.random() * (window.innerHeight * 0.55);
        fx.particles.firework(x, y);
        fx.sfx.pop();
        if (Date.now() < until) this._timers.push(setTimeout(fire, 450 + Math.random() * 400));
      };
      fire();
    }
    this._confetti();

    for (let i = 0; i < gifts.length; i++) {
      const el = host.querySelector(`[data-gift="${i}"]`);
      if (!el || token !== this._token) return;
      await fx.typewriter(el, gifts[i].reveal, this._timers);
      await wait(300, this._timers);
    }
  }

  // ── Confetti ───────────────────────────────────────────────────────────────

  _confetti() {
    if (fx.reduced) return;
    if (this._confettiEl) this._confettiEl.remove();
    const layer = document.createElement('div');
    layer.className = 'a13-confetti';
    layer.setAttribute('aria-hidden', 'true');
    const colours = ['grass', 'diamond', 'red', 'gold', 'dirt', 'creeper', 'paper'];
    // Fewer bits on a phone so the typed message stays readable underneath.
    const count = Math.min(CONFETTI_COUNT, Math.max(40, Math.round(window.innerWidth / 6)));
    let html = '';
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 100;
      const dx = (Math.random() * 240 - 120).toFixed(0);
      const rot = (360 + Math.random() * 720).toFixed(0);
      const dur = (2.2 + Math.random() * 1.6).toFixed(2);
      const delay = (Math.random() * 0.7).toFixed(2);
      const size = (6 + Math.random() * 7).toFixed(0);
      const tall = Math.random() < 0.5 ? 1 : 2;
      const c = colours[i % colours.length];
      html += `<span class="a13-confetti__bit" style="--x:${x.toFixed(1)}vw;--dx:${dx}px;--r:${rot}deg;--d:${dur}s;--dl:${delay}s;--s:${size}px;--t:${tall};--c:var(--a13-${c})"></span>`;
    }
    layer.innerHTML = html;
    document.body.appendChild(layer);
    this._confettiEl = layer;
    this._timers.push(setTimeout(() => {
      layer.remove();
      if (this._confettiEl === layer) this._confettiEl = null;
    }, CONFETTI_TTL_MS));
  }
}
