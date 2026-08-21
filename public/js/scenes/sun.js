// Solar altitude over Iceland, computed locally — no network, no dependency.
// NOAA's low-precision solar position algorithm (good to ~0.1°, plenty for
// choosing a light phase). This is where the midnight sun and the 11:00
// December sunrise fall out of plain arithmetic.
const RAD = Math.PI / 180;

export function sunAltitudeDeg(date, latDeg, lonDeg) {
  // Fractional year (radians), from UTC day-of-year and hour.
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const gamma = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);

  // Equation of time (minutes) and solar declination (radians).
  const eqTime = 229.18 * (0.000075
    + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  // True solar time → hour angle (degrees).
  const timeOffset = eqTime + 4 * lonDeg;
  const tst = hour * 60 + timeOffset;
  const hourAngle = tst / 4 - 180;

  const lat = latDeg * RAD;
  const ha = hourAngle * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
}

// The four lights of the ambience layer. Thresholds are the civil-twilight
// conventions: golden below 6° up, blue hour to −6°, night beyond.
export function sunPhase(date, latDeg, lonDeg) {
  const alt = sunAltitudeDeg(date, latDeg, lonDeg);
  if (alt > 6) return 'day';
  if (alt > 0) return 'golden';
  if (alt > -6) return 'blue';
  return 'night';
}
