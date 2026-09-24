---
id: bio
name: {is: "Persónuleg kynning", en: "Personal bio (/halli)"}
domain: 12
owner: engine
status: hidden
flag: modules.bio.enabled
paths:
  - public/js/views/HalliView.js
  - public/css/halli-bio.css
  - scripts/generate-avatars.js
  - scripts/gen-fb-icon.js
migrations: [011_halli_bio_content, 039_halli_bio_cv_arrays, 040_halli_bio_image_urls, 044_halli_bio_code_snippet]
since: 2026-08-09
origin: null
history: [homepage, r1]
---

The personal bio/CV page the base ships at `/halli` (and `/about`), fed by `site_content` rows (011/039/040/044). Hidden here; keeps the waterfall hero on purpose.

**Rules**
- Full rules: [../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
