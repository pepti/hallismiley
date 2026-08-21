'use strict';

/**
 * /api/v1/ambience — the live-Iceland weather proxy (chunk 3 of the scene
 * engine). The upstream (Open-Meteo) is stubbed at global.fetch: real network
 * in tests would make the suite exactly as flaky as the North Atlantic.
 * Postgres stays real per the invariants — this route just never touches it.
 *
 * The contract under test:
 *   • always 200 — weather is atmosphere, never an error surface
 *   • WMO weather_code → the five client conditions
 *   • one upstream fetch per 10-min TTL, whatever the visitor count
 *   • upstream failure → stale data if warm, { available: false } if cold
 */
const request = require('supertest');
const app = require('../../server/app');
const { _resetForTests, _conditionFor } = require('../../server/services/icelandAmbience');

const realFetch = global.fetch;

function meteoResponse(current) {
  return {
    ok: true,
    json: async () => ({
      current: {
        temperature_2m: 8.4, wind_speed_10m: 11.2, precipitation: 0,
        snowfall: 0, cloud_cover: 40, weather_code: 2, is_day: 1,
        ...current,
      },
    }),
  };
}

describe('GET /api/v1/ambience', () => {
  let fetchMock;

  beforeEach(() => {
    _resetForTests();
    fetchMock = jest.fn().mockResolvedValue(meteoResponse());
    global.fetch = fetchMock;
  });

  afterAll(() => { global.fetch = realFetch; });

  test('returns the mapped payload with a public cache header', async () => {
    const res = await request(app).get('/api/v1/ambience');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body).toEqual({
      available: true,
      tempC: 8.4,
      windMs: 11.2,
      precipMm: 0,
      cloudPct: 40,
      isDay: true,
      condition: 'clear',
    });
  });

  test('serves the whole TTL from one upstream fetch', async () => {
    await request(app).get('/api/v1/ambience');
    await request(app).get('/api/v1/ambience');
    await request(app).get('/api/v1/ambience');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('cold cache + upstream failure → 200 { available: false }', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
    const res = await request(app).get('/api/v1/ambience');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  test('warm cache + upstream failure after the TTL → stale data, still 200', async () => {
    jest.useFakeTimers();
    try {
      const first = await request(app).get('/api/v1/ambience');
      expect(first.body.available).toBe(true);

      jest.setSystemTime(Date.now() + 11 * 60 * 1000); // past the 10-min TTL
      fetchMock.mockRejectedValue(new Error('timeout'));

      const second = await request(app).get('/api/v1/ambience');
      expect(fetchMock).toHaveBeenCalledTimes(2); // it DID retry upstream…
      expect(second.status).toBe(200);
      expect(second.body.available).toBe(true); // …and fell back to stale
      expect(second.body.tempC).toBe(8.4);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a malformed upstream body is a failure, not a crash', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nonsense: true }) });
    const res = await request(app).get('/api/v1/ambience');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  // The WMO mapping, one case per condition the particle layer knows.
  test.each([
    ['fog from code 45', { weather_code: 45 }, 'fog'],
    ['snow from code 71', { weather_code: 71, temperature_2m: -2 }, 'snow'],
    ['snow from cold precipitation', { weather_code: 61, precipitation: 0.8, temperature_2m: 0.5 }, 'snow'],
    ['rain from code 61', { weather_code: 61, precipitation: 1.2, temperature_2m: 6 }, 'rain'],
    ['cloudy from heavy cover', { weather_code: 3, cloud_cover: 95 }, 'cloudy'],
    ['clear otherwise', { weather_code: 1, cloud_cover: 20 }, 'clear'],
  ])('maps %s', async (_label, current, expected) => {
    fetchMock.mockResolvedValue(meteoResponse(current));
    const res = await request(app).get('/api/v1/ambience');
    expect(res.body.condition).toBe(expected);
  });

  // Pure-function edge the HTTP cases above can't reach cleanly.
  test('_conditionFor prefers fog over everything', () => {
    expect(_conditionFor(48, 2, 1, -3, 100)).toBe('fog');
  });
});
