-- 104_sales_guides_services_page — reference copy; the runner applies the entry
-- in server/config/schema.js. The seeded sales guides stop pointing sellers at
-- /thjonusta for prices and the tier table (removed from the site 2026-09-13).
-- Only guides no person has saved (updated_by IS NULL) are touched.

UPDATE sales_guides SET body = replace(body, ' Þau eru sömu drög og birtast á þjónustusíðu vefsins.', ' Þau eru ekki birt á orangesmiley.is, svo vísaðu viðskiptavini ekki þangað eftir verði.')
       WHERE slug = 'threpin-thrju' AND updated_by IS NULL AND position(' Þau eru sömu drög og birtast á þjónustusíðu vefsins.' in body) > 0;

UPDATE sales_guides SET summary = replace(summary, 'Nákvæma eiginleikataflan, eins og hún birtist á þjónustusíðunni:', 'Nákvæma eiginleikataflan:')
       WHERE slug = 'hvad-er-i-hverju-threpi' AND updated_by IS NULL AND position('Nákvæma eiginleikataflan, eins og hún birtist á þjónustusíðunni:' in summary) > 0;

UPDATE sales_guides SET body = replace(body, 'Þessi leið speglar eiginleikatöfluna á þjónustusíðu vefsins — hún er heimildin þín', 'Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín')
       WHERE slug = 'hvad-er-i-hverju-threpi' AND updated_by IS NULL AND position('Þessi leið speglar eiginleikatöfluna á þjónustusíðu vefsins — hún er heimildin þín' in body) > 0;
