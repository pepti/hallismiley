-- 091_home_content_company
-- The company site was still introducing a carpenter on its homepage.
-- home_skills and home_stats are seeded rows (007, 017, translated in 030),
-- so the HomeView fallbacks never render on a real instance.
--
-- updated_by IS NULL means nobody has edited the row: seeds leave it null,
-- contentController stamps the admin id on save. Admin-written copy survives.
-- DRAFT copy (2026-09-01) — Halli approves before launch.

UPDATE site_content SET value = '{"eyebrow":"What we do","title":"We build it\n& we run it","description":"Orange Smiley is an Icelandic software house driven by AI. We build business systems and then operate them — hosting, monitoring, security and the changes you ask for. AI agents do the custom work, which is why bespoke costs subscription money instead of consultancy money.","items":[{"label":"Web","value":"Sites · stores · checkout"},{"label":"Operations","value":"Inventory · invoicing · VAT"},{"label":"AI","value":"Agents build and maintain"},{"label":"Platform","value":"Node · PostgreSQL · Azure"},{"label":"Running it","value":"Hosting · updates · 24/7 watch"},{"label":"Security","value":"OWASP · 2FA · audit logging"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb, updated_at = NOW()
  WHERE key = 'home_skills' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Það sem við gerum","title":"Við smíðum\n& við rekum","description":"Orange Smiley er íslenskt hugbúnaðarhús knúið gervigreind. Við smíðum rekstrarkerfi og rekum þau svo áfram — hýsingu, vöktun, öryggi og breytingarnar sem þú biður um. Gervigreindin vinnur sérsmíðina, þess vegna kostar hún áskrift en ekki ráðgjafartíma.","items":[{"label":"Vefur","value":"Vefir · verslanir · greiðslur"},{"label":"Rekstur","value":"Lager · reikningar · VSK"},{"label":"Gervigreind","value":"Umboð smíða og viðhalda"},{"label":"Undirstaða","value":"Node · PostgreSQL · Azure"},{"label":"Umsjón","value":"Hýsing · uppfærslur · vöktun"},{"label":"Öryggi","value":"OWASP · 2FA · aðgerðaskrár"}],"image_url":"https://images.unsplash.com/photo-1564603527476-8837eac5a22f?w=700&h=900&fit=crop&q=80&auto=format"}'::jsonb, updated_at = NOW()
  WHERE key = 'home_skills' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '[{"num":"2026","label":"Founded in Iceland"},{"num":"1","label":"Product — Rekstrarkerfið"},{"num":"20+","label":"Years building software"},{"num":"24/7","label":"Monitored and operated"}]'::jsonb, updated_at = NOW()
  WHERE key = 'home_stats' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '[{"num":"2026","label":"Stofnað á Íslandi"},{"num":"1","label":"Vara — Rekstrarkerfið"},{"num":"20+","label":"ára reynsla af hugbúnaðarsmíði"},{"num":"24/7","label":"vöktun og rekstur"}]'::jsonb, updated_at = NOW()
  WHERE key = 'home_stats' AND locale = 'is' AND updated_by IS NULL;
