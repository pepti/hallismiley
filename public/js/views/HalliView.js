// HalliView — biographical life story page
// Full-screen sections, scroll animations, admin-editable content

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// ── Default content — compelling placeholder biography ────────────────────
const DEFAULT_CONTENT = {
  hero_tagline: 'Where wood meets code',

  beginning_eyebrow: 'Chapter One',
  beginning_title: 'The Beginning',
  beginning_text: 'Born and raised on the edge of the North Atlantic, Halli grew up in Iceland — a land shaped by fire, ice, and the stubborn ingenuity of people who had no choice but to make things themselves. His grandfather built his own house with bare hands. His father kept that tradition alive in the garage on weekends, a place that smelled of pine shavings and linseed oil, where every problem had a solution if you were patient enough to find it.',
  beginning_text2: 'At fourteen, he built his first piece of furniture — a small bookshelf, rough at the joints, proud in the room. It was never quite square. But it stood. That imperfect shelf taught him more about humility, precision, and persistence than any classroom ever would.',

  craft_eyebrow: 'Chapter Two',
  craft_title: 'The Craft',
  craft_text: 'Carpentry chose Halli as much as he chose it. There is a philosophy in working with wood that no other material quite matches — it has grain, history, and personality. Each plank carries the memory of the tree it came from: the years of drought and plenty, the direction of the prevailing wind. To work with wood is to collaborate with something older than yourself.',
  craft_text2: 'Over two decades, he has built dining tables that will outlast him, fitted kitchens into crooked old houses, and joined timber frames for buildings meant to stand a century. His philosophy has not changed since those first clumsy lessons: understand your material, respect your tools, measure twice.',
  craft_highlight1: 'Furniture designed to outlast its maker',
  craft_highlight2: 'Joinery cut by hand, fitted without filler',
  craft_highlight3: 'Every piece built for its exact place and purpose',

  code_eyebrow: 'Chapter Three',
  code_title: 'The Code',
  code_text: 'The path from wood to software was not a straight one. Late nights in a half-finished workshop, Halli started teaching himself to code — not because he wanted to leave carpentry behind, but because he needed tools that did not exist yet. Inventory systems, project tracking, client portals. If he could build a cabinet, he could build a web application.',
  code_text2: 'What surprised him was how familiar it all felt. The same discipline that keeps a workbench clean keeps a codebase maintainable. The same patience that lets you hand-cut a dovetail lets you debug a complex system. The vocabulary was different. The mindset was identical.',

  blend_eyebrow: 'Chapter Four',
  blend_title: 'The Blend',
  blend_quote: 'A craftsman does not choose their tools at random. They choose the sharpest, the most honest — and they learn to use them until the tool becomes an extension of thought.',
  blend_text: 'The way a craftsman thinks has a name in software: engineering. Not the noun, but the verb — the continuous act of making things more precise, more durable, more honest. Halli brings the same eye to a line of code that he brings to a mortise joint: is it right? Is it honest? Will it hold?',
  blend_text2: 'His clients in both worlds have noticed this. There is a quietness to work done well that transcends medium. A well-fitted door closes with a soft click. A well-designed API does exactly what it says, nothing more, nothing less.',

  life_eyebrow: 'Chapter Five',
  life_title: 'Life Outside Work',
  life_text: 'Between the workshop and the terminal, Halli is a husband and father who tries to leave both pursuits at the door when the evening calls for it. He hikes the Icelandic interior — highland plateaus where the only sound is wind and your own breathing — and returns with the particular clarity that only comes from distance.',
  life_text2: 'Iceland is not just his home; it is his material. The long volcanic winters, the silence, the strange light of summer — all of it bleeds into how he works, what he makes, and what he values.',
  life_tile1: 'Iceland',
  life_tile2: 'Hiking',
  life_tile3: 'Cooking',
  life_tile4: 'Reading',
  life_tile5: 'Coffee',

  future_eyebrow: 'Chapter Six',
  future_title: "What's Next",
  future_text: 'There are more tables to build. More systems to design. More problems that sit at the junction of physical and digital, waiting for someone who speaks both languages. The studio is taking shape — half workshop, half office — where the two disciplines share walls and tools and ideas.',
  future_text2: 'If you are working on something interesting — a product, a building, a tool that does not exist yet — reach out. The best work always begins with a conversation.',

  counter1_num: '20+',
  counter1_label: 'Years crafting wood',
  counter2_num: '10K+',
  counter2_label: 'Lines of code written',
  counter3_num: '80+',
  counter3_label: 'Projects completed',
  counter4_num: '1',
  counter4_label: 'Island nation called home',
};

// ── Wave SVG helper ────────────────────────────────────────────────────────
function wave(fromBg, toFill, flip = false) {
  const path = flip
    ? 'M0,40 C480,0 960,80 1440,40 L1440,80 L0,80 Z'
    : 'M0,40 C480,80 960,0 1440,40 L1440,80 L0,80 Z';
  return `<div class="hb-wave" style="background:${fromBg}">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 80"
         preserveAspectRatio="none" aria-hidden="true" height="80">
      <path d="${path}" fill="${toFill}"/>
    </svg>
  </div>`;
}

// ── HalliView class ────────────────────────────────────────────────────────
export class HalliView {
  constructor() {
    this._content      = null;
    this._observer     = null;
    this._counterObs   = null;
    this._countersAnimated = false;
  }

  async render() {
    await this._loadContent();

    const view = document.createElement('div');
    view.className = 'view halli-bio';

    view.innerHTML = `
      ${this._hero()}
      ${wave('#000', '#040c1a')}
      ${this._beginning()}
      ${wave('#040c1a', '#060e1c', true)}
      ${this._craft()}
      ${wave('#060e1c', '#040c1a')}
      ${this._code()}
      ${wave('#040c1a', '#080700', true)}
      ${this._counters()}
      ${wave('#080700', '#040c1a')}
      ${this._blend()}
      ${wave('#040c1a', '#0A1428', true)}
      ${this._life()}
      ${wave('#0A1428', '#060e1c')}
      ${this._future()}
    `;

    this._initScrollReveal(view);
    this._initCounters(view);
    this._initVideo(view);
    this._initAdminEdit(view);

    return view;
  }

  destroy() {
    this._observer?.disconnect();
    this._counterObs?.disconnect();
  }

  // ── Load content ─────────────────────────────────────────────────────────
  async _loadContent() {
    try {
      const res = await fetch(`/api/v1/content/halli_bio?locale=${encodeURIComponent(window.__locale || 'en')}`);
      if (res.ok) {
        this._content = await res.json();
        return;
      }
    } catch { /* fall through */ }
    this._content = { ...DEFAULT_CONTENT };
  }

  // ── Shorthand: get content key ────────────────────────────────────────────
  _c(key) {
    return escHtml(this._content[key] ?? DEFAULT_CONTENT[key] ?? '');
  }

  // ── SECTION: Hero ─────────────────────────────────────────────────────────
  _hero() {
    return `
    <section class="hb-hero" aria-label="Introduction">
      <video class="hb-hero__video" autoplay muted loop playsinline
             preload="auto" aria-hidden="true">
        <source src="/assets/videos/waterfall-bk-v1.mp4" type="video/mp4">
      </video>
      <div class="hb-hero__overlay" aria-hidden="true"></div>
      <div class="hb-hero__content">
        <h1 class="hb-hero__name" aria-label="Halli">Halli</h1>
        <p class="hb-hero__tagline">
          <span data-field="hero_tagline">${this._c('hero_tagline')}</span>
        </p>
      </div>
      <div class="hb-hero__scroll" aria-hidden="true">
        <span>Scroll</span>
        <div class="hb-hero__scroll-arrow"></div>
      </div>
    </section>`;
  }

  // ── SECTION: Beginning ────────────────────────────────────────────────────
  _beginning() {
    return `
    <section class="hb-section hb-section--1" aria-labelledby="hb-beginning-title">
      <div class="hb-inner">
        <div class="hb-two-col">
          <div>
            <span class="hb-eyebrow hb-reveal">
              <span data-field="beginning_eyebrow">${this._c('beginning_eyebrow')}</span>
            </span>
            <h2 class="hb-title hb-reveal hb-d1" id="hb-beginning-title">
              <span data-field="beginning_title">${this._c('beginning_title')}</span>
            </h2>
            <p class="hb-body hb-reveal hb-d2">
              <span data-field="beginning_text">${this._c('beginning_text')}</span>
            </p>
            <p class="hb-body hb-reveal hb-d3">
              <span data-field="beginning_text2">${this._c('beginning_text2')}</span>
            </p>
          </div>
          <div class="hb-reveal hb-reveal--right hb-d2" aria-hidden="true"
               style="display:flex;align-items:center;justify-content:center">
            ${this._icelandSvg()}
          </div>
        </div>
      </div>
    </section>`;
  }

  // ── SECTION: Craft ────────────────────────────────────────────────────────
  _craft() {
    return `
    <section class="hb-section hb-section--2" aria-labelledby="hb-craft-title">
      <div class="hb-inner">
        <span class="hb-eyebrow hb-reveal">
          <span data-field="craft_eyebrow">${this._c('craft_eyebrow')}</span>
        </span>
        <h2 class="hb-title hb-reveal hb-d1" id="hb-craft-title">
          <span data-field="craft_title">${this._c('craft_title')}</span>
        </h2>
        <div class="hb-two-col">
          <div>
            <p class="hb-body hb-reveal hb-d2">
              <span data-field="craft_text">${this._c('craft_text')}</span>
            </p>
            <p class="hb-body hb-reveal hb-d3">
              <span data-field="craft_text2">${this._c('craft_text2')}</span>
            </p>
          </div>
          <div class="hb-highlights hb-reveal hb-reveal--right hb-d2">
            <div class="hb-highlight" data-field="craft_highlight1">${this._c('craft_highlight1')}</div>
            <div class="hb-highlight" data-field="craft_highlight2">${this._c('craft_highlight2')}</div>
            <div class="hb-highlight" data-field="craft_highlight3">${this._c('craft_highlight3')}</div>
          </div>
        </div>
      </div>
    </section>
    <div class="hb-image-break hb-image-break--craft hb-reveal" role="img"
         aria-label="Workshop — carpentry in progress"></div>`;
  }

  // ── SECTION: Code ─────────────────────────────────────────────────────────
  _code() {
    return `
    <section class="hb-section hb-section--1" aria-labelledby="hb-code-title">
      <div class="hb-inner">
        <div class="hb-two-col">
          <div>
            <span class="hb-eyebrow hb-reveal">
              <span data-field="code_eyebrow">${this._c('code_eyebrow')}</span>
            </span>
            <h2 class="hb-title hb-reveal hb-d1" id="hb-code-title">
              <span data-field="code_title">${this._c('code_title')}</span>
            </h2>
            <p class="hb-body hb-reveal hb-d2">
              <span data-field="code_text">${this._c('code_text')}</span>
            </p>
            <p class="hb-body hb-reveal hb-d3">
              <span data-field="code_text2">${this._c('code_text2')}</span>
            </p>
          </div>
          <div class="hb-reveal hb-reveal--right hb-d2">
            <div class="hb-terminal" role="img" aria-label="Code sample">
              <div class="hb-terminal__bar">
                <span class="hb-terminal__dot"></span>
                <span class="hb-terminal__dot"></span>
                <span class="hb-terminal__dot"></span>
                <span class="hb-terminal__title">halli.js</span>
              </div>
              <div class="hb-terminal__body"><span class="tc">// Two disciplines, one craftsman</span>
<span class="tk">const</span> halli = {
  languages: [<span class="ts">'JavaScript'</span>, <span class="ts">'Python'</span>, <span class="ts">'SQL'</span>],
  tools: [<span class="ts">'hand plane'</span>, <span class="ts">'chisel'</span>, <span class="ts">'vim'</span>],
  philosophy: <span class="ts">'measure twice, ship once'</span>,
  home: <span class="ts">'Iceland'</span>,
  <span class="tk">craft</span>: () =&gt; <span class="to">true</span>,
};<span class="hb-cursor"></span></div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }

  // ── SECTION: Counters ─────────────────────────────────────────────────────
  _counters() {
    return `
    <section class="hb-section hb-section--amber hb-counters" aria-label="Key milestones">
      <div class="hb-counters__grid">
        <div class="hb-reveal hb-reveal--scale">
          <span class="hb-counter__num" data-counter="counter1_num"
                data-target="${escHtml(this._content.counter1_num ?? DEFAULT_CONTENT.counter1_num)}">0</span>
          <span class="hb-counter__label" data-field="counter1_label">${this._c('counter1_label')}</span>
        </div>
        <div class="hb-reveal hb-reveal--scale hb-d1">
          <span class="hb-counter__num" data-counter="counter2_num"
                data-target="${escHtml(this._content.counter2_num ?? DEFAULT_CONTENT.counter2_num)}">0</span>
          <span class="hb-counter__label" data-field="counter2_label">${this._c('counter2_label')}</span>
        </div>
        <div class="hb-reveal hb-reveal--scale hb-d2">
          <span class="hb-counter__num" data-counter="counter3_num"
                data-target="${escHtml(this._content.counter3_num ?? DEFAULT_CONTENT.counter3_num)}">0</span>
          <span class="hb-counter__label" data-field="counter3_label">${this._c('counter3_label')}</span>
        </div>
        <div class="hb-reveal hb-reveal--scale hb-d3">
          <span class="hb-counter__num" data-counter="counter4_num"
                data-target="${escHtml(this._content.counter4_num ?? DEFAULT_CONTENT.counter4_num)}">0</span>
          <span class="hb-counter__label" data-field="counter4_label">${this._c('counter4_label')}</span>
        </div>
      </div>
    </section>`;
  }

  // ── SECTION: Blend ────────────────────────────────────────────────────────
  _blend() {
    return `
    <section class="hb-section hb-section--1" aria-labelledby="hb-blend-title">
      <div class="hb-inner">
        <div class="hb-quote hb-reveal">
          <blockquote class="hb-quote__text">
            <span data-field="blend_quote">${this._c('blend_quote')}</span>
          </blockquote>
          <span class="hb-quote__attr">— Halli</span>
        </div>
        <div style="max-width:800px;margin:0 auto;padding:0 clamp(20px,6vw,80px)">
          <span class="hb-eyebrow hb-reveal">
            <span data-field="blend_eyebrow">${this._c('blend_eyebrow')}</span>
          </span>
          <h2 class="hb-title hb-reveal hb-d1" id="hb-blend-title">
            <span data-field="blend_title">${this._c('blend_title')}</span>
          </h2>
          <p class="hb-body hb-reveal hb-d2">
            <span data-field="blend_text">${this._c('blend_text')}</span>
          </p>
          <p class="hb-body hb-reveal hb-d3">
            <span data-field="blend_text2">${this._c('blend_text2')}</span>
          </p>
        </div>
      </div>
    </section>`;
  }

  // ── SECTION: Life ─────────────────────────────────────────────────────────
  _life() {
    const tiles = [
      { key: 'life_tile1', icon: '🌋' },
      { key: 'life_tile2', icon: '🥾' },
      { key: 'life_tile3', icon: '🍳' },
      { key: 'life_tile4', icon: '📚' },
      { key: 'life_tile5', icon: '☕' },
    ];

    const tileHTML = tiles.map(({ key, icon }) => `
      <div class="hb-life-tile">
        <span class="hb-life-tile__icon">${icon}</span>
        <span data-field="${key}">${this._c(key)}</span>
      </div>`).join('');

    return `
    <section class="hb-section hb-section--3" aria-labelledby="hb-life-title">
      <div class="hb-inner">
        <span class="hb-eyebrow hb-reveal">
          <span data-field="life_eyebrow">${this._c('life_eyebrow')}</span>
        </span>
        <h2 class="hb-title hb-reveal hb-d1" id="hb-life-title">
          <span data-field="life_title">${this._c('life_title')}</span>
        </h2>
        <div class="hb-two-col">
          <div>
            <p class="hb-body hb-reveal hb-d2">
              <span data-field="life_text">${this._c('life_text')}</span>
            </p>
            <p class="hb-body hb-reveal hb-d3">
              <span data-field="life_text2">${this._c('life_text2')}</span>
            </p>
          </div>
          <div class="hb-life-grid hb-reveal hb-reveal--right hb-d2">
            ${tileHTML}
          </div>
        </div>
      </div>
    </section>
    <div class="hb-image-break hb-image-break--life hb-reveal" role="img"
         aria-label="Iceland landscape"></div>`;
  }

  // ── SECTION: Future ───────────────────────────────────────────────────────
  _future() {
    return `
    <section class="hb-section hb-section--2" aria-labelledby="hb-future-title">
      <div class="hb-inner">
        <span class="hb-eyebrow hb-reveal">
          <span data-field="future_eyebrow">${this._c('future_eyebrow')}</span>
        </span>
        <h2 class="hb-title hb-reveal hb-d1" id="hb-future-title">
          <span data-field="future_title">${this._c('future_title')}</span>
        </h2>
        <p class="hb-body hb-reveal hb-d2">
          <span data-field="future_text">${this._c('future_text')}</span>
        </p>
        <p class="hb-body hb-reveal hb-d3">
          <span data-field="future_text2">${this._c('future_text2')}</span>
        </p>
        <a href="${href('/')}" data-scroll="contact" class="hb-cta hb-reveal hb-d4">
          ${t('halli.startConversation')}
        </a>
      </div>
    </section>`;
  }

  // ── Decorative Iceland SVG ────────────────────────────────────────────────
  _icelandSvg() {
    return `
    <svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg"
         style="max-width:280px;width:100%;opacity:0.35" aria-hidden="true">
      <!-- stylised Iceland outline / volcanic landscape -->
      <path d="M40,180 Q80,100 160,80 Q220,65 280,90 Q300,140 260,170 Q200,200 120,195 Q70,192 40,180 Z"
            fill="none" stroke="rgba(200,170,110,0.6)" stroke-width="1.5"/>
      <!-- volcano -->
      <path d="M155,80 L140,135 L170,135 Z"
            fill="none" stroke="rgba(200,170,110,0.4)" stroke-width="1"/>
      <!-- stars -->
      <circle cx="80"  cy="40" r="1"   fill="rgba(200,170,110,0.5)"/>
      <circle cx="140" cy="25" r="1.5" fill="rgba(200,170,110,0.6)"/>
      <circle cx="200" cy="35" r="1"   fill="rgba(200,170,110,0.5)"/>
      <circle cx="250" cy="20" r="1"   fill="rgba(200,170,110,0.4)"/>
      <circle cx="290" cy="50" r="1.5" fill="rgba(200,170,110,0.5)"/>
      <circle cx="50"  cy="60" r="1"   fill="rgba(200,170,110,0.4)"/>
      <!-- northern lights suggestion -->
      <path d="M30,70 Q100,50 200,65 Q260,72 300,55"
            fill="none" stroke="rgba(11,196,227,0.15)" stroke-width="3"/>
      <path d="M20,85 Q120,65 220,78 Q270,83 310,70"
            fill="none" stroke="rgba(11,196,227,0.1)" stroke-width="2"/>
    </svg>`;
  }

  // ── Init: scroll reveal via IntersectionObserver ──────────────────────────
  _initScrollReveal(view) {
    const els = view.querySelectorAll('.hb-reveal');
    if (!els.length) return;

    this._observer = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            this._observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    els.forEach(el => this._observer.observe(el));
  }

  // ── Init: counter animations ──────────────────────────────────────────────
  _initCounters(view) {
    const counters = view.querySelectorAll('[data-counter]');
    if (!counters.length) return;

    this._counterObs = new IntersectionObserver(
      entries => {
        if (this._countersAnimated) return;
        if (entries.some(e => e.isIntersecting)) {
          this._countersAnimated = true;
          counters.forEach(el => this._animateCounter(el, el.dataset.target));
          this._counterObs.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    counters.forEach(el => this._counterObs.observe(el));
  }

  _animateCounter(el, target) {
    const m = String(target).match(/^(\d+(?:\.\d+)?)(.*)/);
    if (!m) { el.textContent = target; return; }

    const num    = parseFloat(m[1]);
    const suffix = m[2];       // e.g. '+', 'K+', ''
    const dur    = 1400;
    const t0     = performance.now();

    const step = ts => {
      const p = Math.min((ts - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = Math.round(num * e) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── Init: hero video autoplay ─────────────────────────────────────────────
  _initVideo(view) {
    const video = view.querySelector('.hb-hero__video');
    if (!video) return;
    requestAnimationFrame(() => {
      video.play().catch(() => {
        const resume = () => { video.play().catch(() => {}); };
        document.addEventListener('click', resume, { once: true });
      });
    });
  }

  // ── Init: admin inline edit ───────────────────────────────────────────────
  _initAdminEdit(view) {
    if (!isAdmin() && !hasRole('moderator')) return;

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.type      = 'button';
    editBtn.className = 'hb-edit-btn';
    editBtn.setAttribute('data-testid', 'edit-page-btn');
    editBtn.setAttribute('aria-label', 'Edit Halli bio page');
    editBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      ${t('admin.editPage')}`;

    // Save/cancel bar
    const controls = document.createElement('div');
    controls.className = 'hb-edit-controls';
    controls.setAttribute('data-testid', 'edit-controls');
    controls.innerHTML = `
      ${adminLocaleBadgeHtml()}
      <button type="button" class="hb-edit-save"   data-testid="edit-save-btn">${t('form.save')}</button>
      <button type="button" class="hb-edit-cancel" data-testid="edit-cancel-btn">${t('admin.cancel')}</button>
      <span class="hb-edit-status" aria-live="polite"></span>`;

    view.appendChild(editBtn);
    view.appendChild(controls);

    let _snapshot = null;

    editBtn.addEventListener('click', () => {
      _snapshot = JSON.parse(JSON.stringify(this._content));
      this._enterEdit(view, editBtn, controls);
    });

    controls.querySelector('.hb-edit-save').addEventListener('click', () =>
      this._saveEdit(view, controls)
    );

    controls.querySelector('.hb-edit-cancel').addEventListener('click', () => {
      this._exitEdit(view, editBtn, controls);
      if (_snapshot) this._restoreContent(view, _snapshot);
    });
  }

  _enterEdit(view, editBtn, controls) {
    view.classList.add('halli-bio--editing');
    editBtn.classList.add('hb-edit-btn--hidden');
    controls.classList.add('is-visible');
    checkUntranslated('halli_bio', controls);

    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck      = true;
    });
  }

  _exitEdit(view, editBtn, controls) {
    view.classList.remove('halli-bio--editing');
    editBtn.classList.remove('hb-edit-btn--hidden');
    controls.classList.remove('is-visible');
    controls.querySelector('.hb-edit-status').textContent = '';

    view.querySelectorAll('[data-field]').forEach(el => {
      el.contentEditable = 'false';
      el.removeAttribute('contenteditable');
    });
  }

  _restoreContent(view, snapshot) {
    view.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field;
      if (snapshot[key] !== undefined) {
        el.textContent = snapshot[key];
      }
    });
    this._content = snapshot;
  }

  async _saveEdit(view, controls) {
    const status = controls.querySelector('.hb-edit-status');
    status.textContent = t('form.saving');

    // Collect all data-field values from DOM
    const updated = { ...this._content };
    view.querySelectorAll('[data-field]').forEach(el => {
      updated[el.dataset.field] = el.innerText.trim();
    });

    try {
      const token = await getCSRFToken();
      const res = await fetch('/api/v1/content/halli_bio', {
        method:      'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: JSON.stringify(updated),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      this._content   = await res.json();
      status.textContent = t('form.saved');
      setTimeout(() => { status.textContent = ''; }, 2500);

      const editBtn = view.querySelector('.hb-edit-btn');
      this._exitEdit(view, editBtn, controls);

    } catch (err) {
      status.textContent = `Error: ${err.message}`;
    }
  }
}
