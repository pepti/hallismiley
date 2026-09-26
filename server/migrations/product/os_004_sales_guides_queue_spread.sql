-- os_004_sales_guides_queue_spread — reference copy; the runner applies the entry
-- in server/config/product-migrations/os.js (OS_004_EDITS + guideEdit). Follow-up
-- to os_003 (2026-09-26): verk sizes stay 1/5/20 but the D-022 quotas are 2/3/5,
-- so the threpin-thrju queue note no longer promises a verk waits for "next
-- month's units": it is paid with the units of the coming months, spread over
-- several if one month cannot hold it, with a worked example (20 einingar on
-- Rekstur). Only guides no person has saved (updated_by IS NULL) are touched,
-- and only while the old passage is present and the new one absent. `published`
-- is untouched. DRÖG.

UPDATE sales_guides SET body = replace(body, '<li><strong>Verk sem ekkert liggur á</strong> má geyma til næsta mánaðar og taka af einingum hans, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>', '<li><strong>Verk sem ekkert liggur á</strong> má geyma og greiða með einingum næstu mánaða — stærra verk en einn mánuður rúmar má dreifa á fleiri mánuði, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>
<li><strong>Dæmi:</strong> viðskiptavinur í Rekstri (5 einingar á mánuði) vill stórt verk (20 einingar). Annaðhvort dreifist verkið á fjóra mánuði og einingar þeirra mánaða fara í það, eða það hefst strax og hann greiðir það sem er umfram einingar mánaðarins á einingaverði: 15 × 6.000 kr. = 90.000 kr. án VSK. Viðskiptavinurinn velur, og samið er um valið áður en vinnan hefst.</li>')
       WHERE slug = 'threpin-thrju' AND updated_by IS NULL
         AND position('<li><strong>Verk sem ekkert liggur á</strong> má geyma til næsta mánaðar og taka af einingum hans, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>' in body) > 0 AND position('<li><strong>Verk sem ekkert liggur á</strong> má geyma og greiða með einingum næstu mánaða — stærra verk en einn mánuður rúmar má dreifa á fleiri mánuði, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>
<li><strong>Dæmi:</strong> viðskiptavinur í Rekstri (5 einingar á mánuði) vill stórt verk (20 einingar). Annaðhvort dreifist verkið á fjóra mánuði og einingar þeirra mánaða fara í það, eða það hefst strax og hann greiðir það sem er umfram einingar mánaðarins á einingaverði: 15 × 6.000 kr. = 90.000 kr. án VSK. Viðskiptavinurinn velur, og samið er um valið áður en vinnan hefst.</li>' in body) = 0;
