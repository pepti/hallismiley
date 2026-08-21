// Scene registry — the MEANING layer of the Iceland scene engine. manifest.js
// (generated) knows how to load each photo; this file knows why a page shows
// it. Assignments are Halli-directed (2026-08-21) and deliberate:
//
//   home hero      Skógafoss from above — the power that runs underneath
//   home tiers     braided glacial channels in snow — þrjár leiðir, eitt kerfi
//   home steps     the highland road in — the migration journey
//   thjonusta      Sigöldugljúfur — many falls feeding one river
//   verkefni       Landmannalaugar — black-and-orange, the brand as landscape
//   um-okkur       Svínafellsjökull at blue hour — patient, quiet craft
//   hafa-samband   Reynisfjara — a calm shore to arrive on
//
// `place`/`region` feed the corner chip ("Skógafoss — Suðurland"): real
// places, so the site feels located, not decorated. `particles` is the
// chunk-3 ambience preset ('mist' | null); harmless until that ships.
export const SCENE_DEFS = {
  home: { image: 'skogafoss', place: 'Skógafoss', region: 'Suðurland', altKey: 'scene.skogafossAlt', particles: 'mist' },
  homeTiers: { image: 'braided', place: 'Hálendið', region: 'úr lofti', altKey: 'scene.braidedAlt', particles: null },
  homeSteps: { image: 'highland-road', place: 'Landmannalaugar', region: 'Fjallabak', altKey: 'scene.highlandRoadAlt', particles: null },
  thjonusta: { image: 'sigoldugljufur', place: 'Sigöldugljúfur', region: 'Hálendið', altKey: 'scene.sigoldugljufurAlt', particles: 'mist' },
  verkefni: { image: 'landmannalaugar', place: 'Landmannalaugar', region: 'Fjallabak', altKey: 'scene.landmannalaugarAlt', particles: null },
  umOkkur: { image: 'glacier', place: 'Svínafellsjökull', region: 'Öræfi', altKey: 'scene.glacierAlt', particles: 'mist' },
  hafaSamband: { image: 'reynisfjara', place: 'Reynisfjara', region: 'Suðurland', altKey: 'scene.reynisfjaraAlt', particles: null },
};
