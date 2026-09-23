// Scene registry — the MEANING layer of the Iceland scene engine. manifest.js
// (generated) knows how to load each image; this file knows why a page shows
// it. Since 2026-09-22 (Halli) every scene is one of his AI-generated stills
// (iceland-v2), and every visitor-facing page has one:
//
//   thjonusta      canyon river between orange walls — many streams, one river
//   verkefni       rhyolite ridges — the brand's earth colours as landscape
//   um-okkur       glacier tongue over its lagoon — patient, quiet craft
//   hafa-samband   black beach and sea stack — a shore to arrive on
//   personuvernd   a waterfall seen from inside a cave — a sheltered place
//   terms          basalt canyon — solid ground, the rules as bedrock
//   signup         moss falls into a clear pool — a fresh start
//   account        rapids through snow (forgot/reset password, verify email)
//   profile        a hot spring — your own warm spot
//   notFound       braided channels in black sand — the paths split here
//   home / homeTiers / homeSteps — dormant since the video hero (2026-08-22)
//
// The images show Icelandic landforms, not real places, so there is no
// place chip (SceneStage defaults chip off): naming a made-up spot would be
// false. `particles` is the ambience preset ('mist' | null).
export const SCENE_DEFS = {
  home: { image: 'ice-lagoon', altKey: 'scene.iceLagoonAlt', particles: 'mist' },
  homeTiers: { image: 'braided-moss', altKey: 'scene.braidedMossAlt', particles: null },
  homeSteps: { image: 'braided-valley', altKey: 'scene.braidedValleyAlt', particles: null },
  thjonusta: { image: 'canyon-river', altKey: 'scene.canyonRiverAlt', particles: 'mist' },
  verkefni: { image: 'rhyolite-ridges', altKey: 'scene.rhyoliteRidgesAlt', particles: null },
  umOkkur: { image: 'glacier-tongue', altKey: 'scene.glacierTongueAlt', particles: 'mist' },
  hafaSamband: { image: 'black-beach', altKey: 'scene.blackBeachAlt', particles: null },
  personuvernd: { image: 'cave-falls', altKey: 'scene.caveFallsAlt', particles: 'mist' },
  terms: { image: 'basalt-canyon', altKey: 'scene.basaltCanyonAlt', particles: null },
  signup: { image: 'moss-falls', altKey: 'scene.mossFallsAlt', particles: 'mist' },
  account: { image: 'snow-rapids', altKey: 'scene.snowRapidsAlt', particles: null },
  profile: { image: 'hot-spring', altKey: 'scene.hotSpringAlt', particles: 'mist' },
  notFound: { image: 'braided-sand', altKey: 'scene.braidedSandAlt', particles: null },
};
