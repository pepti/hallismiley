// HalliView — biographical life story page
// Full-screen sections, scroll animations, admin-editable content

import { isAdmin, hasRole, getCSRFToken } from '../services/auth.js';
import { escHtml } from '../utils/escHtml.js';
import { t, href, adminLocaleBadgeHtml, checkUntranslated } from '../i18n/i18n.js';

// ── Default content — consulting CV scaffold ──────────────────────────────
const DEFAULT_CONTENT = {
  hero_tagline: 'Carpenter × consulting engineer — Iceland',

  beginning_eyebrow: 'Background',
  beginning_title: 'The Beginning',
  beginning_text: 'Born and raised on the edge of the North Atlantic, Halli grew up in Iceland — a land shaped by fire, ice, and the stubborn ingenuity of people who had no choice but to make things themselves. His grandfather built his own house with bare hands; his father kept the tradition alive in the garage on weekends, where every problem had a solution if you were patient enough to find it.',

  craft_eyebrow: 'Carpentry experience',
  craft_title: 'The Craft',
  craft_text: 'Two decades working with wood — from framed structures standing against Icelandic weather to finish pieces that live indoors for generations. Halli takes jobs where precision, honest joinery, and long-horizon durability matter more than turnaround speed.',
  craft_text2: 'Hired for: heritage retrofits, custom cabinetry and furniture, timber-frame builds, and consultation on tricky builds that demand both structural thinking and a finish-carpentry eye.',
  craft_highlight1: 'Furniture designed to outlast its maker',
  craft_highlight2: 'Joinery cut by hand, fitted without filler',
  craft_highlight3: 'Every piece built for its exact place and purpose',

  craft_skill_groups: [
    {
      id: 'framing',
      title: 'Framing & Structural',
      items: [
        'Timber-frame construction and traditional joinery',
        'Load-bearing layout, lintel and header sizing',
        'Roof trusses, hip and valley cuts',
        'Insulation, vapour barrier and air-sealing detailing',
        'Retrofit work in heritage and out-of-square buildings',
      ],
    },
    {
      id: 'finish',
      title: 'Finish & Cabinetry',
      items: [
        'Fitted kitchens and built-in storage',
        'Hand-cut dovetail and mortise-and-tenon joinery',
        'Solid-wood furniture design and fabrication',
        'Hardwood flooring and stair construction',
        'Natural oil and hard-wax finishes',
      ],
    },
  ],

  craft_experience: [
    {
      id: 'reykjavik-kitchen',
      title: 'Heritage-home kitchen fit-out',
      meta: 'Reykjavík · 2023 · 6 weeks',
      outcome: 'Custom birch cabinetry fitted into a 1930s building with no square walls. Zero visible shims; every panel scribed on-site.',
    },
    {
      id: 'summerhouse-frame',
      title: 'Timber-frame summer house',
      meta: 'South Iceland · 2022 · Lead carpenter',
      outcome: 'Traditional post-and-beam frame, raised in four days with a three-person crew. Still standing square after three winters.',
    },
    {
      id: 'walnut-table',
      title: 'Commissioned walnut dining table',
      meta: 'Private client · 2024',
      outcome: '2.8 m solid walnut slab, hand-planed and finished with hard-wax oil. Designed to outlast its owner.',
    },
  ],

  code_eyebrow: 'Tech experience',
  code_title: 'The Code',
  code_text: 'Years building real software — inventory systems, client portals, bilingual full-stack sites. Halli writes code that is meant to be maintained, not just shipped, and makes technical decisions a business can actually live with.',
  code_text2: 'Hired for: full-stack builds for small teams, internal-tool consulting, technical design review, and projects that sit at the junction of physical workflow and digital process.',

  code_skill_groups: [
    {
      id: 'backend',
      title: 'Backend & Data',
      items: [
        'Node.js and Express API design',
        'PostgreSQL schema modelling and migrations',
        'Authentication, CSRF, and role-based access',
        'Background jobs and queue design',
        'Integration with third-party APIs',
      ],
    },
    {
      id: 'frontend',
      title: 'Frontend & UX',
      items: [
        'Vanilla-JS SPAs without framework bloat',
        'Accessible, keyboard-first UI',
        'i18n and locale-aware content',
        'Responsive layout without CSS frameworks',
        'Performance: lazy loading, asset hygiene',
      ],
    },
    {
      id: 'ops',
      title: 'Ops & Delivery',
      items: [
        'Linux servers, nginx, TLS, systemd',
        'CI pipelines and deployment automation',
        'Monitoring, logging, incident response',
        'Database backup and restore strategy',
        'Working with non-technical stakeholders',
      ],
    },
  ],

  code_experience: [
    {
      id: 'workshop-inventory',
      title: 'Workshop inventory & job-tracking system',
      meta: 'Self-built · production since 2022',
      outcome: 'Internal tool that tracks 400+ materials, open jobs, and client quotes. Replaced three spreadsheets and a whiteboard.',
    },
    {
      id: 'client-portal',
      title: 'Contractor client portal',
      meta: 'Freelance · 2024',
      outcome: 'Quote → contract → progress photos in one URL. Cut invoicing friction for a small construction firm.',
    },
    {
      id: 'site-rebuild',
      title: 'This website',
      meta: 'Greenfield · Node + Postgres + vanilla JS',
      outcome: 'Full-stack, bilingual, CMS-driven. Every line written, reviewed, and deployed by one person.',
    },
  ],

  blend_eyebrow: 'The combined edge',
  blend_title: 'The Blend',
  blend_text: 'Carpentry and software are the same discipline with different materials. Both reward patience, both punish guesswork, both are fundamentally about diagnosis — seeing the problem behind the problem a client describes.',
  blend_text2: 'Hire Halli when a project crosses domains: when a shop-floor workflow needs a digital twin, when software decisions will outlast their authors, or when you want an engineer who has also had to stand behind their joinery for twenty years.',

  blend_skill_groups: [
    {
      id: 'diagnosis',
      title: 'Diagnosis',
      items: [
        'Seeing the problem behind the stated problem',
        'Reading what a system tells you about itself',
        'Separating symptom from cause under time pressure',
      ],
    },
    {
      id: 'precision',
      title: 'Precision & Measurement',
      items: [
        'Committing in millimetres or milliseconds',
        'Tolerance-driven thinking',
        'Planning cuts you cannot take back',
      ],
    },
    {
      id: 'horizon',
      title: 'Long-Horizon Thinking',
      items: [
        'Building for the next twenty years, not the next sprint',
        'Choosing materials and dependencies that age well',
        'Documentation as a gift to future maintainers',
      ],
    },
    {
      id: 'communication',
      title: 'Client Communication',
      items: [
        'Translating craft vocabulary into business terms',
        'Quoting honestly, including the inconvenient',
        'Saying no to the wrong scope',
      ],
    },
  ],

  blend_experience: [
    {
      id: 'cabinet-config',
      title: 'Parametric cabinet configurator',
      meta: 'Hybrid project · 2023',
      outcome: 'Web tool that turns a customer\u2019s room dimensions into a cut list and a price. The shop floor reads what the browser sent.',
    },
    {
      id: 'job-tracker',
      title: 'Job-site progress app',
      meta: 'Field-tested on three builds',
      outcome: 'Mobile-friendly snapshot of a build\u2019s state — what is framed, what is wired, what is blocked. Written by someone who has been on both sides of the paper trail.',
    },
    {
      id: 'design-review',
      title: 'Technical design review for a small studio',
      meta: 'Advisory · 2024',
      outcome: 'Two days on-site, a written report, a follow-up call. The same eye that spots a warped joist spots a fragile API contract.',
    },
  ],

  life_eyebrow: 'Outside work',
  life_title: 'Life Outside Work',
  life_text: 'Between the workshop and the terminal, Halli is a husband and father who hikes the Icelandic interior and comes back with the clarity that only distance gives. Iceland is not just his home — it is his material.',
  life_tile1: 'Iceland',
  life_tile2: 'Hiking',
  life_tile3: 'Cooking',
  life_tile4: 'Reading',
  life_tile5: 'Coffee',

  // Image slots — admin-replaceable hero/divider images. The two URL keys
  // mirror the CSS fallbacks in halli-bio.css. `beginning_image_url` is left
  // unset so the inline _icelandSvg() decorative fallback renders by default.
  craft_image_url: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=1600&h=600&fit=crop&q=80',
  life_image_url:  'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&h=600&fit=crop&q=80',

};

// ── HalliView class ────────────────────────────────────────────────────────
export class HalliView {
  constructor() {
    this._content  = null;
    this._observer = null;
  }

  async render() {
    await this._loadContent();

    const view = document.createElement('div');
    view.className = 'view halli-bio';
    view.innerHTML = this._renderContent();

    this._initScrollReveal(view);
    this._initVideo(view);
    this._initAdminEdit(view);
    this._bindArrayControls(view);

    return view;
  }

  destroy() {
    this._observer?.disconnect();
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
          </div>
          <div class="hb-reveal hb-reveal--right hb-d2" aria-hidden="true"
               style="display:flex;align-items:center;justify-content:center">
            ${this._beginningImage()}
          </div>
        </div>
      </div>
    </section>`;
  }

  // ── SECTION: Craft (Carpentry CV) ─────────────────────────────────────────
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
        ${this._skillGroups('craft_skill_groups')}
        ${this._experience('craft_experience')}
      </div>
    </section>
    <div class="hb-image-break hb-image-break--craft hb-reveal" role="img"
         aria-label="Workshop — carpentry in progress"
         data-image-field="craft_image_url"
         style="background-image:url('${escHtml(this._content?.craft_image_url || '')}'); --hb-image-scale:${this._imageScale('craft_image_size')}">
      ${this._resizeControls('craft_image_size')}
    </div>`;
  }

  // ── SECTION: Code (Tech CV) ───────────────────────────────────────────────
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
        ${this._skillGroups('code_skill_groups')}
        ${this._experience('code_experience')}
      </div>
    </section>`;
  }

  // ── SECTION: Blend (Combined Edge CV) ─────────────────────────────────────
  _blend() {
    return `
    <section class="hb-section hb-section--2" aria-labelledby="hb-blend-title">
      <div class="hb-inner">
        <div class="hb-bridge hb-reveal" aria-hidden="true">
          <span class="hb-bridge__side">Wood</span>
          <span class="hb-bridge__link"></span>
          <span class="hb-bridge__side">Code</span>
        </div>
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
        ${this._skillGroups('blend_skill_groups')}
        ${this._experience('blend_experience')}
        <div class="hb-reveal hb-d4" style="margin-top:2.5rem">
          <a href="${href('/')}" data-scroll="contact" class="hb-cta">
            ${t('halli.startConversation')}
          </a>
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
          </div>
          <div class="hb-life-grid hb-reveal hb-reveal--right hb-d2">
            ${tileHTML}
          </div>
        </div>
      </div>
    </section>
    <div class="hb-image-break hb-image-break--life hb-reveal" role="img"
         aria-label="Iceland landscape"
         data-image-field="life_image_url"
         style="background-image:url('${escHtml(this._content?.life_image_url || '')}'); --hb-image-scale:${this._imageScale('life_image_size')}">
      ${this._resizeControls('life_image_size')}
    </div>`;
  }

  // ── Beginning section right-column image ──────────────────────────────────
  // Renders an admin-uploaded raster image when set, otherwise the decorative
  // Iceland SVG fallback. Wrapper carries `data-image-field` so the edit
  // handler can find the slot whether or not an image has been uploaded.
  _beginningImage() {
    const url   = this._content?.beginning_image_url;
    const scale = this._imageScale('beginning_image_size');
    const inner = url
      ? `<img src="${escHtml(url)}" alt="" data-image-field="beginning_image_url"
              style="max-width:calc(280px * var(--hb-image-scale, 1));width:100%;height:auto;border-radius:3px"/>`
      : `<div data-image-field="beginning_image_url"
              style="display:flex;align-items:center;justify-content:center">
           ${this._icelandSvg()}
         </div>`;
    return `<div class="hb-image-slot-wrapper" style="position:relative;display:inline-block;--hb-image-scale:${scale}">
              ${inner}
              ${this._resizeControls('beginning_image_size')}
            </div>`;
  }

  // Render the +/- size widget for an image slot. Only visible to admins
  // (and only while .halli-bio--editing is on, gated by CSS); for everyone
  // else this returns an empty string so the DOM stays clean.
  _resizeControls(sizeKey) {
    if (!isAdmin() && !hasRole('moderator')) return '';
    const pct = Math.round(this._imageScale(sizeKey) * 100);
    return `
      <div class="hb-image-resize" data-resize-slot="${sizeKey}">
        <button type="button" class="hb-image-resize__btn" data-resize-step="-0.1" aria-label="Smaller">−</button>
        <span class="hb-image-resize__value" data-resize-readout>${pct}%</span>
        <button type="button" class="hb-image-resize__btn" data-resize-step="0.1" aria-label="Bigger">+</button>
      </div>`;
  }

  // ── Image scale helper ─────────────────────────────────────────────────────
  // Returns a multiplier (0.3–3.0) clamped from the stored size value, default 1.
  // Used as a CSS variable so .hb-image-break heights and beginning-img widths
  // can be scaled by admin via the +/− controls in edit mode.
  _imageScale(key) {
    const raw = Number(this._content?.[key]);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.max(0.3, Math.min(3.0, raw));
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

  // ── Array-aware getter with legacy fallback ───────────────────────────────
  _array(key) {
    const live = this._content?.[key];
    if (Array.isArray(live) && live.length) return live;

    // Legacy: synthesise craft_skill_groups from craft_highlight1..3
    if (key === 'craft_skill_groups') {
      const bullets = ['craft_highlight1', 'craft_highlight2', 'craft_highlight3']
        .map(k => this._content?.[k])
        .filter(Boolean);
      if (bullets.length) {
        return [{ id: 'legacy', title: 'Highlights', items: bullets }];
      }
    }

    return DEFAULT_CONTENT[key] ?? [];
  }

  // ── Skill-groups block ────────────────────────────────────────────────────
  _skillGroups(key) {
    const groups = this._array(key);
    const rowsHTML = groups.map(g => this._skillGroupRow(g)).join('');
    const safeKey = escHtml(key);
    return `
      <div class="hb-skill-groups hb-reveal hb-d2" data-array="${safeKey}">
        ${rowsHTML}
        <button type="button" class="hb-array-add" data-array-ctrl="add" data-template="skill-group">+ Add skill group</button>
      </div>`;
  }

  _skillGroupRow(g) {
    const idAttr = g && g.id ? ` data-id="${escHtml(g.id)}"` : '';
    const title  = escHtml(g?.title ?? '');
    const items  = (g?.items ?? [])
      .map(it => `<li>${escHtml(it)}</li>`)
      .join('');
    return `
        <div class="hb-skill-group" data-row${idAttr}>
          <h4 class="hb-skill-group__title" data-field="title">${title}</h4>
          <ul class="hb-skill-list" data-field="items" data-multiline>${items || '<li></li>'}</ul>
          <button type="button" class="hb-array-remove" data-array-ctrl="remove">Remove group</button>
        </div>`;
  }

  // ── Experience cards block ────────────────────────────────────────────────
  _experience(key) {
    const items = this._array(key);
    const rowsHTML = items.map(e => this._experienceRow(e)).join('');
    const safeKey = escHtml(key);
    return `
      <div class="hb-experience hb-reveal hb-d3" data-array="${safeKey}">
        ${rowsHTML}
        <button type="button" class="hb-array-add" data-array-ctrl="add" data-template="experience">+ Add experience</button>
      </div>`;
  }

  _experienceRow(e) {
    const idAttr  = e && e.id ? ` data-id="${escHtml(e.id)}"` : '';
    const title   = escHtml(e?.title ?? '');
    const meta    = escHtml(e?.meta ?? '');
    const outcome = escHtml(e?.outcome ?? '');
    return `
        <article class="hb-exp-card" data-row${idAttr}>
          <h3 class="hb-exp-card__title"   data-field="title">${title}</h3>
          <span class="hb-exp-card__meta"  data-field="meta">${meta}</span>
          <p class="hb-exp-card__outcome"  data-field="outcome">${outcome}</p>
          <button type="button" class="hb-array-remove" data-array-ctrl="remove">Remove</button>
        </article>`;
  }

  _rowTemplate(kind) {
    if (kind === 'skill-group') return this._skillGroupRow({ title: '', items: [''] });
    if (kind === 'experience')  return this._experienceRow({ title: '', meta: '', outcome: '' });
    return '';
  }

  // ── Compose full view HTML (also used by cancel/restore) ──────────────────
  _renderContent() {
    return `
      ${this._hero()}
      ${this._beginning()}
      ${this._craft()}
      ${this._code()}
      ${this._blend()}
      ${this._life()}
    `;
  }

  // ── Serialize content from the DOM (used on save) ─────────────────────────
  _collectContent(view) {
    const updated = { ...this._content };

    // Flat fields outside any array
    view.querySelectorAll('[data-field]').forEach(el => {
      if (el.closest('[data-array]')) return;
      updated[el.dataset.field] = el.innerText.trim();
    });

    // Arrays
    view.querySelectorAll('[data-array]').forEach(container => {
      const rows = [];
      container.querySelectorAll(':scope > [data-row]').forEach(rowEl => {
        const row = {};
        rowEl.querySelectorAll('[data-field]').forEach(fEl => {
          if (fEl.closest('[data-array]') !== container) return;
          if (fEl.hasAttribute('data-multiline')) {
            row[fEl.dataset.field] = fEl.innerText
              .split('\n').map(s => s.trim()).filter(Boolean);
          } else {
            row[fEl.dataset.field] = fEl.innerText.trim();
          }
        });
        if (rowEl.dataset.id) row.id = rowEl.dataset.id;
        rows.push(row);
      });
      updated[container.dataset.array] = rows;
    });

    return updated;
  }

  // ── Delegated click handler: Add/Remove row buttons ───────────────────────
  _bindArrayControls(view) {
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-array-ctrl]');
      if (!btn || !view.contains(btn)) return;
      if (!view.classList.contains('halli-bio--editing')) return;

      if (btn.dataset.arrayCtrl === 'remove') {
        btn.closest('[data-row]')?.remove();
        return;
      }

      if (btn.dataset.arrayCtrl === 'add') {
        const html = this._rowTemplate(btn.dataset.template);
        if (!html) return;
        btn.insertAdjacentHTML('beforebegin', html);
        const newRow = btn.previousElementSibling;
        newRow?.querySelectorAll('[data-field]').forEach(el => {
          el.contentEditable = 'true';
          el.spellcheck = true;
        });
      }
    });
  }

  // ── Rebuild content from current this._content (cancel path) ──────────────
  _rerenderSections(view) {
    // Preserve admin UI refs (they're appended to view, not inside sections)
    const editBtn  = view.querySelector('.hb-edit-btn');
    const controls = view.querySelector('.hb-edit-controls');

    // Disconnect old observers — they reference soon-to-be-orphaned nodes
    this._observer?.disconnect();

    view.innerHTML = this._renderContent();

    // Re-append admin UI — listeners survive because we kept the element refs
    if (editBtn)  view.appendChild(editBtn);
    if (controls) view.appendChild(controls);

    // Re-init scroll reveal + video on the new nodes
    this._initScrollReveal(view);
    this._initVideo(view);

    // Re-attach the hidden file input that the image-edit handler relies on.
    // The click-delegation listener is on `view` itself and survives.
    this._initImageEdit(view, controls);
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

    this._initImageEdit(view, controls);
  }

  // ── Init: admin inline image upload ───────────────────────────────────────
  // Attaches a delegated click handler on `view` for any [data-image-field]
  // element. While in edit mode, clicking opens a file picker, the chosen
  // image is uploaded to /api/v1/content/halli_bio/image?field=<slot>, and the
  // DOM is patched in place — no full re-render — so the admin's edit-mode
  // state is preserved.
  _initImageEdit(view, controls) {
    if (!isAdmin() && !hasRole('moderator')) return;

    // Ensure a hidden file input exists in the DOM. Re-rendering the page
    // replaces view.innerHTML so we may need to recreate it.
    if (!this._imageFileInput || !view.contains(this._imageFileInput)) {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.className = 'hb-image-file-input';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        const field = this._activeImageField;
        if (!file || !field) return;
        await this._uploadImageField(view, controls, file, field);
      });
      view.appendChild(input);
      this._imageFileInput = input;
    }

    // Click delegation on `view` — bound once for the lifetime of the view.
    // Because `view` itself is not destroyed by _rerenderSections, the
    // listener survives across re-renders and works on any new descendants.
    if (!view.dataset.imageEditWired) {
      view.dataset.imageEditWired = '1';
      view.addEventListener('click', (ev) => {
        if (!view.classList.contains('halli-bio--editing')) return;

        // Resize buttons are nested inside the image-field slot, so check them
        // FIRST and bail before the slot-click code path opens the file picker.
        const resizeBtn = ev.target.closest('[data-resize-step]');
        if (resizeBtn && view.contains(resizeBtn)) {
          ev.preventDefault();
          ev.stopPropagation();
          this._handleResizeStep(view, resizeBtn);
          return;
        }

        const slot = ev.target.closest('[data-image-field]');
        if (!slot || !view.contains(slot)) return;
        ev.preventDefault();
        ev.stopPropagation();
        this._activeImageField = slot.dataset.imageField;
        if (this._imageFileInput) {
          this._imageFileInput.value = '';
          this._imageFileInput.click();
        }
      });
    }
  }

  // ── Resize step handler ───────────────────────────────────────────────────
  // Adjusts the stored size for an image slot by `step`, clamps to [0.3, 3.0],
  // updates the CSS variable in place (no re-render), and refreshes the
  // percentage readout. The new value is preserved by _saveEdit because
  // _collectContent does `{...this._content}` first.
  _handleResizeStep(view, btn) {
    const widget  = btn.closest('[data-resize-slot]');
    const sizeKey = widget?.dataset.resizeSlot;
    if (!sizeKey) return;

    const step    = Number(btn.dataset.resizeStep);
    const current = this._imageScale(sizeKey);
    const next    = Math.max(0.3, Math.min(3.0, +(current + step).toFixed(2)));
    if (next === current) return;

    if (!this._content) this._content = {};
    this._content[sizeKey] = next;

    // The size variable can live on either the slot itself (divider strips,
    // beginning <img>) or on the wrapper around the beginning slot. Walk up
    // the tree from the widget and update every relevant ancestor.
    const slotContainers = [
      widget.parentElement,                                // .hb-image-break OR .hb-image-slot-wrapper
      widget.parentElement?.querySelector('[data-image-field]'),  // beginning <img> sibling
    ].filter(Boolean);
    slotContainers.forEach(el => { el.style.setProperty('--hb-image-scale', next); });

    const readout = widget.querySelector('[data-resize-readout]');
    if (readout) readout.textContent = `${Math.round(next * 100)}%`;
  }

  async _uploadImageField(view, controls, file, field) {
    const status = controls?.querySelector('.hb-edit-status');
    if (status) status.textContent = t('form.saving');

    try {
      const token = await getCSRFToken();
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch(
        `/api/v1/content/halli_bio/image?field=${encodeURIComponent(field)}`,
        {
          method:      'POST',
          credentials: 'include',
          headers: token ? { 'X-CSRF-Token': token } : {},
          body:        fd,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { image_url } = await res.json();
      if (!this._content) this._content = {};
      this._content[field] = image_url;

      // Patch in place — preserves edit-mode state and avoids re-render.
      view.querySelectorAll(`[data-image-field="${field}"]`).forEach(el => {
        if (el.tagName === 'IMG') {
          el.src = image_url;
        } else if (field === 'beginning_image_url') {
          // The SVG fallback wrapper — swap its contents for an <img>.
          el.outerHTML = `<img src="${escHtml(image_url)}" alt=""
                               data-image-field="beginning_image_url"
                               style="max-width:280px;width:100%;height:auto;border-radius:3px"/>`;
        } else {
          el.style.backgroundImage = `url('${image_url}')`;
        }
      });

      if (status) {
        status.textContent = t('form.saved');
        setTimeout(() => { if (status.textContent === t('form.saved')) status.textContent = ''; }, 2500);
      }
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    }
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
    this._content = snapshot;
    this._rerenderSections(view);
  }

  async _saveEdit(view, controls) {
    const status = controls.querySelector('.hb-edit-status');
    status.textContent = t('form.saving');

    const updated = this._collectContent(view);

    try {
      const token = await getCSRFToken();
      const res = await fetch(`/api/v1/content/halli_bio?locale=${encodeURIComponent(window.__locale || 'en')}`, {
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
