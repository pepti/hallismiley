-- 103_books_vehicle_accounts — reference copy; the runner reads server/config/schema.js.
-- 6600 stays the deductible commercial-vehicle account (label + description corrected,
-- guarded on the 072 wording); 6610 is the blocked passenger-car account
-- (l. nr. 50/1988 16. gr. 3. mgr.). Design: Bókari, 2026-09-12. Base: hallismiley 085.
INSERT INTO ledger_accounts (code, name, name_en, type, vat_code, input_vat_blocked, sort, description) VALUES
  ('6600','Rekstur atvinnubifreiða','Commercial vehicle costs','expense','input_24',FALSE,670,
   'Sendi- og vörubifreiðar: innskattur frádráttarbær (undir 5.000 kg aðeins við eingöngu atvinnunot, rg. 192/1993). Fólksbifreiðar fara á 6610')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, name_en = EXCLUDED.name_en, description = EXCLUDED.description
  WHERE ledger_accounts.name = 'Bifreiðakostnaður'
    AND ledger_accounts.description = 'Innskattur er EKKI frádráttarbær af fólksbifreið undir 5.000 kg';

INSERT INTO ledger_accounts (code, name, name_en, type, vat_code, input_vat_blocked, sort, description) VALUES
  ('6610','Rekstur fólksbifreiða','Passenger car costs','expense','none',TRUE,675,
   'Innskattur ekki frádráttarbær af öflun, rekstri og leigu fólksbifreiða (l. nr. 50/1988 16. gr. 3. mgr.)')
ON CONFLICT (code) DO NOTHING;
