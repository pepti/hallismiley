'use strict';

// server/utils/announcementWindow.js (harvest2-lane7a; ported from
// icelandicstore #200, changed to date-times and a half-open window). The
// public endpoint withholds the copy on this rule, so its edges are pinned:
// live iff enabled AND start <= now < end, Reykjavík wall-clock time, blank
// bounds open, a bound that does not parse fails CLOSED.

const { isAnnouncementActive, publicAnnouncement, parseLocalDateTime, TZ }
  = require('../../server/utils/announcementWindow');

const at = (iso) => new Date(iso);
const on = (starts_at, ends_at) => ({ enabled: true, starts_at, ends_at });

describe('parseLocalDateTime', () => {
  test('Reykjavík is UTC+0 all year: wall clock = UTC', () => {
    expect(TZ).toBe('Atlantic/Reykjavik');
    expect(parseLocalDateTime('2026-10-01T09:30')).toBe(Date.UTC(2026, 9, 1, 9, 30));
    expect(parseLocalDateTime('2026-07-01T00:00')).toBe(Date.UTC(2026, 6, 1));
  });

  test('a bare date is 00:00 that day', () => {
    expect(parseLocalDateTime('2026-10-01')).toBe(Date.UTC(2026, 9, 1));
  });

  test('another zone is honoured, across its DST switch', () => {
    // London: GMT in winter, BST (UTC+1) in summer.
    expect(parseLocalDateTime('2026-01-15T12:00', 'Europe/London')).toBe(Date.UTC(2026, 0, 15, 12));
    expect(parseLocalDateTime('2026-07-15T12:00', 'Europe/London')).toBe(Date.UTC(2026, 6, 15, 11));
  });

  test.each(['2026-02-31T10:00', '2026-13-01', '2026-10-01T24:00', '2026-10-01T12:60', '1.10.2026', '', null, 42, '2026-10-01T09:30:00Z'])(
    'refuses %p', (v) => { expect(parseLocalDateTime(v)).toBeNull(); });
});

describe('isAnnouncementActive — the half-open window', () => {
  const w = on('2026-10-01T09:00', '2026-10-14T17:00');

  test('live from the start minute, gone AT the end minute', () => {
    expect(isAnnouncementActive(w, at('2026-10-01T08:59:59.999Z'))).toBe(false);
    expect(isAnnouncementActive(w, at('2026-10-01T09:00:00.000Z'))).toBe(true);
    expect(isAnnouncementActive(w, at('2026-10-14T16:59:59.999Z'))).toBe(true);
    expect(isAnnouncementActive(w, at('2026-10-14T17:00:00.000Z'))).toBe(false);
  });

  test('switched off is never live, whatever the dates', () => {
    expect(isAnnouncementActive({ ...w, enabled: false }, at('2026-10-05T12:00Z'))).toBe(false);
    expect(isAnnouncementActive(null)).toBe(false);
  });

  test('a blank bound is open on that side', () => {
    expect(isAnnouncementActive(on('', '2026-10-14T17:00'), at('2000-01-01T00:00Z'))).toBe(true);
    expect(isAnnouncementActive(on('2026-10-01T09:00', ''), at('2099-01-01T00:00Z'))).toBe(true);
    expect(isAnnouncementActive(on('', ''), at('2026-10-05T12:00Z'))).toBe(true);
  });

  test('a bound that does not parse fails closed (the copy is withheld)', () => {
    expect(isAnnouncementActive(on('2026-02-31T10:00', ''), at('2026-10-05T12:00Z'))).toBe(false);
    expect(isAnnouncementActive(on('', 'soon'), at('2026-10-05T12:00Z'))).toBe(false);
  });

  test('a bad clock value is not live', () => {
    expect(isAnnouncementActive(w, NaN)).toBe(false);
  });
});

describe('publicAnnouncement — what the public endpoint may say', () => {
  const live = {
    enabled: true, starts_at: '2026-10-01T09:00', ends_at: '2026-10-14T17:00',
    title: { is: 'Nýr vefur', en: 'New site' }, message: { is: 'Halló', en: '' },
    link_path: '/hafa-samband', link_label: { is: 'Hafa samband', en: '' },
  };

  test('outside the window: { active: false } and NOTHING else — no dates, no wording', () => {
    for (const now of ['2026-09-30T12:00Z', '2026-10-14T17:00Z']) {
      expect(publicAnnouncement(live, at(now))).toEqual({ active: false });
    }
  });

  test('live with no heading in either language: not shown', () => {
    expect(publicAnnouncement({ ...live, title: { is: ' ', en: '' } }, at('2026-10-05T12:00Z'))).toEqual({ active: false });
  });

  test('live: the copy, the link and an id — never the dates', () => {
    const p = publicAnnouncement(live, at('2026-10-05T12:00Z'));
    expect(p).toEqual({
      active: true, id: expect.stringMatching(/^[0-9a-f]{16}$/),
      title: { is: 'Nýr vefur', en: 'New site' }, message: { is: 'Halló', en: '' },
      link: { path: '/hafa-samband', label: { is: 'Hafa samband', en: '' } },
    });
    expect(JSON.stringify(p)).not.toContain('2026-10');
  });

  test('the id follows the wording and the window, so a changed notice is shown again', () => {
    const now = at('2026-10-05T12:00Z');
    const a = publicAnnouncement(live, now).id;
    expect(publicAnnouncement({ ...live }, now).id).toBe(a);
    expect(publicAnnouncement({ ...live, message: { is: 'Halló!', en: '' } }, now).id).not.toBe(a);
    expect(publicAnnouncement({ ...live, ends_at: '2026-10-15T17:00' }, now).id).not.toBe(a);
  });

  test('no link path → no link', () => {
    expect(publicAnnouncement({ ...live, link_path: '' }, at('2026-10-05T12:00Z')).link).toBeNull();
  });
});
