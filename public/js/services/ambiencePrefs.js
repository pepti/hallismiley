// Ambience preferences — the two visitor switches for the live-Iceland layer
// (ThemeSwitcher popover rows). Mirrors themePrefs' storage conventions:
// try/catch around localStorage, absent key = the default.
//
//   ws_ambience        absent = ON  ('0' = off)  — weather/sun/aurora layer
//   ws_ambience_sound  absent = OFF ('1' = on)   — Web-Audio waterfall hush
//
// `ambiencechange` fires on window for the engine + any open pickers, and
// body.amb-off mirrors the live pref (styling + the e2e hook).
function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable — the preference just won't persist */ }
}

const AMB_KEY = 'ws_ambience';
const SOUND_KEY = 'ws_ambience_sound';

export function ambienceEnabled() {
  return read(AMB_KEY) !== '0';
}

export function setAmbienceEnabled(on) {
  write(AMB_KEY, on ? null : '0');
  syncBodyClass();
  window.dispatchEvent(new CustomEvent('ambiencechange', { detail: { ambience: on, sound: soundEnabled() } }));
}

export function soundEnabled() {
  return read(SOUND_KEY) === '1';
}

export function setSoundEnabled(on) {
  write(SOUND_KEY, on ? '1' : null);
  window.dispatchEvent(new CustomEvent('ambiencechange', { detail: { ambience: ambienceEnabled(), sound: on } }));
}

export function syncBodyClass() {
  document.body.classList.toggle('amb-off', !ambienceEnabled());
}
