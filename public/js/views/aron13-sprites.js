/**
 * 8-bit pixel art for the /aron13ara birthday page, drawn from scratch in a
 * Minecraft/Roblox *style* (blocks, gems, a blocky figure) — no trademarked
 * artwork is reproduced. Each sprite is a text grid: one character per pixel,
 * '.' transparent, every other character a key into PAL. sprite() turns a
 * grid into an inline SVG with crisp edges so it scales without blur.
 *
 * Inline SVG is same-origin markup, so it needs nothing from the CSP. The
 * palette matches the --a13-* custom properties in public/css/aron13.css.
 */

const PAL = {
  g: '#5d9c3a', G: '#3e6b26', // grass
  d: '#7a5230', D: '#5a3a1e', // dirt
  n: '#a0642c', N: '#7d4b1e', // planks / wood
  c: '#4fd7e0', C: '#1f8f97', // diamond
  e: '#2ecc40', E: '#1e8c2c', // creeper / emerald green
  r: '#e2231a', R: '#9c150f', // red
  y: '#f2c94c', Y: '#c9971e', // gold
  s: '#a8a8a8', S: '#5c5c5c', // stone / iron
  u: '#3b7dd8', U: '#2757a0', // blue (torso)
  p: '#f27aa8', P: '#c94f80', // frosting
  o: '#ff8c1a', O: '#ffd23f', // flame
  m: '#6b3a1e',               // chocolate
  k: '#101010',               // ink
  w: '#f4f1ea',               // paper / white
  l: '#8fd3ff',               // sky
};

/**
 * Render a pixel grid as an inline SVG string.
 * @param {string[]} rows   equal-length strings, one char per pixel
 * @param {object}   [o]
 * @param {number}   [o.scale=6]  CSS pixels per sprite pixel
 * @param {string}   [o.title]    accessible name; omitted → aria-hidden
 * @param {string}   [o.cls]      extra class on the <svg>
 */
export function sprite(rows, { scale = 6, title, cls = '' } = {}) {
  const h = rows.length;
  const w = rows[0].length;
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) { x++; continue; }
      // Merge a horizontal run of the same colour into one rect.
      let x2 = x + 1;
      while (x2 < w && row[x2] === ch) x2++;
      rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${PAL[ch]}"/>`;
      x = x2;
    }
  }
  const a11y = title
    ? `role="img" aria-label="${title}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="a13-sprite ${cls}" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" `
    + `shape-rendering="crispEdges" ${a11y}>${rects}</svg>`;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

const grassBlock = [
  'gggggggg',
  'gGgggGgg',
  'GgGggGgG',
  'dDdddDdd',
  'ddDddddD',
  'dDddDddd',
  'ddddDdDd',
  'DddDddDd',
];

const dirtBlock = [
  'ddDddddD',
  'dDddDddd',
  'ddddDdDd',
  'DddDddDd',
  'ddDddddD',
  'dDddDddd',
  'ddddDdDd',
  'DddDddDd',
];

const plank = [
  'nnnnnnnn',
  'nNnnnnNn',
  'NNNNNNNN',
  'nnnNnnnn',
  'nnnnnnnn',
  'NNNNNNNN',
  'nNnnnnnn',
  'nnnnnNnn',
];

const diamondBlock = [
  'CCCCCCCC',
  'CcccccwC',
  'CccwcccC',
  'CccccccC',
  'CcwccccC',
  'CccccccC',
  'CccccwcC',
  'CCCCCCCC',
];

const goldBlock = [
  'YYYYYYYY',
  'YyyyyywY',
  'YyywyyyY',
  'YyyyyyyY',
  'YywyyyyY',
  'YyyyywyY',
  'YyyyyyyY',
  'YYYYYYYY',
];

const tnt = [
  'rrrrrrrr',
  'rRrrrRrr',
  'wwwwwwww',
  'wkwkwkkw',
  'wwwwwwww',
  'rrrRrrrr',
  'rRrrrrRr',
  'rrrrrrrr',
];

const stoneBlock = [
  'ssssSsss',
  'sSssssss',
  'ssssssSs',
  'sSSsssss',
  'ssssSsss',
  'ssssssSS',
  'sSssssss',
  'ssssSsss',
];

const robloxBlock = [
  'rrrrrrrr',
  'rRRRRRRr',
  'rRrrrrRr',
  'rRrrrrRr',
  'rRrrrrRr',
  'rRrrrrRr',
  'rRRRRRRr',
  'rrrrrrrr',
];

// ── Items ─────────────────────────────────────────────────────────────────────

const diamond = [
  '...cc...',
  '..cwcc..',
  '.cwcccc.',
  'ccccccCC',
  '.cccCCC.',
  '..ccCC..',
  '...cC...',
  '....C...',
];

const emerald = [
  '...ee...',
  '..ewee..',
  '.eweeee.',
  'eeeeeeEE',
  '.eeeEEE.',
  '..eeEE..',
  '...eE...',
  '....E...',
];

const ironIngot = [
  '..ssssss',
  '.swssssS',
  'ssssssSS',
  'sssssSS.',
  'SSSSSS..',
];

const stick = [
  '......nn',
  '.....nnN',
  '....nnN.',
  '...nnN..',
  '..nnN...',
  '.nnN....',
  'nnN.....',
  'NN......',
];

const sword = [
  '..........cc',
  '.........ccC',
  '........ccC.',
  '.......ccC..',
  '......ccC...',
  '.k...ccC....',
  '..k.ccC.....',
  '...kcC......',
  '..kkkk......',
  '.nk..kk.....',
  'nn..........',
  'N...........',
];

const pickaxe = [
  '...ccccc....',
  '..ccCCCcc...',
  '.cC.....Cc..',
  '.c...n...C..',
  '.....n......',
  '....nN......',
  '....nN......',
  '...nN.......',
  '...nN.......',
  '..nN........',
  '..nN........',
  '.nN.........',
];

// A tilted cube with one gold face — the Robux shape, not a Mario coin.
const robuxCoin = [
  '...kk...',
  '..kyyk..',
  '.kyyyyk.',
  'kyyyyyyk',
  'kwwkkssk',
  'kwwkkssk',
  'kwwkkssk',
  '.kwkksk.',
  '..kkkk..',
];

const heart = [
  '.rr..rr.',
  'rwrrrrrr',
  'rrrrrrrr',
  'rrrrrrrr',
  '.rrrrrR.',
  '..rrrR..',
  '...rR...',
];

const chestClosed = [
  'nnnnnnnnnnnn',
  'nNNNNNNNNNNn',
  'nNnnnnnnnnNn',
  'nnnnnnnnnnnn',
  'NNNNNyyNNNNN',
  'nNnnnykynnNn',
  'nNnnnnnnnnNn',
  'nNnnnnnnnnNn',
  'nNNNNNNNNNNn',
  'nnnnnnnnnnnn',
];

const chestOpen = [
  'nnnnnnnnnnnn',
  'nNNNNNNNNNNn',
  'nnnnnnnnnnnn',
  'kkkkkkkkkkkk',
  'kcykcyckycyk',
  'kycyckyccyyk',
  'nNnnnnnnnnNn',
  'nNnnnnnnnnNn',
  'nNNNNNNNNNNn',
  'nnnnnnnnnnnn',
];

// The Minecraft cake block — white icing, red cherries, jam line, sponge base —
// with three birthday candles on top.
const cake = [
  '....o...o...o...',
  '....O...O...O...',
  '....w...w...w...',
  '....w...w...w...',
  '.wwwwwwwwwwwwww.',
  'wwrwwwrwwwrwwrww',
  'wwwwwwwwwwwwwwww',
  'wwwrwwwwrwwwwrww',
  'wwwwwwwwwwwwwwww',
  'wrwrwrwrwrwrwrwr',
  'nnnnnnnnnnnnnnnn',
  'nnnnnnnnnnnnnnnn',
  'NNNNNNNNNNNNNNNN',
];

const creeperFace = [
  'eeeeeeee',
  'eEeeeeEe',
  'ekkeekke',
  'ekkeekke',
  'eeekkeee',
  'eekkkkee',
  'eekkkkee',
  'eekeekee',
];

// A blocky figure: yellow head, blue torso, green legs.
const blockyGuy = [
  '.yyyyyy.',
  '.ykyyky.',
  '.yyyyyy.',
  '.yykkyy.',
  '...yy...',
  'yuuuuuuy',
  'yuUuuUuy',
  'yuuuuuuy',
  'yuuuuuuy',
  '.uUuuUu.',
  '.ee..ee.',
  '.ee..ee.',
  '.eE..eE.',
  '.kk..kk.',
];

const firework = [
  '....y....',
  '.c..y..c.',
  '..c.y.c..',
  '...ryr...',
  'yyyrwryyy',
  '...ryr...',
  '..c.y.c..',
  '.c..y..c.',
  '....y....',
];

const cloud = [
  '...wwww.....',
  '..wwwwww.w..',
  '.wwwwwwwwww.',
  'wwwwwwwwwwww',
  'wwwwwwwwwwww',
  '.wwwwwwwwww.',
];

const star = [
  '...y...',
  '..yyy..',
  'yyywyyy',
  '.yyyyy.',
  '..yyy..',
  '.yy.yy.',
  'y.....y',
];

// ── Additions for the mini games ─────────────────────────────────────────────

const caveBlock = [
  'kkkkkkkk',
  'kSkkkkSk',
  'kkkkSkkk',
  'kkkkkkkk',
  'kSkkkkkk',
  'kkkkkSkk',
  'kkSkkkkk',
  'kkkkkkkk',
];

const goldOre = [
  'ssssSsss',
  'sSyyssss',
  'ssyysSys',
  'sSssssys',
  'ssssyyss',
  'syysyySS',
  'sSysssss',
  'ssssSsss',
];

// Second walk frame: legs apart.
const blockyGuyWalk = [
  '.yyyyyy.',
  '.ykyyky.',
  '.yyyyyy.',
  '.yykkyy.',
  '...yy...',
  'yuuuuuuy',
  'yuUuuUuy',
  'yuuuuuuy',
  'yuuuuuuy',
  '.uUuuUu.',
  'ee....ee',
  'ee....ee',
  'eE....eE',
  'kk....kk',
];

const heartEmpty = [
  '.kk..kk.',
  'k..kk..k',
  'k......k',
  'k......k',
  '.k....k.',
  '..k..k..',
  '...kk...',
];

const speakerOn = [
  '...k....',
  '..kk..k.',
  'kkkk.k.k',
  'kkkk.k.k',
  'kkkk.k.k',
  '..kk..k.',
  '...k....',
];

const speakerOff = [
  '...k....',
  '..kk.r.r',
  'kkkk..r.',
  'kkkk.r.r',
  'kkkk....',
  '..kk....',
  '...k....',
];

const trophy = [
  'yyyyyyyy',
  'Yyyyyyyy',
  'Y.yyyy.Y',
  'Y.yyyy.Y',
  '.YyyyyY.',
  '..yyyy..',
  '...yy...',
  '...yy...',
  '..YYYY..',
  '.nnnnnn.',
];

const arrowRight = [
  '....k...',
  '.....k..',
  'kkkkkkk.',
  '.....k..',
  '....k...',
];

const craftingTable = [
  'nnnnnnnnnnnnnnnn',
  'nNNNNNNNNNNNNNNn',
  'nNssssssssssssNn',
  'nNsSSsSSsSSsssNn',
  'nNsSSsSSsSSsssNn',
  'nNssssssssssssNn',
  'nNsSSsSSsSSsssNn',
  'nNsSSsSSsSSsssNn',
  'nNssssssssssssNn',
  'nNsSSsSSsSSsssNn',
  'nNsSSsSSsSSsssNn',
  'nNssssssssssssNn',
  'nNNNNNNNNNNNNNNn',
  'nnnnnnnnnnnnnnnn',
  'NN............NN',
  'NN............NN',
];

// Cake with the flames one pixel over — swapped with `cake` to flicker.
const cakeFlicker = cake.map((r, i) => (i === 0 ? '...o...o...o....' : i === 1 ? '....O...O...O...' : r));

const torch = [
  '...oo...',
  '..oOOo..',
  '..oOOo..',
  '...oo...',
  '...nn...',
  '...nN...',
  '...nN...',
  '...nN...',
];

const arrowLeft = arrowRight.map(r => [...r].reverse().join(''));

// Destroy-stage overlays for the mining cells (transparent except the crack).
const crack1 = [
  '........',
  '...k....',
  '...k....',
  '..k.....',
  '..kk....',
  '....k...',
  '........',
  '........',
];

const crack2 = [
  '.k......',
  '..k.k...',
  '...k.k..',
  '..kk..k.',
  '.k..k...',
  '....kk..',
  '...k..k.',
  '..k.....',
];

export const SPRITES = {
  grassBlock, dirtBlock, plank, diamondBlock, goldBlock, tnt, stoneBlock, robloxBlock,
  diamond, emerald, ironIngot, stick, sword, pickaxe, robuxCoin, heart,
  chestClosed, chestOpen, cake, creeperFace, blockyGuy, firework, cloud, star,
  caveBlock, goldOre, blockyGuyWalk, heartEmpty, speakerOn, speakerOff, trophy,
  arrowRight, arrowLeft, craftingTable, cakeFlicker, torch, crack1, crack2,
};

/** Shorthand: `px('diamond', { scale: 4 })`. */
export function px(name, opts) {
  return sprite(SPRITES[name], opts);
}
