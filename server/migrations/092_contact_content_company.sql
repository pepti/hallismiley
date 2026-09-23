-- 092_contact_content_company
-- The contact page was still the portfolio's. Seeded rows shadow the
-- ContactView defaults, so the copy has to move in the database too.
-- updated_by IS NULL = nobody has edited it; admin-written copy survives.
-- DRAFT copy (2026-09-01) — Halli approves before launch.

UPDATE site_content SET value = '{"eyebrow":"Get in touch","title_line1":"Tell us about your operation","title_accent":"— we take care of the systems.","subtitle":"Moving off Shopify, Wix or WordPress, starting something new, or just weighing it up — we read every message and reply within one business day."}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_hero' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Hafa samband","title_line1":"Segðu okkur frá rekstrinum","title_accent":"— við sjáum um kerfin.","subtitle":"Á leið af Shopify, Wix eða WordPress, að byrja á einhverju nýju eða bara að skoða málin — við lesum öll skilaboð og svörum innan eins virks dags."}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_hero' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"items":[{"type":"email","label":"Email","value":"info [at] orangesmiley [dot] is","href":"info@orangesmiley.is"},{"type":"location","label":"Based in","value":"Hafnarfjörður · GMT","meta":"Reply within one business day"}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_card' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"items":[{"type":"email","label":"Netfang","value":"info [at] orangesmiley [dot] is","href":"info@orangesmiley.is"},{"type":"location","label":"Staðsetning","value":"Hafnarfjörður · GMT","meta":"Svar innan eins virks dags"}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_card' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Send a message","title":"Tell us what you need","submit_label":"Send Message","fallback_prefix":"Prefer email?","fallback_link":"Write to us directly."}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_form' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Sendu skilaboð","title":"Segðu okkur hvað þig vantar","submit_label":"Senda skilaboð","fallback_prefix":"Frekar netfang?","fallback_link":"Sendu okkur tölvupóst beint."}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_form' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Right now","title":"What we take on","cards":[{"status":"open","label":"Moving off Shopify, Wix or WordPress","body":"We migrate the store, the products and the customers onto Rekstrarkerfið, and keep it running afterwards."},{"status":"open","label":"A new site or online store","body":"From a company site to a full store with inventory and invoicing — one system, one monthly invoice."},{"status":"limited","label":"Custom systems & partnerships","body":"Work that does not fit a subscription. We take it on when it fits what we are building."}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_availability' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Núna","title":"Hvað við tökum að okkur","cards":[{"status":"open","label":"Flutningur af Shopify, Wix eða WordPress","body":"Við flytjum verslunina, vörurnar og viðskiptavinina yfir á Rekstrarkerfið og rekum það áfram."},{"status":"open","label":"Nýr vefur eða vefverslun","body":"Allt frá fyrirtækjavef upp í verslun með lager og reikningagerð — eitt kerfi, einn mánaðarreikningur."},{"status":"limited","label":"Sérlausnir og samstarf","body":"Verkefni sem passa ekki í áskrift. Við tökum þau að okkur þegar þau falla að því sem við erum að byggja."}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_availability' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Under the hood","title":"How Rekstrarkerfið is built","body1":"This site runs on the same platform our customers do: Node.js and Express with a PostgreSQL database and a vanilla-JS single-page frontend — no framework, no build step. Auth uses Lucia with CSRF and Helmet hardening, email goes through Resend, uploads through Multer, observability through Pino and Sentry, deployed on Azure App Service.","body2":"One shared core carries every customer, and per-customer features ship as flagged modules on top of it rather than forks — which is what lets AI agents build and maintain the custom work, and what keeps every instance patchable on the same day.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure"],"email_btn_label":"Ask us about the platform"}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_built_with' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Undir húddinu","title":"Hvernig Rekstrarkerfið er byggt","body1":"Þessi vefur keyrir á sama kerfi og viðskiptavinir okkar: Node.js og Express með PostgreSQL gagnagrunni og hreinum JavaScript framenda sem eitt-síðu vefforrit — enginn rammi, ekkert byggingarskref. Auðkenning notar Lucia með CSRF og Helmet hertingu, tölvupóstur fer gegnum Resend, skráarupphleðsla gegnum Multer, vöktun gegnum Pino og Sentry, allt keyrt á Azure App Service.","body2":"Einn sameiginlegur kjarni ber alla viðskiptavini og sérlausnir bætast ofan á hann sem einingar með rofa — ekki afrit af kerfinu. Þess vegna getur gervigreindin smíðað og viðhaldið sérsmíðinni, og þess vegna má uppfæra öll kerfin sama daginn.","pills":["Node.js","Express","PostgreSQL","Lucia Auth","Helmet","CSRF","Resend","Multer","Pino","Sentry","Vanilla JS SPA","Azure"],"email_btn_label":"Spurðu okkur um kerfið"}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_built_with' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"brand_name":"Orange Smiley","copy_suffix":"An Icelandic software house driven by AI.","legal_links":[{"label":"Privacy Policy","href":"/personuvernd"},{"label":"Terms of Service","href":"/terms"}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_footer' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"brand_name":"Orange Smiley","copy_suffix":"Íslenskt hugbúnaðarhús knúið gervigreind.","legal_links":[{"label":"Persónuverndarstefna","href":"/personuvernd"},{"label":"Notkunarskilmálar","href":"/terms"}]}'::jsonb, updated_at = NOW()
  WHERE key = 'contact_footer' AND locale = 'is' AND updated_by IS NULL;
