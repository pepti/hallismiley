'use strict';
// Live Iceland ambience — the server half of the scene engine's "you are
// outside" layer. Proxies Open-Meteo (no API key, no client CSP change:
// connect-src stays 'self') for the weather around Hafnarfjörður and caches
// it in-process for 10 minutes, so a whole day of visitors costs Open-Meteo
// ~150 requests. Failure is designed to be invisible: stale data if we have
// it, null if we never got any — the client then simply leaves the scenes
// static. Never throws.
const logger = require('../logger');

const LAT = 64.07;
const LON = -21.97;
const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

const URL =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${LAT}&longitude=${LON}` +
  '&current=temperature_2m,wind_speed_10m,precipitation,snowfall,cloud_cover,weather_code,is_day' +
  '&wind_speed_unit=ms&timezone=UTC';

// Module-singleton cache (house style: services/translator.js).
let cache = { at: 0, data: null };

// WMO weather_code → the five conditions the particle layer knows.
// https://open-meteo.com/en/docs (WW code table)
function conditionFor(code, precip, snowfall, tempC, cloudPct) {
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (snowfall > 0 || (precip > 0 && tempC <= 1)) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip > 0) return 'rain';
  if (cloudPct > 85) return 'cloudy';
  return 'clear';
}

async function fetchOnce() {
  const res = await fetch(URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'rekstrarkerfid-ambience/1.0' },
  });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const body = await res.json();
  const c = body && body.current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('open-meteo: malformed payload');

  const tempC = c.temperature_2m;
  const precipMm = c.precipitation ?? 0;
  const snowfall = c.snowfall ?? 0;
  const cloudPct = c.cloud_cover ?? 0;
  return {
    tempC,
    windMs: c.wind_speed_10m ?? 0,
    precipMm,
    cloudPct,
    isDay: c.is_day === 1,
    condition: conditionFor(c.weather_code ?? 0, precipMm, snowfall, tempC, cloudPct),
  };
}

// Fresh-enough cache → cached; else fetch; fetch failure → stale data (or
// null on a cold cache). The failed attempt still bumps `at`, so a dead
// upstream is retried once per TTL, not once per visitor.
async function getAmbience() {
  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) return cache.data;
  try {
    const data = await fetchOnce();
    cache = { at: now, data };
    return data;
  } catch (err) {
    logger.warn({ err: err.message }, '[ambience] Open-Meteo fetch failed — serving stale/none');
    cache.at = now;
    return cache.data;
  }
}

function _resetForTests() {
  cache = { at: 0, data: null };
}

module.exports = { getAmbience, _resetForTests, _conditionFor: conditionFor };
