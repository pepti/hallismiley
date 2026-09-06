/**
 * A 5×7 pixel font for the /aron13ara page titles, rendered through the same
 * sprite() helper as the artwork so lettering is crisp 8-bit blocks instead of
 * a webfont pretending. Each glyph is 7 rows of 5; an extra accent row sits on
 * top so Á/É/Í/Ó/Ú/Ý/Ö keep the same metrics as everything else.
 */
import { sprite } from './aron13-sprites.js';

const G = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  Ð: ['.###.', '.#..#', '.#..#', '###.#', '.#..#', '.#..#', '.###.'],
  Þ: ['#....', '####.', '#...#', '#...#', '####.', '#....', '#....'],
  Æ: ['.####', '#.#..', '#.#..', '#####', '#.#..', '#.#..', '#.###'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  '·': ['.....', '.....', '.....', '.##..', '.##..', '.....', '.....'],
};

// Accented letters: base glyph + a mark on the accent row.
const ACCENT = {
  Á: ['A', '..##.'], É: ['E', '..##.'], Í: ['I', '..##.'], Ó: ['O', '..##.'],
  Ú: ['U', '..##.'], Ý: ['Y', '..##.'], Ö: ['O', '.#.#.'],
};

const EMPTY_ROW = '.....';
const SPACE_W = 3;

function glyphRows(ch) {
  const up = ch.toUpperCase();
  if (ACCENT[up]) {
    const [base, mark] = ACCENT[up];
    return [mark, ...G[base]];
  }
  if (G[up]) return [EMPTY_ROW, ...G[up]];
  return null;
}

/**
 * Render text as one pixel sprite.
 * @param {string} str
 * @param {object} [o]
 * @param {number} [o.scale=4]   CSS px per font pixel
 * @param {string} [o.colour='w'] palette key (see aron13-sprites PAL)
 * @param {string} [o.shadow='k'] palette key for a 1px drop shadow, or null
 * @param {string} [o.outline]    palette key for a 1px outline on all sides
 *                                (use on low-contrast grounds: gold on sky,
 *                                paper on grass); replaces the shadow
 * @param {string} [o.title]      accessible name (defaults to the text)
 * @param {string} [o.cls]
 */
export function pixelText(str, { scale = 4, colour = 'w', shadow = 'k', outline = null, title = str, cls = '' } = {}) {
  const H = 8;
  const cols = [];
  for (const ch of String(str)) {
    if (ch === ' ') {
      for (let i = 0; i < SPACE_W; i++) cols.push(Array(H).fill('.'));
      continue;
    }
    const rows = glyphRows(ch);
    if (!rows) continue;
    if (cols.length && cols[cols.length - 1].some(c => c !== '.')) cols.push(Array(H).fill('.'));
    for (let x = 0; x < 5; x++) cols.push(rows.map(r => r[x]));
  }
  const W = cols.length;
  if (outline) {
    // 1px border of pixels all the way round, so the glyph reads on any ground.
    const grid = Array.from({ length: H + 2 }, () => Array(W + 2).fill('.'));
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      if (cols[x][y] !== '#') continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grid[y + 1 + dy][x + 1 + dx] = outline;
    }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (cols[x][y] === '#') grid[y + 1][x + 1] = colour;
    return sprite(grid.map(r => r.join('')), { scale, title, cls: `a13-pixeltext ${cls}` });
  }
  const pad = shadow ? 1 : 0;
  const grid = Array.from({ length: H + pad }, () => Array(W + pad).fill('.'));
  if (shadow) {
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (cols[x][y] === '#') grid[y + 1][x + 1] = shadow;
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (cols[x][y] === '#') grid[y][x] = colour;
  return sprite(grid.map(r => r.join('')), { scale, title, cls: `a13-pixeltext ${cls}` });
}
