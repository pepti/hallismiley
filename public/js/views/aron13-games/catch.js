/**
 * Game 2 — Náðu Robux. Coins fall from the sky; run left and right and catch
 * ten of them. From the fourth coin on, TNT falls too — catching it costs a
 * heart. Consecutive catches build a combo.
 *
 * Controls: arrow keys / A D, pointer drag or tap inside the arena, and two
 * hold buttons under it for phones.
 *
 * Contract: mountCatch(host, api) → { destroy(), hint(n) }
 */

const TARGET = 10;
const HEARTS = 3;
const PLAYER_SPEED = 280;      // px/s
const BASE_FALL = 140;         // px/s
const FALL_PER_CATCH = 8;
const SPAWN_MS_START = 900;
const SPAWN_MS_MIN = 650;
const PLAYER_W = 32;           // 8 px × scale 4
const PLAYER_H = 56;           // 14 px × scale 4
const OBJ = 32;                // 8 px × scale 4
const MAX_DT = 0.05;
const WATCHDOG_MS = 120;

export function mountCatch(host, api) {
  const { px, fx } = api;
  let arena, playerEl, W, H;
  let x, dir, walked, frame;
  let objects, caught, missed, hearts, combo, bestCombo;
  let keys, targetX, spawnIn, lastT, raf, running, finished, paused;
  let lastFrame = 0;
  let watchdog = null;
  const timers = [];

  function reset() {
    objects = [];
    caught = 0;
    missed = 0;
    hearts = HEARTS;
    combo = 0;
    bestCombo = 0;
    keys = { left: false, right: false };
    targetX = null;
    spawnIn = 600;
    lastT = 0;
    dir = 1;
    walked = 0;
    frame = 0;
    finished = false;
    paused = false;
  }

  function render() {
    host.innerHTML = `
      <div class="a13-hud" data-hud>
        <span class="a13-hud__hearts" data-hearts aria-label="Líf"></span>
        <span class="a13-hud__stat" data-score aria-live="polite"></span>
        <span class="a13-hud__stat" data-combo></span>
      </div>
      <div class="a13-catch" data-arena tabindex="0" role="application" aria-label="Náðu Robux. Örvatakkar eða draga með fingri.">
        <span class="a13-catch__cloud a13-catch__cloud--a" aria-hidden="true">${px('cloud', { scale: 4 })}</span>
        <span class="a13-catch__cloud a13-catch__cloud--b" aria-hidden="true">${px('cloud', { scale: 3 })}</span>
        <div class="a13-catch__objects" data-objects aria-hidden="true"></div>
        <div class="a13-catch__player" data-player aria-hidden="true">${px('blockyGuy', { scale: 4 })}</div>
        <div class="a13-catch__ground" aria-hidden="true"></div>
      </div>
      <div class="a13-catch__ctl" aria-hidden="true">
        <button type="button" class="a13-btn a13-catch__btn" data-left tabindex="-1">${px('arrowLeft', { scale: 4 })}</button>
        <button type="button" class="a13-btn a13-catch__btn" data-right tabindex="-1">${px('arrowRight', { scale: 4 })}</button>
      </div>`;
    arena = host.querySelector('[data-arena]');
    playerEl = host.querySelector('[data-player]');
    host.querySelector('[data-objects]').innerHTML = '';
    measure();
    x = W / 2;
    bind();
    updateHud();
    drawPlayer();
  }

  function measure() {
    W = arena.clientWidth || 600;
    H = arena.clientHeight || 320;
  }

  function bind() {
    arena.addEventListener('pointerdown', onPointer);
    arena.addEventListener('pointermove', onPointer);
    arena.addEventListener('pointerup', () => { targetX = null; });
    arena.addEventListener('pointercancel', () => { targetX = null; });
    const hold = (btn, key) => {
      const on = (e) => { e.preventDefault(); keys[key] = true; };
      const off = () => { keys[key] = false; };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    };
    hold(host.querySelector('[data-left]'), 'left');
    hold(host.querySelector('[data-right]'), 'right');
  }

  function onPointer(e) {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const r = arena.getBoundingClientRect();
    targetX = e.clientX - r.left;
    if (e.type === 'pointerdown') arena.focus({ preventScroll: true });
  }

  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const down = e.type === 'keydown';
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = down; e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = down; e.preventDefault(); }
  }

  function onVisibility() {
    if (document.hidden && running && !finished) pause();
  }

  function onResize() { if (arena) measure(); }

  // ── HUD ───────────────────────────────────────────────────────────────────

  function updateHud() {
    host.querySelector('[data-hearts]').innerHTML = Array.from({ length: HEARTS }, (_, i) => px(i < hearts ? 'heart' : 'heartEmpty', { scale: 3 })).join('');
    const s = host.querySelector('[data-score]');
    s.innerHTML = `${px('robuxCoin', { scale: 3 })} <b>${caught}/${TARGET}</b>`;
    s.setAttribute('aria-label', `Robux ${caught} af ${TARGET}`);
    host.querySelector('[data-combo]').innerHTML = combo >= 2 ? `<b>×${combo}</b> combo` : `besta combo <b>×${bestCombo}</b>`;
  }

  function drawPlayer() {
    const sprite = frame ? 'blockyGuyWalk' : 'blockyGuy';
    if (playerEl.dataset.frame !== sprite) {
      playerEl.innerHTML = px(sprite, { scale: 4 });
      playerEl.dataset.frame = sprite;
    }
    playerEl.style.transform = `translateX(${(x - PLAYER_W / 2).toFixed(1)}px) scaleX(${dir})`;
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  function spawn() {
    const isTnt = caught >= 3 && Math.random() < 0.25;
    const el = document.createElement('span');
    el.className = `a13-catch__obj ${isTnt ? 'a13-catch__obj--tnt' : 'a13-catch__obj--coin'}`;
    el.innerHTML = px(isTnt ? 'tnt' : 'robuxCoin', { scale: 4 });
    host.querySelector('[data-objects]').appendChild(el);
    objects.push({ el, x: OBJ / 2 + Math.random() * (W - OBJ), y: -OBJ, tnt: isTnt, vy: BASE_FALL + caught * FALL_PER_CATCH });
  }

  function onFrame(t) {
    if (!running) return;
    raf = requestAnimationFrame(onFrame);
    step(t);
  }

  function step(t) {
    if (!running) return;
    lastFrame = performance.now();
    if (!lastT) { lastT = t; return; }
    const dt = Math.min(MAX_DT, (t - lastT) / 1000);
    lastT = t;

    // Player
    let move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (!move && targetX !== null) {
      const d = targetX - x;
      if (Math.abs(d) > 4) move = Math.sign(d);
    }
    if (move) {
      x = Math.max(PLAYER_W / 2, Math.min(W - PLAYER_W / 2, x + move * PLAYER_SPEED * dt));
      dir = move;
      walked += PLAYER_SPEED * dt;
      if (walked > 110) { walked = 0; frame = frame ? 0 : 1; }
    } else {
      frame = 0;
    }
    drawPlayer();

    // Spawn
    spawnIn -= dt * 1000;
    if (spawnIn <= 0) {
      spawn();
      spawnIn = Math.max(SPAWN_MS_MIN, SPAWN_MS_START - caught * 25);
    }

    // Objects
    const playerTop = H - 20 - PLAYER_H;
    const floor = H - 20;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.y += o.vy * dt;
      o.el.style.transform = `translate(${(o.x - OBJ / 2).toFixed(1)}px, ${o.y.toFixed(1)}px)`;
      const bottom = o.y + OBJ;
      const overlapX = Math.abs(o.x - x) < (OBJ + PLAYER_W) / 2 - 6;
      if (overlapX && bottom >= playerTop + 8 && o.y < floor) {
        objects.splice(i, 1);
        if (o.tnt) hitTnt(o); else catchCoin(o);
        continue;
      }
      if (o.y > H) {
        objects.splice(i, 1);
        o.el.remove();
        if (!o.tnt) missCoin();
      }
    }
  }

  function catchCoin(o) {
    caught += 1;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    fx.sfx.coin();
    fx.particles.coinPop(o.el);
    fx.haptic(15);
    o.el.remove();
    if (combo >= 2) {
      fx.sfx.combo(combo);
      const pop = document.createElement('span');
      pop.className = 'a13-combo';
      pop.style.left = `${x}px`;
      pop.style.top = `${H - 20 - PLAYER_H - 24}px`;
      pop.textContent = `×${combo} COMBO`;
      arena.appendChild(pop);
      timers.push(setTimeout(() => pop.remove(), 800));
    }
    updateHud();
    if (caught >= TARGET) win();
  }

  function missCoin() {
    missed += 1;
    combo = 0;
    updateHud();
    if (missed % 5 === 0) {
      api.onStatus('Stattu undir myntinni áður en hún lendir');
      api.onFail();
    }
  }

  function hitTnt(o) {
    hearts -= 1;
    combo = 0;
    fx.sfx.boom();
    fx.screenShake();
    fx.flash();
    fx.particles.boom(o.el);
    fx.haptic([60, 40, 60]);
    o.el.remove();
    updateHud();
    api.onStatus('BÚMM! Forðastu TNT');
    api.onFail();
    if (hearts <= 0) gameOver();
  }

  function overlay(html) {
    const ov = document.createElement('div');
    ov.className = 'a13-overlay';
    ov.innerHTML = `<div class="a13-overlay__card a13-pop">${html}</div>`;
    arena.appendChild(ov);
    return ov;
  }

  function gameOver() {
    stop();
    const ov = overlay(`
      ${px('tnt', { scale: 5 })}
      <p class="a13-overlay__msg">Búinn! TNT-ið náði þér. Reyndu aftur – þú ert nálægt.</p>
      <button type="button" class="a13-btn a13-btn--go" data-retry data-testid="aron13-retry">Reyna aftur</button>`);
    ov.querySelector('[data-retry]').addEventListener('click', () => {
      fx.sfx.blip();
      objects.forEach(o => o.el.remove());
      reset();
      host.querySelector('[data-objects]').innerHTML = '';
      updateHud();
      ov.remove();
      start();
    });
  }

  function pause() {
    running = false;
    paused = true;
    cancelAnimationFrame(raf);
    const ov = overlay(`
      <p class="a13-overlay__msg">Hlé</p>
      <button type="button" class="a13-btn a13-btn--go" data-resume>Halda áfram</button>`);
    ov.querySelector('[data-resume]').addEventListener('click', () => {
      ov.remove();
      paused = false;
      start();
    });
  }

  function start() {
    running = true;
    lastT = 0;
    lastFrame = performance.now();
    raf = requestAnimationFrame(onFrame);
    // Watchdog: browsers that throttle rAF (background tab, battery saver)
    // would otherwise freeze the game mid-fall. Step manually when frames stall.
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (running && performance.now() - lastFrame > WATCHDOG_MS) step(performance.now());
    }, WATCHDOG_MS);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    clearInterval(watchdog);
  }

  function win() {
    finished = true;
    stop();
    fx.sfx.win();
    fx.particles.coinPop(playerEl);
    timers.push(setTimeout(() => api.onWin(bestCombo), 500));
  }

  reset();
  render();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  // Let layout settle so the arena has its real size before the first spawn.
  timers.push(setTimeout(() => { measure(); x = W / 2; drawPlayer(); start(); }, 30));
  arena.focus({ preventScroll: true });

  return {
    hint() { /* words only */ },
    destroy() {
      stop();
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      host.innerHTML = '';
      void paused;
    },
  };
}
