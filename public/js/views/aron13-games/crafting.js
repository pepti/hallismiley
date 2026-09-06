/**
 * Game 3 — Smíðaborð. A 3×3 crafting grid and an inventory. Place two diamonds
 * over a stick in one column and craft a diamond sword.
 *
 * Works two ways everywhere: tap an item then tap a cell, or drag an item
 * onto a cell (pointer events, so mouse and touch alike).
 *
 * Contract: mountCrafting(host, api) → { destroy(), hint(n) }
 */
import { pixelText } from '../aron13-font.js';

const QMARK = () => pixelText('?', { scale: 5, colour: 'S', shadow: null, title: 'Tómt' });

const ITEMS = [
  { id: 'diamond',   name: 'Demantur' },
  { id: 'stick',     name: 'Prik' },
  { id: 'ironIngot', name: 'Járn' },
  { id: 'plank',     name: 'Viðarborð' },
  { id: 'emerald',   name: 'Smaragður' },
];

const GHOST = { 1: 'diamond', 4: 'diamond', 7: 'stick' };
const DRAG_THRESHOLD = 6;

export function mountCrafting(host, api) {
  const { px, fx } = api;
  const grid = Array(9).fill(null);
  let selected = null;
  let attempts = 0;
  let matched = false;
  let ghost = false;
  let drag = null;
  const timers = [];

  function itemHtml(it) {
    return `
      <button type="button" class="a13-craft__item" data-item="${it.id}" aria-pressed="false" title="${it.name}">
        ${px(it.id, { scale: 4 })}
        <span class="a13-craft__name">${it.name}</span>
      </button>`;
  }

  function render() {
    host.innerHTML = `
      <div class="a13-craft">
        <div class="a13-craft__inv" role="group" aria-label="Hlutir">
          ${ITEMS.map(itemHtml).join('')}
        </div>
        <div class="a13-craft__bench">
          <div class="a13-craft__table" aria-hidden="true">${px('craftingTable', { scale: 3 })}</div>
          <div class="a13-craft__grid" data-grid role="group" aria-label="Smíðaborð 3 sinnum 3">
            ${Array.from({ length: 9 }, (_, i) => `<button type="button" class="a13-craft__cell" data-cell="${i}" aria-label="Reitur ${i + 1}, tómur"></button>`).join('')}
          </div>
          <div class="a13-craft__arrow" aria-hidden="true">${px('arrowRight', { scale: 4 })}</div>
          <div class="a13-craft__result" data-result aria-live="polite" aria-label="Útkoma"><span class="a13-craft__q">${QMARK()}</span></div>
        </div>
        <div class="a13-craft__actions">
          <button type="button" class="a13-btn a13-btn--ghost" data-clear>Tæma</button>
          <button type="button" class="a13-btn a13-btn--go" data-craft data-testid="aron13-craft" disabled>Smíða!</button>
        </div>
      </div>`;

    host.querySelectorAll('[data-item]').forEach(btn => {
      btn.addEventListener('click', (e) => { if (e.detail === 0) toggleSelect(btn.dataset.item); }); // keyboard
      btn.addEventListener('pointerdown', (e) => onPointerDown(e, btn));
      btn.addEventListener('pointermove', onPointerMove);
      btn.addEventListener('pointerup', (e) => onPointerUp(e, btn));
      btn.addEventListener('pointercancel', endDrag);
    });
    host.querySelectorAll('[data-cell]').forEach(btn => {
      btn.addEventListener('click', () => onCell(Number(btn.dataset.cell)));
    });
    host.querySelector('[data-clear]').addEventListener('click', clearAll);
    host.querySelector('[data-craft]').addEventListener('click', craft);
    paint();
  }

  // ── Pointer: tap selects, drag carries a clone ────────────────────────────

  function onPointerDown(e, btn) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { id: btn.dataset.item, btn, x0: e.clientX, y0: e.clientY, moving: false, clone: null, pointerId: e.pointerId };
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moving = true;
      const clone = document.createElement('div');
      clone.className = 'a13-craft__drag';
      clone.setAttribute('aria-hidden', 'true');
      clone.innerHTML = px(drag.id, { scale: 4 });
      document.body.appendChild(clone);
      drag.clone = clone;
      drag.btn.classList.add('is-dragging');
    }
    drag.clone.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    const over = cellAt(e.clientX, e.clientY);
    host.querySelectorAll('[data-cell].is-over').forEach(c => c.classList.remove('is-over'));
    if (over) over.classList.add('is-over');
  }

  function onPointerUp(e, btn) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moving) {
      const over = cellAt(e.clientX, e.clientY);
      if (over) place(Number(over.dataset.cell), drag.id);
      endDrag();
      return;
    }
    endDrag();
    toggleSelect(btn.dataset.item);
  }

  function endDrag() {
    if (!drag) return;
    if (drag.clone) drag.clone.remove();
    drag.btn.classList.remove('is-dragging');
    host.querySelectorAll('[data-cell].is-over').forEach(c => c.classList.remove('is-over'));
    drag = null;
  }

  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-cell]') : null;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  function toggleSelect(id) {
    selected = selected === id ? null : id;
    fx.sfx.blip();
    paint();
  }

  function onCell(i) {
    if (selected) {
      if (grid[i] === selected) { grid[i] = null; fx.sfx.blip(); }
      else place(i, selected);
      return;
    }
    if (grid[i]) { grid[i] = null; fx.sfx.blip(); paint(); }
  }

  function place(i, id) {
    grid[i] = id;
    fx.sfx.snap();
    fx.haptic(8);
    paint();
    const cell = host.querySelector(`[data-cell="${i}"]`);
    if (cell) { cell.classList.remove('a13-pop'); void cell.offsetWidth; cell.classList.add('a13-pop'); }
  }

  function clearAll() {
    grid.fill(null);
    selected = null;
    fx.sfx.blip();
    paint();
  }

  function isMatch() {
    for (let c = 0; c < 3; c++) {
      if (grid[c] === 'diamond' && grid[c + 3] === 'diamond' && grid[c + 6] === 'stick') {
        const others = grid.filter((v, i) => i !== c && i !== c + 3 && i !== c + 6);
        if (others.every(v => v === null)) return true;
      }
    }
    return false;
  }

  function paint() {
    host.querySelectorAll('[data-item]').forEach(btn => {
      const on = btn.dataset.item === selected;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    host.querySelectorAll('[data-cell]').forEach(btn => {
      const i = Number(btn.dataset.cell);
      const v = grid[i];
      const name = v ? ITEMS.find(it => it.id === v).name : null;
      if (v) {
        btn.innerHTML = px(v, { scale: 4 });
        btn.classList.remove('is-ghost');
        btn.setAttribute('aria-label', `Reitur ${i + 1}, ${name}`);
      } else if (ghost && GHOST[i]) {
        btn.innerHTML = px(GHOST[i], { scale: 4 });
        btn.classList.add('is-ghost');
        btn.setAttribute('aria-label', `Reitur ${i + 1}, tómur (vísbending: ${ITEMS.find(it => it.id === GHOST[i]).name})`);
      } else {
        btn.innerHTML = '';
        btn.classList.remove('is-ghost');
        btn.setAttribute('aria-label', `Reitur ${i + 1}, tómur`);
      }
      btn.classList.toggle('is-filled', !!v);
    });

    const nowMatch = isMatch();
    const result = host.querySelector('[data-result]');
    if (nowMatch && !matched) {
      result.innerHTML = `<span class="a13-craft__sword a13-pop">${px('sword', { scale: 5 })}</span>`;
      result.classList.add('is-glow');
      result.setAttribute('aria-label', 'Útkoma: demantssverð');
      fx.sfx.diamond();
      fx.particles.sparkle(result);
      api.onStatus('');
    } else if (!nowMatch && matched) {
      result.innerHTML = `<span class="a13-craft__q">${QMARK()}</span>`;
      result.classList.remove('is-glow');
      result.setAttribute('aria-label', 'Útkoma');
    }
    matched = nowMatch;
    const filled = grid.filter(Boolean).length;
    host.querySelector('[data-craft]').disabled = !(matched || filled >= 3);
  }

  function craft() {
    attempts += 1;
    if (matched) {
      fx.sfx.craft();
      const sword = host.querySelector('.a13-craft__sword');
      const result = host.querySelector('[data-result]');
      if (sword) sword.classList.add('a13-fly');
      fx.particles.sparkle(result);
      fx.haptic([30, 30, 60]);
      host.querySelector('[data-craft]').disabled = true;
      timers.push(setTimeout(() => api.onWin(attempts), 550));
      return;
    }
    fx.sfx.hurt();
    fx.shake(host.querySelector('[data-grid]'));
    api.onStatus('Þetta er ekki demantssverð – prófaðu aftur');
    api.onFail();
  }

  render();

  return {
    hint(n) {
      if (n >= 3 && !ghost) { ghost = true; paint(); }
    },
    destroy() {
      endDrag();
      timers.forEach(clearTimeout);
      host.innerHTML = '';
    },
  };
}
