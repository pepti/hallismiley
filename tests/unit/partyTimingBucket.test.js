'use strict';

/**
 * Unit tests for the attendance-timing classification in
 * public/js/views/PartyAdminView.js — `_timingBucket`, `_answerStatus`,
 * `_answerTimingBucket`, `_attendField` and `_timingOptions`.
 *
 * These back the admin attendance table's "Mæting" column and the Stats
 * day/evening/all-day breakdown. They are pure label→meaning functions, and
 * they are load-bearing: the RSVP form is admin-editable AND auto-translated
 * per locale, so a guest's stored answer label frequently does NOT exist in
 * the form the admin currently has loaded (guest answers IS "Já, aðeins á
 * daginn"; admin's form says "☀️ Daytime only"). Matching by exact label is
 * what broke this column in production — every guest rendered "—".
 *
 * Regex ORDER is the subtle part (evening → all-day → day → bare-yes), so
 * each real production label is pinned explicitly in both locales.
 *
 * The module is authored as ESM; babel-jest compiles it to CJS for require()
 * (same approach as safeReturnTo.client.test.js). The methods under test are
 * pure w.r.t. `this` except for reading `this._rsvpForm`, so they're invoked
 * against a bare stub rather than a constructed view (which would need a DOM).
 */

const { PartyAdminView } = require('../../public/js/views/PartyAdminView');

const P = PartyAdminView.prototype;

// A stub `this` carrying just the form the methods read.
const withForm = (fields) => ({
  _rsvpForm:           fields,
  _attendField:        P._attendField,
  _optLabel:           P._optLabel,
  _optStatus:          P._optStatus,
  _timingBucket:       P._timingBucket,
  _answerStatus:       P._answerStatus,
  _answerTimingBucket: P._answerTimingBucket,
  _timingOptions:      P._timingOptions,
  _answerLabels:       P._answerLabels,
});

// The real production option sets.
const EN_OPTIONS = [
  { label: '☀️ Daytime only (14:00–18:00)', status: 'going' },
  { label: '🌙 Evening only (18:00–22:00)', status: 'going' },
  { label: '🎉 Both — all day!',            status: 'going' },
  { label: '🤔 Maybe',                      status: 'maybe' },
  { label: "Sorry, can't make it",          status: 'declined' },
];
const IS_OPTIONS = [
  { label: 'Já',                     status: 'going' },
  { label: 'Já, aðeins á daginn',    status: 'going' },
  { label: 'Já, aðeins um kvöldið',  status: 'going' },
  { label: 'Kannski',                status: 'maybe' },
  { label: 'Kemst ekki',             status: 'declined' },
];
const enForm = (opts = EN_OPTIONS) => [{ id: 'attend_when', type: 'radio-group', label: 'When will you join?', options: opts }];

// The REAL live production form: the attendance field is a CHECKBOX-group
// with bare-string options, id "attend", and a label ("Svar") that says
// nothing — only the id identifies it. This shape is why the Mæting column
// rendered "—" for every guest until checkbox-groups were supported.
const LIVE_IS_OPTIONS = ['Já', 'Já, aðeins á daginn', 'Já, aðeins um kvöldið', 'Get ekki mætt.', 'Kannski'];
const liveForm = () => [
  { id: 'heading',  type: 'heading',        label: '🎟  SVÖRUN' },
  { id: 'attend',   type: 'checkbox-group', label: 'Svar', options: LIVE_IS_OPTIONS },
  { id: 'bringing', type: 'checkbox-group', label: 'Ertu að koma með einhvern með þér?', options: ['Maki / partner', 'Börn'] },
];

const bucket = (label) => P._timingBucket.call({}, label);

describe('_timingBucket — pure label → timing bucket', () => {
  test('English production labels', () => {
    expect(bucket('☀️ Daytime only (14:00–18:00)')).toBe('day');
    expect(bucket('🌙 Evening only (18:00–22:00)')).toBe('evening');
    expect(bucket('🎉 Both — all day!')).toBe('both');
  });

  test('Icelandic production labels — the case that broke in prod', () => {
    expect(bucket('Já, aðeins á daginn')).toBe('day');
    expect(bucket('Já, aðeins um kvöldið')).toBe('evening');
  });

  test('a bare/unqualified yes means all day', () => {
    expect(bucket('Já')).toBe('both');
    expect(bucket('Já!')).toBe('both');
    expect(bucket('✅ Yes')).toBe('both');
    expect(bucket('Jú')).toBe('both');
    // Must survive translation into a fuller sentence — a strict "nothing but
    // the word yes" test would drop these back to null (no all-day option).
    expect(bucket("Yes, I'll be there")).toBe('both');
    expect(bucket('Já, ég kem')).toBe('both');
  });

  test('all-day wins over the day test (order matters)', () => {
    // Each of these contains "day"/"dag" and must NOT classify as day-only.
    expect(bucket('🎉 Both — all day!')).toBe('both');
    expect(bucket('Allan daginn')).toBe('both');
    expect(bucket('Heilan daginn')).toBe('both');
  });

  test('evening wins over a label that also mentions the day', () => {
    expect(bucket('Ekki á daginn, bara um kvöldið')).toBe('evening');
  });

  test('non-timing and junk input → null', () => {
    expect(bucket('🤔 Maybe')).toBeNull();
    expect(bucket('Kannski')).toBeNull();
    expect(bucket("Sorry, can't make it")).toBeNull();
    expect(bucket('Kemst ekki')).toBeNull();
    expect(bucket('')).toBeNull();
    expect(bucket('   ')).toBeNull();
    expect(bucket(null)).toBeNull();
    expect(bucket(undefined)).toBeNull();
    expect(bucket(42)).toBeNull();
    expect(bucket(['array'])).toBeNull();
  });

  test('decomposed (NFD) input still classifies', () => {
    // 'kvöld' with a combining diaeresis rather than the precomposed ö.
    expect(bucket('Já, aðeins um kvöldið'.normalize('NFD'))).toBe('evening');
  });
});

describe('_answerStatus — declared status wins, phrases are the fallback', () => {
  test('a label present in the form uses its declared status', () => {
    const v = withForm(enForm());
    expect(v._answerStatus('🤔 Maybe')).toBe('maybe');
    expect(v._answerStatus("Sorry, can't make it")).toBe('declined');
    expect(v._answerStatus('☀️ Daytime only (14:00–18:00)')).toBe('going');
  });

  test('the declaration beats the text — a "going" option worded like a decline', () => {
    const v = withForm(enForm([{ label: 'No problem, I am coming', status: 'going' }]));
    expect(v._answerStatus('No problem, I am coming')).toBe('going');
  });

  test('an answer absent from the form (other locale) falls back to phrases', () => {
    const v = withForm(enForm());          // EN form loaded, IS answers stored
    expect(v._answerStatus('Kemst ekki')).toBe('declined');
    expect(v._answerStatus('Kannski')).toBe('maybe');
    expect(v._answerStatus('Já, aðeins á daginn')).toBe('going');
  });

  test('legacy bare-string options count as going', () => {
    const v = withForm(enForm(['Some legacy option']));
    expect(v._optStatus('Some legacy option')).toBe('going');
    expect(v._answerStatus('Some legacy option')).toBe('going');
  });
});

describe('_answerTimingBucket — only guests who are coming have a timing', () => {
  test('a decline worded with a timing word gets NO bucket', () => {
    // The data-loss case: if this bucketed as 'day' the cell would pre-select
    // ☀️ for a decliner, and the select's "—" would wipe their real answer.
    const v = withForm(enForm([
      ...EN_OPTIONS.slice(0, 3),
      { label: "Can't make it that day", status: 'declined' },
    ]));
    expect(v._timingBucket("Can't make it that day")).toBe('day');   // text alone says day
    expect(v._answerTimingBucket("Can't make it that day")).toBeNull(); // status overrides
  });

  test('a maybe worded with a timing word gets NO bucket', () => {
    const v = withForm(enForm([
      ...EN_OPTIONS.slice(0, 3),
      { label: 'Kannski, kannski um kvöldið', status: 'maybe' },
    ]));
    expect(v._answerTimingBucket('Kannski, kannski um kvöldið')).toBeNull();
  });

  test('cross-locale declines are caught by the phrase fallback', () => {
    const v = withForm(enForm());
    expect(v._answerTimingBucket('Kemst ekki')).toBeNull();
  });

  test('going answers keep their bucket', () => {
    const v = withForm(enForm());
    expect(v._answerTimingBucket('Já, aðeins á daginn')).toBe('day');
    expect(v._answerTimingBucket('Já')).toBe('both');
  });
});

describe('_attendField — the canonical id wins over the label heuristic', () => {
  test('picks attend_when even when an earlier radio-group mentions a time', () => {
    const v = withForm([
      { id: 'dinner',      type: 'radio-group', label: 'Verður þú í kvöldmat?', options: [] },
      { id: 'attend_when', type: 'radio-group', label: 'Hvenær mætir þú?',      options: EN_OPTIONS },
    ]);
    expect(v._attendField().id).toBe('attend_when');
  });

  test('falls back to the label heuristic when the id was renamed', () => {
    const v = withForm([
      { id: 'timing', type: 'radio-group', label: 'Hvenær mætir þú?', options: IS_OPTIONS },
    ]);
    expect(v._attendField().id).toBe('timing');
  });

  test('ignores non-option fields and returns null when there is nothing to match', () => {
    expect(withForm([{ id: 'msg', type: 'textarea', label: 'When?' }])._attendField()).toBeNull();
    expect(withForm([])._attendField()).toBeNull();
    expect(withForm(undefined)._attendField()).toBeNull();
  });

  test('finds the live checkbox-group form by its id — the label says nothing', () => {
    expect(withForm(liveForm())._attendField().id).toBe('attend');
  });

  test('a radio-group heuristic match wins over an earlier checkbox-group one', () => {
    const v = withForm([
      { id: 'attend', type: 'checkbox-group', label: 'Svar',             options: LIVE_IS_OPTIONS },
      { id: 'timing', type: 'radio-group',    label: 'Hvenær mætir þú?', options: IS_OPTIONS },
    ]);
    expect(v._attendField().id).toBe('timing');
  });

  test('attend_when stays canonical even as a checkbox-group', () => {
    const v = withForm([
      { id: 'timing',      type: 'radio-group',    label: 'Hvenær mætir þú?', options: IS_OPTIONS },
      { id: 'attend_when', type: 'checkbox-group', label: 'Svar',             options: LIVE_IS_OPTIONS },
    ]);
    expect(v._attendField().id).toBe('attend_when');
  });
});

describe('_timingOptions — one entry per bucket, going options only', () => {
  test('English form yields day/evening/all-day bound to the real labels', () => {
    const opts = withForm(enForm())._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['day', 'evening', 'both']);
    expect(opts.map(o => o.value)).toEqual([
      '☀️ Daytime only (14:00–18:00)',
      '🌙 Evening only (18:00–22:00)',
      '🎉 Both — all day!',
    ]);
  });

  test('Icelandic form maps all-day onto the bare "Já"', () => {
    const opts = withForm(enForm(IS_OPTIONS))._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['day', 'evening', 'both']);
    expect(opts.find(o => o.bucket === 'both').value).toBe('Já');
    expect(opts.find(o => o.bucket === 'day').value).toBe('Já, aðeins á daginn');
  });

  test('a maybe/decline option never backs a timing slot', () => {
    // Picking 🌙 must not write a label that flips the guest to "maybe".
    const opts = withForm(enForm([
      { label: 'Kannski um kvöldið', status: 'maybe' },
      { label: '🌙 Evening only',    status: 'going' },
    ]))._timingOptions();
    expect(opts.find(o => o.bucket === 'evening').value).toBe('🌙 Evening only');
  });

  test('skips buckets the form has no option for', () => {
    const opts = withForm(enForm([{ label: '🌙 Evening only', status: 'going' }]))._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['evening']);
  });

  test('no attendance field → no options', () => {
    expect(withForm([])._timingOptions()).toEqual([]);
  });

  test('the live checkbox form yields its three going options — decline/maybe stay out', () => {
    const opts = withForm(liveForm())._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['day', 'evening', 'both']);
    expect(opts.find(o => o.bucket === 'day').value).toBe('Já, aðeins á daginn');
    expect(opts.find(o => o.bucket === 'evening').value).toBe('Já, aðeins um kvöldið');
    expect(opts.find(o => o.bucket === 'both').value).toBe('Já');
  });

  test('a bare-string decline worded with a timing phrase never becomes selectable', () => {
    // Bare strings carry no declared status — the phrase fallback must catch
    // this, or picking 🌙 would write a label that means "can't come".
    const opts = withForm([
      { id: 'attend', type: 'checkbox-group', label: 'Svar', options: ['Já', 'Kemst ekki um kvöldið'] },
    ])._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['both']);
  });
});

describe('_answerStatus — bare-string options classify by phrase', () => {
  test('the live form\'s decline and maybe options do not count as going', () => {
    const v = withForm(liveForm());
    expect(v._answerStatus('Get ekki mætt.')).toBe('declined');
    expect(v._answerStatus('Kannski')).toBe('maybe');
    expect(v._answerStatus('Já, aðeins á daginn')).toBe('going');
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────
// The cell and the Stats cards are the two places the classification surfaces.
// Both are string builders, so they're assertable without a DOM.

const withRender = (fields, rsvps = []) => ({
  ...withForm(fields),
  _rsvps:            rsvps,
  _renderTimingCell: P._renderTimingCell,
  _renderStats:      P._renderStats,
});

describe('_renderTimingCell', () => {
  const cell = (answer, opts = EN_OPTIONS) =>
    withRender(enForm(opts))._renderTimingCell({ id: 'u1', rsvp_answers: answer === undefined ? null : { attend_when: answer } }, true);

  test('an Icelandic answer selects the English form\'s matching option', () => {
    const html = cell('Já, aðeins á daginn');
    // The ☀️ option is the selected one — the production bug rendered nothing selected.
    expect(html).toMatch(/<option value="☀️ Daytime only \(14:00–18:00\)" selected>/);
    expect(html).not.toMatch(/<option value="" selected>/);
  });

  test('a bare "Já" selects all-day', () => {
    expect(cell('Já')).toMatch(/<option value="🎉 Both — all day!" selected>/);
  });

  test('data-current mirrors the selected option, so a no-op save can\'t fire', () => {
    const html = cell('Já, aðeins um kvöldið');
    expect(html).toContain('data-current="🌙 Evening only (18:00–22:00)"');
    expect(html).toMatch(/<option value="🌙 Evening only \(18:00–22:00\)" selected>/);
  });

  // "Blank" = no option carries `selected`, so the browser falls back to the
  // leading <option value="">—</option>, and data-current agrees with it.
  test('a decline shows blank — and never pre-selects a timing that "—" could wipe', () => {
    const html = cell('Kemst ekki');
    expect(html).toContain('<option value="">—</option>');
    expect(html).not.toMatch(/ selected>/);
    expect(html).toContain('data-current=""');
  });

  test('no answer shows blank', () => {
    const html = cell(undefined);
    expect(html).toContain('<option value="">—</option>');
    expect(html).not.toMatch(/ selected>/);
    expect(html).toContain('data-current=""');
  });

  test('moderators get a read-only cell, not a select', () => {
    const html = withRender(enForm())._renderTimingCell({ id: 'u1', rsvp_answers: { attend_when: 'Já' } }, false);
    expect(html).not.toContain('<select');
    expect(html).toContain('🎉');
  });

  // The live form stores checkbox-group answers as ARRAYS.
  const liveCell = (answer) =>
    withRender(liveForm())._renderTimingCell({ id: 'u1', rsvp_answers: answer === undefined ? null : { attend: answer } }, true);

  test('an array answer selects its exact option', () => {
    const html = liveCell(['Já, aðeins á daginn']);
    expect(html).toMatch(/<option value="Já, aðeins á daginn" selected>/);
    expect(html).toContain('data-current="Já, aðeins á daginn"');
  });

  test('an array decline shows blank — nothing "—" could wipe', () => {
    const html = liveCell(['Get ekki mætt.']);
    expect(html).toContain('<option value="">—</option>');
    expect(html).not.toMatch(/ selected>/);
    expect(html).toContain('data-current=""');
  });

  test('a legacy STRING answer under a checkbox field still selects', () => {
    const html = liveCell('Já');
    expect(html).toMatch(/<option value="Já" selected>/);
  });

  test('no answer shows blank and the select still renders (the prod bug)', () => {
    const html = liveCell(undefined);
    expect(html).toContain('<select');
    expect(html).toContain('<option value="">—</option>');
    expect(html).not.toMatch(/ selected>/);
  });
});

describe('_renderStats — timing breakdown cards', () => {
  // EN form loaded; guests answered across BOTH locales, plus a decline.
  const rsvps = [
    { attending: true, answers: { attend_when: 'Já, aðeins á daginn' } },              // IS day
    { attending: true, answers: { attend_when: '☀️ Daytime only (14:00–18:00)' } },   // EN day
    { attending: true, answers: { attend_when: 'Já, aðeins um kvöldið' } },            // IS evening
    { attending: false, answers: { attend_when: 'Kemst ekki' } },                      // IS decline
  ];
  const html = () => withRender(enForm(), rsvps)._renderStats();
  const cardNums = (h) => [...h.matchAll(/<span class="party-admin__stat-num">(\d+)<\/span>/g)].map(m => m[1]);

  test('a bucket sums answers given in different locales', () => {
    // [all, day, evening, both, declined, headcount] — day is the IS + EN pair.
    expect(cardNums(html())[1]).toBe('2');
  });

  test('the declined card counts cross-locale declines (it read 0 before)', () => {
    // The loaded EN form seeds "Sorry, can't make it" at 0; a first-hit picker
    // returned that 0 and hid the 3 guests who answered IS "Kemst ekki".
    expect(cardNums(html())[4]).toBe('1');
  });

  test('a card carries every label it counted, so the drill-down matches the number', () => {
    const m = html().match(/data-stat-values="([^"]*)"/);
    const values = JSON.parse(m[1].replace(/&quot;/g, '"'));
    expect(values).toContain('Já, aðeins á daginn');
    expect(values).toContain('☀️ Daytime only (14:00–18:00)');
  });

  test('evening and all-day are counted separately from day', () => {
    const nums = cardNums(html());
    expect(nums[2]).toBe('1');  // evening
    expect(nums[3]).toBe('0');  // all-day — nobody picked it
  });

  test('array answers from the live checkbox form are tallied', () => {
    const h = withRender(liveForm(), [
      { attending: true,  answers: { attend: ['Já, aðeins á daginn'] } },
      { attending: true,  answers: { attend: ['Já'] } },
      { attending: false, answers: { attend: ['Get ekki mætt.'] } },
    ])._renderStats();
    // [all, day, evening, both, declined, headcount]
    expect(cardNums(h)).toEqual(['3', '1', '0', '1', '1', '2']);
  });

  // A card's number and the rows its drill-down modal opens are computed in two
  // different places, so they can silently disagree. They previously did: the
  // tally normalizes the answer shape, while the modal's filter branched on the
  // field's declared type and dropped every answer of the other shape.
  test('a card number matches what its drill-down selects, across answer shapes', () => {
    const rsvps = [
      { attending: true, answers: { attend: ['Já, aðeins á daginn'] } },  // array (checkbox)
      { attending: true, answers: { attend: 'Já, aðeins á daginn' } },    // legacy string
    ];
    const h = withRender(liveForm(), rsvps)._renderStats();
    expect(cardNums(h)[1]).toBe('2');   // ☀️ day card counts both shapes

    // Replicates the modal's filter (_bindStatCards) against the card's own
    // data-stat-values, so a divergence fails here rather than in the UI.
    const values = JSON.parse(h.match(/data-stat-values="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    const selected = rsvps.filter(r =>
      P._answerLabels(r.answers?.attend).some(l => values.includes(l)));
    expect(String(selected.length)).toBe(cardNums(h)[1]);
  });
});

describe('_answerStatus — decline phrases must not swallow an enthusiastic yes', () => {
  // Icelandic "get ekki beðið" = "can't wait!". A decline pattern loose enough
  // to match a bare "get ekki" turns that into a decline, which both mis-buckets
  // the guest and removes the option from the timing select entirely.
  test('"Get ekki beðið!" is going, while "Get ekki mætt." is still declined', () => {
    const v = withForm(liveForm());
    expect(v._answerStatus('Get ekki beðið!')).toBe('going');
    expect(v._answerStatus('Ég get ekki beðið')).toBe('going');
    expect(v._answerStatus('Get ekki mætt.')).toBe('declined');
  });

  test('an enthusiastic-yes option still backs its timing bucket', () => {
    const opts = withForm([
      { id: 'attend', type: 'checkbox-group', label: 'Svar',
        options: ['Get ekki beðið, kem allan daginn!', 'Já, aðeins um kvöldið'] },
    ])._timingOptions();
    expect(opts.map(o => o.bucket)).toEqual(['evening', 'both']);
    expect(opts.find(o => o.bucket === 'both').value).toBe('Get ekki beðið, kem allan daginn!');
  });
});
