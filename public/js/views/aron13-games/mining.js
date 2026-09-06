/**
 * Game 1 — Demantanáma. A 6×6 wall of blocks; break them with the pickaxe and
 * find the three diamonds hidden underneath. TNT costs a heart, gold is a bonus.
 *
 * Contract: mountMining(host, api) → { destroy(), hint(n) }
 *   api = { onWin(stat), onFail(), onStatus(text), px, fx }
 * What hides under each block lives only in JS state — never in the DOM.
 */

const COLS = 6;
const ROWS = 6;
const N = COLS * ROWS;
const DIAMONDS = 3;
const TNT = 2; // fewer than the hearts, so "break everything" always survives
const GOLD = 3;
const HEARTS = 3;

const rowKind = (r) => (r === 0 ? 'grass' : r <= 2 ? 'dirt' : 'stone');
const kindSprite = { grass: 'grassBlock', dirt: 'dirtBlock', stone: 'stoneBlock' };
const kindHp = { grass: 1, dirt: 1, stone: 3 };

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pickCells(pool, count, taken) {
  const free = pool.filter(i => !taken.has(i));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const out = free.slice(0, count);
  out.forEach(i => taken.add(i));
  return out;
}

export function mountMining(host, api) {
  const { px, fx } = api;
  let hidden, hp, hearts, found, gold, done, start, timerId;
  const timers = [];

  function layout() {
    hidden = Array(N).fill(null);
    hp = [];
    for (let i = 0; i < N; i++) hp.push(kindHp[rowKind(Math.floor(i / COLS))]);
    const taken = new Set();
    const rowsFrom = (from) => Array.from({ length: N }, (_, i) => i).filter(i => Math.floor(i / COLS) >= from);
    pickCells(rowsFrom(3), DIAMONDS, taken).forEach(i => { hidden[i] = 'diamond'; });
    pickCells(rowsFrom(1), TNT, taken).forEach(i => { hidden[i] = 'tnt'; });
    pickCells(rowsFrom(2), GOLD, taken).forEach(i => { hidden[i] = 'gold'; });
    hearts = HEARTS;
    found = 0;
    gold = 0;
    done = false;
  }

  function hudHtml() {
    return `
      <div class="a13-hud" data-hud>
        <span class="a13-hud__hearts" data-hearts aria-label="Líf"></span>
        <span class="a13-hud__stat" data-diamonds aria-live="polite"></span>
        <span class="a13-hud__stat" data-gold></span>
        <span class="a13-hud__stat a13-hud__timer" data-timer>0:00</span>
      </div>`;
  }

  function gridHtml() {
    let cells = '';
    for (let i = 0; i < N; i++) {
      const kind = rowKind(Math.floor(i / COLS));
      cells += `<button type="button" class="a13-mine__cell a13-mine__cell--${kind}" data-cell="${i}" aria-label="Kubbur ${i + 1}">${px(kindSprite[kind], { scale: 5 })}</button>`;
    }
    return `
      <div class="a13-mine" data-board>
        ${cells}
        <span class="a13-mine__pick" data-pick aria-hidden="true">${px('pickaxe', { scale: 3 })}</span>
      </div>`;
  }

  function render() {
    host.innerHTML = `${hudHtml()}${gridHtml()}`;
    host.querySelectorAll('[data-cell]').forEach(btn => {
      btn.addEventListener('click', () => hit(Number(btn.dataset.cell), btn));
    });
    updateHud();
  }

  function updateHud() {
    const h = host.querySelector('[data-hearts]');
    h.innerHTML = Array.from({ length: HEARTS }, (_, i) => px(i < hearts ? 'heart' : 'heartEmpty', { scale: 3 })).join('');
    const d = host.querySelector('[data-diamonds]');
    d.innerHTML = `${Array.from({ length: DIAMONDS }, (_, i) => `<span class="a13-hud__gem${i < found ? ' is-on' : ''}">${px('diamond', { scale: 3 })}</span>`).join('')} <b>${found}/${DIAMONDS}</b>`;
    d.setAttribute('aria-label', `Demantar ${found} af ${DIAMONDS}`);
    host.querySelector('[data-gold]').innerHTML = `${px('goldOre', { scale: 3 })} <b>${gold}</b>`;
  }

  function swing(btn) {
    const pick = host.querySelector('[data-pick]');
    if (!pick || fx.reduced) return;
    pick.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
    pick.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
    pick.classList.remove('is-swing');
    void pick.offsetWidth;
    pick.classList.add('is-swing');
  }

  function hit(i, btn) {
    if (done || btn.disabled) return;
    hp[i] -= 1;
    fx.sfx.hit();
    fx.haptic(10);
    swing(btn);
    if (hp[i] > 0) {
      // Destroy-stage overlay: a pixel crack sprite on top of the block.
      const kind = rowKind(Math.floor(i / COLS));
      btn.innerHTML = `${px(kindSprite[kind], { scale: 5 })}<span class="a13-mine__crack">${px(hp[i] === 2 ? 'crack1' : 'crack2', { scale: 5 })}</span>`;
      btn.classList.add('is-cracked');
      return;
    }
    breakCell(i, btn);
  }

  function breakCell(i, btn) {
    const kind = rowKind(Math.floor(i / COLS));
    fx.sfx.break();
    fx.particles.debris(btn, kind);
    btn.classList.remove('is-cracked');
    btn.classList.add('is-broken');
    btn.disabled = true;
    const what = hidden[i];
    if (what === 'diamond') {
      btn.innerHTML = `<span class="a13-pop">${px('diamond', { scale: 4 })}</span>`;
      btn.classList.add('is-diamond');
      found += 1;
      fx.sfx.diamond();
      fx.particles.sparkle(btn);
      fx.haptic([20, 30, 20]);
      updateHud();
      api.onStatus(found < DIAMONDS ? `Demantur! ${DIAMONDS - found} eftir.` : '');
      if (found >= DIAMONDS) win();
    } else if (what === 'gold') {
      btn.innerHTML = `<span class="a13-pop">${px('goldOre', { scale: 4 })}</span>`;
      gold += 1;
      fx.sfx.gold();
      fx.particles.gold(btn);
      updateHud();
    } else if (what === 'tnt') {
      btn.innerHTML = `<span class="a13-pop">${px('tnt', { scale: 4 })}</span>`;
      btn.classList.add('is-tnt');
      hearts -= 1;
      fx.sfx.boom();
      fx.screenShake();
      fx.flash();
      fx.particles.boom(btn);
      fx.haptic([60, 40, 60]);
      updateHud();
      api.onStatus('BÚMM! Passaðu þig á TNT');
      api.onFail();
      if (hearts <= 0) gameOver();
    } else {
      btn.innerHTML = px('caveBlock', { scale: 5 });
    }
  }

  function gameOver() {
    done = true;
    const ov = document.createElement('div');
    ov.className = 'a13-overlay';
    ov.innerHTML = `
      <div class="a13-overlay__card a13-pop">
        <div class="a13-overlay__title">${px('tnt', { scale: 5 })}</div>
        <p class="a13-overlay__msg">Náman hrundi! Of mikið TNT. Prófaðu nýja námu.</p>
        <button type="button" class="a13-btn a13-btn--go" data-retry data-testid="aron13-retry">Reyna aftur</button>
      </div>`;
    host.querySelector('[data-board]').appendChild(ov);
    ov.querySelector('[data-retry]').addEventListener('click', () => {
      fx.sfx.blip();
      layout();
      render();
    });
  }

  function win() {
    done = true;
    clearInterval(timerId);
    const elapsed = (Date.now() - start) / 1000;
    host.querySelector('[data-timer]').textContent = fmt(elapsed);
    timers.push(setTimeout(() => api.onWin(elapsed), 500));
  }

  layout();
  render();
  start = Date.now();
  timerId = setInterval(() => {
    const t = host.querySelector('[data-timer]');
    if (t) t.textContent = fmt((Date.now() - start) / 1000);
  }, 250);

  return {
    hint() { /* the hints are words only for this game */ },
    destroy() {
      clearInterval(timerId);
      timers.forEach(clearTimeout);
      host.innerHTML = '';
    },
  };
}

export { fmt as formatTime };
