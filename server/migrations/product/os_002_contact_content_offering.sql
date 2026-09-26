-- os_002_contact_content_offering — reference copy; the runner applies the entry
-- in server/config/product-migrations/os.js (OS_002_CONTACT). Halli 2026-09-26: the
-- contact page speaks for the whole company and names no software it replaces.
-- Only rows no person has saved (updated_by IS NULL) are touched. All DRÖG.

UPDATE site_content SET value = jsonb_set(value, '{subtitle}', to_jsonb('A new website, a system built around the way you work, a move off an old system, or just a question about what is possible. We read every message and reply within one business day.'::text)), updated_at = NOW()
         WHERE key = 'contact_hero' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Right now","title":"What we take on","cards":[{"status":"open","label":"Custom systems and integrations","body":"Systems built around the way you work, links to accounting and payment gateways, and automation that takes repetitive manual work off the table."},{"status":"open","label":"Websites, stores and migrations","body":"A new website or online store, or a move off an older system without the business stopping. We host it and keep it maintained."},{"status":"limited","label":"Larger projects","body":"Work that takes months to build. We take it on when it fits what we are building."}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_availability' AND locale = 'en' AND updated_by IS NULL;

UPDATE site_content SET value = jsonb_set(value, '{subtitle}', to_jsonb('Nýr vefur, kerfi smíðað utan um verklagið, flutningur af gömlu kerfi eða bara spurning um hvað er hægt. Við lesum öll skilaboð og svörum innan eins virks dags.'::text)), updated_at = NOW()
         WHERE key = 'contact_hero' AND locale = 'is' AND updated_by IS NULL;

UPDATE site_content SET value = '{"eyebrow":"Núna","title":"Hvað við tökum að okkur","cards":[{"status":"open","label":"Sérsmíðuð kerfi og tengingar","body":"Kerfi utan um verklagið, tengingar við bókhald og greiðslugáttir og sjálfvirkni sem tekur endurtekna handavinnu af borðinu."},{"status":"open","label":"Vefir, verslanir og flutningur","body":"Nýr vefur eða vefverslun, eða flutningur af eldra kerfi án þess að reksturinn stöðvist. Við hýsum og höldum því við."},{"status":"limited","label":"Stærri verkefni","body":"Verkefni sem taka marga mánuði í smíði. Við tökum þau að okkur þegar þau falla að því sem við erum að byggja."}]}'::jsonb, updated_at = NOW()
         WHERE key = 'contact_availability' AND locale = 'is' AND updated_by IS NULL;
