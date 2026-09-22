// Product migrations for Orange Smiley's own instance (product id "os").
//
// Concatenated AFTER the engine list (server/config/schema.js) by
// server/config/migrationSet.js, so the runner sees one ordered array. The
// engine array is authored in the upstream repo only and arrives in a
// downstream by merge; THIS file is product-owned and never overwritten by an
// engine sync. Names are the runner's identity: never rename an applied entry.
//
// Rules (stack invariant #4):
//   - a product migration may depend on engine tables; an engine migration
//     never depends on product tables or product data;
//   - engine migrations never UPDATE product-editable content (site copy,
//     seeded guides) — such content seeds are product migrations. That is why
//     091, 092 and 104 live here: they write Orange Smiley company copy into
//     rows every product seeds with its own text.
//
// Sections:
//   legacy      entries applied under their pre-split, unprefixed names before
//               2026-09-22. Frozen: never appended to.
//   migrations  new entries, named os_NNN_snake, numbered from 001.
//   aliases     { engineName: [productNamesAlreadyAppliedThatAreEquivalent] }
//               — the runner records the engine name as applied (with
//               resolved_from) instead of running it. Empty in the engine.
//   superseded  { engineName: 'reason' } — engine entries this product never
//               executes; recorded as applied with the reason. Empty here.
//
// Reference copies: server/migrations/091_*.sql, 092_*.sql, 104_*.sql.

module.exports = {
  product: 'os',
  legacy: [
  {
    // The homepage still introduced a carpenter. home_skills and home_stats are
    // seeded rows (007, 017; translated to Icelandic in 030), so the code
    // fallbacks in HomeView never render on a real instance — the copy has to
    // move in the database or it does not move at all.
    //
    // Guarded on updated_by IS NULL: seeds and migrations leave it null, while
    // contentController stamps the admin id on every save. So an instance where
    // somebody already wrote their own copy keeps it, and this migration only
    // replaces content nobody has touched. Idempotent by the same token.
    //
    // DRAFT copy (2026-09-01): Halli approves before launch, and can edit it in
    // place from the homepage inline editors.
    name: '091_home_content_company',
    statements: [
      `UPDATE site_content SET value = '{"eyebrow":"What we do","title":"We build it\\n& we run it","description":"Orange Smiley is an Icelandic software house driven by AI. We build business systems and then operate them — hosting, monitoring, security and the changes you ask for. AI agents do the custom work, which is why bespoke costs subscription money instead of consultancy money.","items":[{"label":"Web","value":"Sites · stores · checkout"},{"label":"Operations","value":"Inventory · invoicing · VAT"},{"label":"AI","value":"Agents build and maintain"},{"label":"Platform","value":"Node · PostgreSQL · Azure"},{"label":"Running it","value":"Hosting · updates · 24/7 watch"},{"label":"Security","value":"OWASP · 2FA · audit logging"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb, updated_at = NOW()
         WHERE key = 'home_skills' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Það sem við gerum","title":"Við smíðum\\n& við rekum","description":"Orange Smiley er íslenskt hugbúnaðarhús knúið gervigreind. Við smíðum rekstrarkerfi og rekum þau svo áfram — hýsingu, vöktun, öryggi og breytingarnar sem þú biður um. Gervigreindin vinnur sérsmíðina, þess vegna kostar hún áskrift en ekki ráðgjafartíma.","items":[{"label":"Vefur","value":"Vefir · verslanir · greiðslur"},{"label":"Rekstur","value":"Lager · reikningar · VSK"},{"label":"Gervigreind","value":"Umboð smíða og viðhalda"},{"label":"Undirstaða","value":"Node · PostgreSQL · Azure"},{"label":"Umsjón","value":"Hýsing · uppfærslur · vöktun"},{"label":"Öryggi","value":"OWASP · 2FA · aðgerðaskrár"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb, updated_at = NOW()
         WHERE key = 'home_skills' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '[{"num":"2026","label":"Founded in Iceland"},{"num":"1","label":"Product — Rekstrarkerfið"},{"num":"20+","label":"Years building software"},{"num":"24/7","label":"Monitored and operated"}]'::jsonb, updated_at = NOW()
         WHERE key = 'home_stats' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '[{"num":"2026","label":"Stofnað á Íslandi"},{"num":"1","label":"Vara — Rekstrarkerfið"},{"num":"20+","label":"ára reynsla af hugbúnaðarsmíði"},{"num":"24/7","label":"vöktun og rekstur"}]'::jsonb, updated_at = NOW()
         WHERE key = 'home_stats' AND locale = 'is' AND updated_by IS NULL`,
    ],
  },
  {
    // The contact page was still the portfolio's: a hero offering to build
    // "in wood or in code", an availability card mentioning a day job at
    // NetApp, a footer signing off as Halli Smiley and linking six hidden
    // surfaces, and the founder's personal email and GitHub as the way to
    // reach the company. Every one of those is a seeded row (030/036/037/038
    // and friends), so the ContactView defaults never render on a real
    // instance and the copy has to move here too.
    //
    // Same guard as 091: updated_by IS NULL means nobody has edited the row.
    // An instance where an admin wrote their own copy keeps it. Rows that do
    // not exist (the en siblings, on instances seeded Icelandic-only) simply
    // match nothing and fall through to the code defaults, which now agree.
    //
    // DRAFT copy (2026-09-01) — Halli approves before launch.
    name: '092_contact_content_company',
    statements: [
      `UPDATE site_content SET value = '{"eyebrow":"Get in touch","title_line1":"Tell us about your operation","title_accent":"— we take care of the systems.","subtitle":"Moving off Shopify, Wix or WordPress, starting something new, or just weighing it up — we read every message and reply within one business day."}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_hero' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Hafa samband","title_line1":"Segðu okkur frá rekstrinum","title_accent":"— við sjáum um kerfin.","subtitle":"Á leið af Shopify, Wix eða WordPress, að byrja á einhverju nýju eða bara að skoða málin — við lesum öll skilaboð og svörum innan eins virks dags."}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_hero' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"items":[{"type":"email","label":"Email","value":"info [at] orangesmiley [dot] is","href":"info@orangesmiley.is"},{"type":"location","label":"Based in","value":"Hafnarfjörður · GMT","meta":"Reply within one business day"}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_card' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"items":[{"type":"email","label":"Netfang","value":"info [at] orangesmiley [dot] is","href":"info@orangesmiley.is"},{"type":"location","label":"Staðsetning","value":"Hafnarfjörður · GMT","meta":"Svar innan eins virks dags"}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_card' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Send a message","title":"Tell us what you need","submit_label":"Send Message","fallback_prefix":"Prefer email?","fallback_link":"Write to us directly."}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_form' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Sendu skilaboð","title":"Segðu okkur hvað þig vantar","submit_label":"Senda skilaboð","fallback_prefix":"Frekar netfang?","fallback_link":"Sendu okkur tölvupóst beint."}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_form' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Right now","title":"What we take on","cards":[{"status":"open","label":"Moving off Shopify, Wix or WordPress","body":"We migrate the store, the products and the customers onto Rekstrarkerfið, and keep it running afterwards."},{"status":"open","label":"A new site or online store","body":"From a company site to a full store with inventory and invoicing — one system, one monthly invoice."},{"status":"limited","label":"Custom systems & partnerships","body":"Work that does not fit a subscription. We take it on when it fits what we are building."}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_availability' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Núna","title":"Hvað við tökum að okkur","cards":[{"status":"open","label":"Flutningur af Shopify, Wix eða WordPress","body":"Við flytjum verslunina, vörurnar og viðskiptavinina yfir á Rekstrarkerfið og rekum það áfram."},{"status":"open","label":"Nýr vefur eða vefverslun","body":"Allt frá fyrirtækjavef upp í verslun með lager og reikningagerð — eitt kerfi, einn mánaðarreikningur."},{"status":"limited","label":"Sérlausnir og samstarf","body":"Verkefni sem passa ekki í áskrift. Við tökum þau að okkur þegar þau falla að því sem við erum að byggja."}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_availability' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Under the hood","title":"How Rekstrarkerfið is built","body1":"This site runs on the same platform our customers do: Node.js and Express with a PostgreSQL database and a vanilla-JS single-page frontend — no framework, no build step. Auth uses Lucia with CSRF and Helmet hardening, email goes through Resend, uploads through Multer, observability through Pino and Sentry, deployed on Azure App Service.","body2":"One shared core carries every customer, and per-customer features ship as flagged modules on top of it rather than forks — which is what lets AI agents build and maintain the custom work, and what keeps every instance patchable on the same day.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure"],"email_btn_label":"Ask us about the platform"}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_built_with' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"eyebrow":"Undir húddinu","title":"Hvernig Rekstrarkerfið er byggt","body1":"Þessi vefur keyrir á sama kerfi og viðskiptavinir okkar: Node.js og Express með PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, tölvupóstur fer gegnum Resend, skráarupphleðsla gegnum Multer, vöktun gegnum Pino og Sentry, allt keyrt á Azure App Service.","body2":"Einn sameiginlegur kjarni ber alla viðskiptavini og sérlausnir bætast ofan á hann sem einingar með rofa — ekki afrit af kerfinu. Þess vegna getur gervigreindin smíðað og viðhaldið sérsmíðinni, og þess vegna má uppfæra öll kerfin sama daginn.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure"],"email_btn_label":"Spurðu okkur um kerfið"}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_built_with' AND locale = 'is' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"brand_name":"Orange Smiley","copy_suffix":"An Icelandic software house driven by AI.","legal_links":[{"label":"Privacy Policy","href":"/personuvernd"},{"label":"Terms of Service","href":"/terms"}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_footer' AND locale = 'en' AND updated_by IS NULL`,
      `UPDATE site_content SET value = '{"brand_name":"Orange Smiley","copy_suffix":"Íslenskt hugbúnaðarhús knúið gervigreind.","legal_links":[{"label":"Persónuverndarstefna","href":"/personuvernd"},{"label":"Notkunarskilmálar","href":"/terms"}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_footer' AND locale = 'is' AND updated_by IS NULL`,
    ],
  },
  {
    // 2026-09-13: /thjonusta stopped showing Rekstrarkerfið's tiers and prices
    // (Halli), but two seeded sales guides still told sellers the prices and the
    // feature table "appear on the website's services page". A seller following
    // them would send a prospect to a page with neither. The seed script is
    // ON CONFLICT DO NOTHING, so fixing its text alone never reaches rows that
    // already exist. Each UPDATE replaces one exact sentence, only where the
    // guide was never saved by a person (updated_by IS NULL — the 091/092 guard;
    // salesGuidesController stamps it on every edit), and only where the old
    // sentence is still present, so a re-run is a no-op. Pure data, no schema.
    // Reference copy: server/migrations/104_sales_guides_services_page.sql
    name: '104_sales_guides_services_page',
    statements: [
      `UPDATE sales_guides SET body = replace(body, ' Þau eru sömu drög og birtast á þjónustusíðu vefsins.', ' Þau eru ekki birt á orangesmiley.is, svo vísaðu viðskiptavini ekki þangað eftir verði.')
       WHERE slug = 'threpin-thrju' AND updated_by IS NULL AND position(' Þau eru sömu drög og birtast á þjónustusíðu vefsins.' in body) > 0`,
      `UPDATE sales_guides SET summary = replace(summary, 'Nákvæma eiginleikataflan, eins og hún birtist á þjónustusíðunni:', 'Nákvæma eiginleikataflan:')
       WHERE slug = 'hvad-er-i-hverju-threpi' AND updated_by IS NULL AND position('Nákvæma eiginleikataflan, eins og hún birtist á þjónustusíðunni:' in summary) > 0`,
      `UPDATE sales_guides SET body = replace(body, 'Þessi leið speglar eiginleikatöfluna á þjónustusíðu vefsins — hún er heimildin þín', 'Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín')
       WHERE slug = 'hvad-er-i-hverju-threpi' AND updated_by IS NULL AND position('Þessi leið speglar eiginleikatöfluna á þjónustusíðu vefsins — hún er heimildin þín' in body) > 0`,
    ],
  },
  ],
  migrations: [
    // { name: 'os_001_…', statements: [ … ] },
  ],
  aliases: {},
  superseded: {},
};
