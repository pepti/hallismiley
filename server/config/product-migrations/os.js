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
// Reference copies: server/migrations/091_*.sql, 092_*.sql, 104_*.sql,
// product/os_*.sql.

// One exact passage of one seeded sales guide, old text -> new text: the 104
// pattern as a helper. The UPDATE touches a row only where no person has saved
// the guide (updated_by IS NULL; salesGuidesController stamps it on every
// edit), only while the old passage is still there and the new one is not.
// So a guide somebody edited keeps every word, and a re-run is a no-op. The
// field names are the constants below, never input.
const sqlText = (s) => `'${s.replace(/'/g, "''")}'`;
const guideEdit = ({ slug, field, from, to }) => {
  if (!['title', 'summary', 'body'].includes(field)) throw new Error(`guideEdit: bad field ${field}`);
  return `UPDATE sales_guides SET ${field} = replace(${field}, ${sqlText(from)}, ${sqlText(to)})
       WHERE slug = ${sqlText(slug)} AND updated_by IS NULL
         AND position(${sqlText(from)} in ${field}) > 0 AND position(${sqlText(to)} in ${field}) = 0`;
};

// os_001 — D-020 step 5 (2026-09-22). The seeded guides still sold the retired
// flat subscription (39/59/79 þ.kr./mán, setup fee waived on an annual
// contract) and told sellers to demo on orangesmiley.is. D-001 replaces the
// first (build fee 390/580/690 þ.kr. + service contract 19/29/39 þ.kr./mán
// with 5/10/20 verkeiningar), the demo instance demo.rekstrarkerfi.is the
// second (D-020; being built, Kaffibrennslan Glóð data reset nightly). The
// passages were derived line by line from the old and new seed-sales-guides.js,
// which carries the same text for fresh databases; the test
// tests/integration/salesGuidesD001.test.js checks that old seed text + these
// edits == new seed text. Every figure stays DRÖG until Halli confirms.
const OS_001_EDITS = [
  { slug: 'velkomin-i-soluteymid', field: 'body',
    from: '<p>Sérstaða vörunnar í einni setningu: <em>allir viðskiptavinir fá sama trausta kjarnann, og hver og einn fær að auki sérsníðin sem passa nákvæmlega hans rekstri — af því að gervigreind smíðar og viðheldur sérsniðnu hlutunum kostar það áskrift, ekki ráðgjafatíma.</em></p>',
    to: '<p>Sérstaða vörunnar í einni setningu: <em>allir viðskiptavinir fá sama trausta kjarnann, og hver og einn fær að auki sérsníðin sem passa nákvæmlega hans rekstri — af því að gervigreind smíðar og viðheldur sérsniðnu hlutunum eru þeir greiddir með verkeiningum úr föstum þjónustusamningi, ekki með ráðgjafatímum.</em></p>' },
  { slug: 'innskraning-og-handbokin', field: 'body',
    from: '<p>Vefurinn okkar er með <strong>þemuval</strong>: gestir og notendur geta valið á milli fimm útlita (t.d. bjart, pappírslitað, svarthvítt og tvö dökk). Valið er gert í útlitsvalmyndinni á síðunni og vefurinn man stillinguna í vafranum þínum. Þetta skiptir þig máli af tveimur ástæðum:</p>',
    to: '<p>Vefurinn okkar er með <strong>þemuval</strong>: gestir og notendur geta valið á milli þriggja útlita — Glóð (dökkt, það sem allir sjá fyrst), Bjart (ljóst) og Miðnætti (svart með hvítu letri og mikilli skerpu). Valið er gert í útlitsvalmyndinni á síðunni og vefurinn man stillinguna í vafranum þínum. Þetta skiptir þig máli af tveimur ástæðum:</p>' },
  { slug: 'innskraning-og-handbokin', field: 'body',
    from: '<li>Þegar þú sýnir kerfið er fínt að sýna þemuvalið: það er áþreifanlegt dæmi um að kerfið lagar sig að notandanum.</li>',
    to: '<li>Þemuvalið er áþreifanlegt dæmi um að kerfið lagar sig að notandanum. En þegar þú sýnir viðskiptavini kerfið gerirðu það á <strong>sýnikerfinu demo.rekstrarkerfi.is</strong>, ekki á þessum vef (sjá <em>Kerfið í stuttu máli</em>).</li>' },
  { slug: 'ordalisti', field: 'body',
    from: '<li><strong>Áskrift</strong> — fast mánaðargjald sem innifelur allt: kerfið, hýsinguna, vöktun, öryggisuppfærslur og breytingar. Andstæðan við tímagjald.</li>',
    to: '<li><strong>Uppsetningargjald</strong> — greitt einu sinni fyrir að setja kerfið upp og flytja gögnin yfir. Fast verð eftir þrepi, aldrei tímagjald.</li>\n<li><strong>Þjónustusamningur</strong> — fast mánaðargjald sem heldur kerfinu í rekstri: hýsing, vöktun, öryggisuppfærslur og ákveðinn fjöldi verkeininga á mánuði fyrir breytingar. Fylgir öllum þrepum. Andstæðan við tímagjald.</li>\n<li><strong>Verkeining</strong> — mælieining fyrir vinnu við breytingar og sérsmíði. Hvert verk er metið fyrir fram: lítið verk er 1 eining, meðalstórt 5, stórt 20. Ekki rugla henni saman við <em>sérsniðna einingu</em> hér að neðan: verkeining mælir vinnu, sérsniðin eining er hluti af kerfinu.</li>\n<li><strong>Einingaverð</strong> — fast verð fyrir hverja verkeiningu umfram þær sem fylgja þjónustusamningnum. Upphæðin er ekki ákveðin (DRÖG — Halli staðfestir).</li>' },
  { slug: 'ordalisti', field: 'body',
    from: '<li><strong>Hýsing</strong> — að geyma og keyra vef eða kerfi á netþjóni. Innifalin í áskriftinni.</li>',
    to: '<li><strong>Hýsing</strong> — að geyma og keyra vef eða kerfi á netþjóni. Innifalin í þjónustusamningnum.</li>' },
  { slug: 'ordalisti', field: 'body',
    from: '<li><strong>Uppfærsla</strong> — ný útgáfa kerfisins með lagfæringum og nýjungum. Berst sjálfkrafa til allra; viðskiptavinurinn gerir ekkert.</li>',
    to: '<li><strong>Uppfærsla</strong> — ný útgáfa kerfisins með lagfæringum og nýjungum. Berst sjálfkrafa til allra; viðskiptavinurinn gerir ekkert.</li>\n<li><strong>Sýnikerfi</strong> — sérstakt eintak af Rekstrarkerfinu með tilbúnum sýnigögnum, notað til að sýna viðskiptavinum kerfið: demo.rekstrarkerfi.is. Það er í smíðum, og gögnin þar verða endurstillt á hverri nóttu.</li>' },
  { slug: 'kerfid-i-stuttu-mali', field: 'summary',
    from: 'Yfirlit yfir vöruna á einni síðu: eitt íslenskt kerfi í skýinu sem sameinar heimasíðu, vefverslun og bókhald — sami kjarni fyrir alla, sérsníðin fyrir hvern og einn, allt innifalið í fastri mánaðaráskrift.',
    to: 'Yfirlit yfir vöruna á einni síðu: eitt íslenskt kerfi í skýinu sem sameinar heimasíðu, vefverslun og bókhald — sami kjarni fyrir alla, sérsníðin fyrir hvern og einn, eitt uppsetningargjald og svo fastur þjónustusamningur á mánuði.' },
  { slug: 'kerfid-i-stuttu-mali', field: 'body',
    from: '<p>Allir viðskiptavinir keyra sama kjarnann. Það þýðir að endurbætur og öryggisuppfærslur berast öllum, sjálfkrafa — enginn situr eftir á gamalli útgáfu. Ofan á kjarnann fær hver viðskiptavinur <strong>sérsniðnar einingar</strong>: viðbætur sem passa nákvæmlega hans rekstri. Gervigreind smíðar þær og viðheldur þeim, og þess vegna kosta þær áskrift en ekki ráðgjafatíma. Hver viðskiptavinur er með sína eigin uppsetningu og sinn eigin gagnagrunn — gögnin hans blandast aldrei við annarra.</p>\n<h2>Allt innifalið í áskriftinni</h2>\n<p>Fasta mánaðargjaldið innifelur kerfið sjálft, hýsingu í skýinu, vöktun, öryggisuppfærslur — og <strong>breytingar</strong>. Breytingabeiðnir eru afgreiddar á dögum, ekki mánuðum: svar innan eins virks dags, smábreytingar innan viku. Engir tímareikningar, aldrei. Það er stærsti munurinn á okkur og hefðbundinni vefstofu eða kerfissala.</p>',
    to: '<p>Allir viðskiptavinir keyra sama kjarnann. Það þýðir að endurbætur og öryggisuppfærslur berast öllum, sjálfkrafa — enginn situr eftir á gamalli útgáfu. Ofan á kjarnann fær hver viðskiptavinur <strong>sérsniðnar einingar</strong>: viðbætur sem passa nákvæmlega hans rekstri. Gervigreind smíðar þær og viðheldur þeim, og þess vegna eru þær greiddar með verkeiningum úr þjónustusamningnum en ekki með ráðgjafatímum. Hver viðskiptavinur er með sína eigin uppsetningu og sinn eigin gagnagrunn — gögnin hans blandast aldrei við annarra.</p>\n<h2>Hvað viðskiptavinurinn greiðir</h2>\n<p>Tvennt: <strong>uppsetningargjald</strong> einu sinni, fyrir að setja kerfið upp og flytja gögnin yfir, og <strong>þjónustusamning</strong> á föstu mánaðargjaldi. Samningurinn innifelur hýsingu í skýinu, vöktun, öryggisuppfærslur og ákveðinn fjölda <strong>verkeininga</strong> á mánuði fyrir breytingar og sérsmíði. Breytingabeiðnir eru afgreiddar á dögum, ekki mánuðum: svar innan eins virks dags, smábreytingar innan viku. Engir tímareikningar, aldrei. Það er stærsti munurinn á okkur og hefðbundinni vefstofu eða kerfissala. Verðin og reglurnar um verkeiningar eru í leiðinni <em>Þrepin þrjú</em>.</p>' },
  { slug: 'kerfid-i-stuttu-mali', field: 'body',
    from: '<p>Vefur Orange Smiley keyrir á sama kerfi og við seljum — kerfið sem viðskiptavinurinn kaupir er kerfið sem við rekum sjálf. Fyrsti viðskiptavinurinn er íslensk heildverslun sem flutti af Shopify yfir á kerfið. Þegar þú sýnir orangesmiley.is ertu því um leið að sýna vöruna.</p>',
    to: '<p>Vefur Orange Smiley keyrir á sama kerfi og við seljum — kerfið sem viðskiptavinurinn kaupir er kerfið sem við rekum sjálf. Fyrsti viðskiptavinurinn er íslensk heildverslun sem flutti af Shopify yfir á kerfið.</p>\n<h2>Að sýna kerfið: sýnikerfið demo.rekstrarkerfi.is</h2>\n<p>Þegar þú sýnir viðskiptavini kerfið notarðu <strong>sýnikerfið demo.rekstrarkerfi.is</strong>: sérstakt eintak af Rekstrarkerfinu, bara til sýnis. Þú sýnir aldrei á orangesmiley.is og aldrei á kerfi annars viðskiptavinar. Í sýnikerfinu verða tilbúin gögn fyrir skáldað fyrirtæki, <em>Kaffibrennsluna Glóð</em>: vörur, pantanir, reikningar, eitt VSK-tímabil og ein breytingabeiðni í vinnslu. Gögnin verða endurstillt á hverri nóttu, svo þú mátt prófa hvað sem er — daginn eftir er allt eins og áður.</p>\n<ul>\n<li><strong>Staðan núna:</strong> sýnikerfið er í smíðum og ekki komið í loftið. Þangað til talarðu við Halla áður en þú býður viðskiptavini sýningu (DRÖG — Halli staðfestir hvernig sýnt er fram að því).</li>\n<li><strong>Aðgangur:</strong> hver sölumanneskja fær eigin innskráningu sem er varin með kóða úr auðkenningarappi í símanum, auk lykilorðsins. Viðskiptavinur getur fengið tímabundinn aðgang eftir sýningu sem þú leiðir, aldrei á undan henni.</li>\n<li><strong>Leiðin sem þú sýnir:</strong> vefverslun → pöntun → reikningur → VSK → breytingabeiðni.</li>\n<li>Tölvupóstur og greiðslur verða óvirk í sýnikerfinu, svo ekkert berst til raunverulegs fólks.</li>\n</ul>' },
  { slug: 'solusagan', field: 'summary',
    from: 'Kjarnasagan sem öll sala byggist á: stöðluð kerfi reyna að passa öllum og enginn fær það sem hann þarf — Rekstrarkerfið snýr þessu við. Sami trausti kjarninn fyrir alla, sérsníðin fyrir hvern og einn. Sérsniðið kostar áskrift, ekki ráðgjafatíma.',
    to: 'Kjarnasagan sem öll sala byggist á: stöðluð kerfi reyna að passa öllum og enginn fær það sem hann þarf — Rekstrarkerfið snýr þessu við. Sami trausti kjarninn fyrir alla, sérsníðin fyrir hvern og einn. Sérsniðið kostar verkeiningar, ekki ráðgjafatíma.' },
  { slug: 'solusagan', field: 'body',
    from: '<blockquote><p><strong>Sérsniðið kostar áskrift, ekki ráðgjafatíma.</strong></p></blockquote>\n<p>Þessi setning er hjarta sögunnar. Hjá öðrum er sérsníðin dýrasti hlutinn; hjá okkur eru þau innifalin í módelinu — breytingabeiðni fer í ferli og er afgreidd á dögum, ekki mánuðum, án aukareiknings.</p>',
    to: '<blockquote><p><strong>Sérsniðið kostar verkeiningar, ekki ráðgjafatíma.</strong></p></blockquote>\n<p>Þessi setning er hjarta sögunnar. Hjá öðrum er sérsníðin dýrasti hlutinn og reikningurinn kemur eftir á; hjá okkur fylgja verkeiningar þjónustusamningnum í hverjum mánuði, hvert verk er metið í einingum áður en það hefst, og breytingabeiðni er afgreidd á dögum, ekki mánuðum. Viðskiptavinurinn veit alltaf fyrir fram hvað breytingin kostar.</p>' },
  { slug: 'solusagan', field: 'body',
    from: '<p>Ef þú hefur bara eina mínútu: <em>„Þið eruð sennilega með þrjú, fjögur kerfi og jafn marga reikninga — og þegar ykkur vantar breytingu bíðið þið vikum saman eða borgið tímagjald. Við setjum þetta allt í eitt íslenskt kerfi á föstu mánaðargjaldi, og þegar ykkur vantar breytingu er hún afgreidd á dögum. Sérsniðið kostar áskrift, ekki ráðgjafatíma.“</em></p>',
    to: '<p>Ef þú hefur bara eina mínútu: <em>„Þið eruð sennilega með þrjú, fjögur kerfi og jafn marga reikninga — og þegar ykkur vantar breytingu bíðið þið vikum saman eða borgið tímagjald. Við setjum þetta allt í eitt íslenskt kerfi: eitt uppsetningargjald og svo einn þjónustusamningur á föstu mánaðargjaldi. Þegar ykkur vantar breytingu er hún metin fyrir fram og afgreidd á dögum. Sérsniðið kostar verkeiningar, ekki ráðgjafatíma.“</em></p>' },
  { slug: 'threpin-thrju', field: 'summary',
    from: 'Vefur (39), Verslun (59) og Rekstur (79) þ.kr./mán — öll verð DRÖG þar til Halli staðfestir. Flöt áskrift, aldrei tímagjald; uppsetningargjald fellur niður með árssamningi. Hér lærirðu að para fyrirtæki við rétt þrep.',
    to: 'Vefur, Verslun og Rekstur: uppsetningargjald 390 / 580 / 690 þ.kr. og þjónustusamningur 19 / 29 / 39 þ.kr./mán með 5 / 10 / 20 verkeiningum á mánuði — öll verð DRÖG þar til Halli staðfestir, öll án VSK. Aldrei tímagjald. Hér lærirðu verðmódelið, hvað verkeining er og hvernig þú parar fyrirtæki við rétt þrep.' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<p>Verðin hér að neðan eru <strong>DRÖG — óstaðfest</strong> þar til Halli staðfestir þau. Þau eru ekki birt á orangesmiley.is, svo vísaðu viðskiptavini ekki þangað eftir verði. Í samtali máttu nefna þau sem viðmið, en alltaf með fyrirvara: „endanlegt verð kemur í tilboðinu“. Skriflegt verð kemur aðeins frá Halla.</p>\n<h2>Vefur — 39 þ.kr./mán (DRÖG)</h2>',
    to: '<p>Verðin hér að neðan eru <strong>DRÖG — óstaðfest</strong> þar til Halli staðfestir þau, og öll <strong>án VSK</strong>. Þau birtast, líka merkt drög, á verðskrá vörunnar á <strong>rekstrarkerfi.is/verdskra</strong> — þangað máttu vísa viðskiptavini. Þau eru aldrei birt á orangesmiley.is. Í samtali máttu nefna þau sem viðmið, en alltaf með fyrirvara: „endanlegt verð kemur í tilboðinu“. Skriflegt verð kemur aðeins frá Halla.</p>\n<h2>Vefur — 390 þ.kr. uppsetning + 19 þ.kr./mán með 5 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Verslun — 59 þ.kr./mán (DRÖG)</h2>',
    to: '<h2>Verslun — 580 þ.kr. uppsetning + 29 þ.kr./mán með 10 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Rekstur — 79 þ.kr./mán (DRÖG)</h2>',
    to: '<h2>Rekstur — 690 þ.kr. uppsetning + 39 þ.kr./mán með 20 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Gjaldareglurnar</h2>',
    to: '<h2>Verðmódelið: uppsetning + þjónustusamningur</h2>\n<ul>\n<li><strong>Uppsetningargjald</strong> — greitt einu sinni: 390 / 580 / 690 þ.kr. (Vefur / Verslun / Rekstur). Það greiðir fyrir uppsetninguna og flutning gagnanna. Það er rukkað í tvennu lagi: helmingur við undirritun og helmingur þegar kerfið fer í loftið.</li>\n<li><strong>Þjónustusamningur</strong> — fylgir öllum þrepum, enginn kaupir kerfið án hans: 19 / 29 / 39 þ.kr. á mánuði. Hann innifelur hýsingu, vöktun, öryggisuppfærslur og <strong>5 / 10 / 20 verkeiningar á mánuði</strong> fyrir breytingar og sérsmíði. Hann er rukkaður mánaðarlega fyrir fram, frá þeim mánuði sem kerfið fer í loftið.</li>\n<li>Öll verð eru <strong>án VSK</strong>; 24% VSK bætist við á reikningi. Segðu það alltaf þegar þú nefnir verð.</li>\n<li><strong>Aldrei tímagjald</strong> — hvorki í uppsetningu né í breytingum.</li>\n<li>Sérsniðnar einingar ríða á hvaða þrepi sem er — sérþarfir þvinga engan upp um þrep. Þær eru smíðaðar fyrir verkeiningar eins og aðrar breytingar.</li>\n</ul>\n<h2>Verkeiningar — svona virka þær</h2>\n<p>Verkeining er mælieining fyrir vinnu. Hvert verk er metið fyrir fram og viðskiptavinurinn samþykkir matið áður en vinnan hefst — ekkert er unnið án samþykkis. Stærðirnar eru þrjár:</p>\n<ul>\n<li><strong>Lítið verk = 1 eining</strong> — t.d. textabreyting eða nýr reitur í formi.</li>\n<li><strong>Meðalstórt verk = 5 einingar</strong> — t.d. ný síða eða nýtt yfirlit í stjórnborði.</li>\n<li><strong>Stórt verk = 20 einingar</strong> — t.d. nýr eiginleiki eða tenging við annað kerfi.</li>\n</ul>\n<p>Til að gera þetta áþreifanlegt: 5 einingar í Vef duga fyrir fimm litlum verkum eða einu meðalstóru á mánuði; 20 einingar í Rekstri duga fyrir einu stóru verki eða fjórum meðalstórum.</p>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<li><strong>Flöt áskrift</strong> — fast mánaðargjald sem innifelur kerfi, hýsingu, vöktun, öryggisuppfærslur og breytingar. <strong>Aldrei tímagjald.</strong></li>\n<li><strong>Uppsetningargjald</strong> samkvæmt samkomulagi — <strong>fellur niður með árssamningi</strong>. Það er besta röksemdin fyrir árssamningi og þú mátt alltaf nefna hana.</li>\n<li>Sérsniðnar einingar ríða á hvaða þrepi sem er — sérþarfir þvinga engan upp um þrep.</li>',
    to: '<li><strong>Tilkynning við 80%:</strong> viðskiptavinurinn fær að vita þegar 80% af einingum mánaðarins eru notuð.</li>\n<li><strong>Umfram einingarnar:</strong> klárist einingar mánaðarins greiðir hann fast <strong>einingaverð</strong> fyrir það sem umfram er — og fær verðið alltaf gefið upp áður en verkið hefst. Upphæð einingaverðsins er ekki ákveðin: DRÖG — Halli staðfestir. Nefndu enga tölu.</li>\n<li><strong>Verk sem ekkert liggur á</strong> má geyma til næsta mánaðar og taka af einingum hans, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>\n<li>Hvort ónotaðar einingar flytjist yfir á næsta mánuð er ekki ákveðið: DRÖG — Halli staðfestir. Lofaðu engu um það.</li>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<p>Einföld regla: <strong>engin vefverslun → Vefur; vefverslun eða búð → Verslun; vill líka losna við sérstakt bókhaldskerfi → Rekstur.</strong> Ef þú ert í vafa, veldu lægra þrepið — það er auðvelt að færa sig upp og enginn upplifir sig plataðan.</p>',
    to: '<p>Einföld regla: <strong>engin vefverslun → Vefur; vefverslun eða búð → Verslun; vill líka losna við sérstakt bókhaldskerfi → Rekstur.</strong> Ef þú ert í vafa, veldu lægra þrepið — það er auðvelt að færa sig upp og enginn upplifir sig plataðan. Hvað það kostar að færa sig upp um þrep síðar er ekki ákveðið: DRÖG — Halli staðfestir.</p>' },
  { slug: 'fyrsta-samtalid', field: 'body',
    from: '<p>Segðu söguna stutt (sjá <em>Sölusöguna</em>): eitt íslenskt kerfi, einn reikningur, breytingar á dögum, sérsniðið kostar áskrift en ekki ráðgjafatíma. Nefndu þrepið sem þér sýnist passa og af hverju. Ef verð ber á góma: viðmiðunarverðin eru drög og endanlegt verð kemur í tilboðinu frá Halla. Lofaðu engri dagsetningu og engum eiginleika sem þú ert ekki viss um — „þetta læt ég tæknifólkið svara, þú heyrir frá okkur innan eins virks dags“ er alltaf gilt svar.</p>',
    to: '<p>Segðu söguna stutt (sjá <em>Sölusöguna</em>): eitt íslenskt kerfi, einn reikningur, breytingar á dögum, sérsniðið kostar verkeiningar en ekki ráðgjafatíma. Nefndu þrepið sem þér sýnist passa og af hverju. Ef verð ber á góma: viðmiðunarverðin eru drög og endanlegt verð kemur í tilboðinu frá Halla. Lofaðu engri dagsetningu og engum eiginleika sem þú ert ekki viss um — „þetta læt ég tæknifólkið svara, þú heyrir frá okkur innan eins virks dags“ er alltaf gilt svar.</p>' },
  { slug: 'motbarur-og-svor', field: 'body',
    from: '<p>Svarið er samanburður, ekki afsláttur. Fáðu viðmælandann til að leggja saman það sem hann borgar í dag: vefverslunarþjónustu í erlendri mynt, viðbótaröpp hvert með sínu mánaðargjaldi, bókhaldskerfi, vefstofu sem rukkar tímagjald fyrir breytingar. Summan kemur flestum á óvart — og hún er án breytinganna, sem hjá okkur eru innifaldar. Bættu svo við: engir tímareikningar, aldrei; og uppsetningargjaldið fellur niður með árssamningi. Ef verðið er samt fyrirstaða: „endanlegt verð kemur í tilboðinu“ — og láttu Halla vita; þú semur aldrei um verð sjálf(ur).</p>',
    to: '<p>Svarið er samanburður, ekki afsláttur. Fáðu viðmælandann til að leggja saman það sem hann borgar í dag: vefverslunarþjónustu í erlendri mynt, viðbótaröpp hvert með sínu mánaðargjaldi, bókhaldskerfi, vefstofu sem rukkar tímagjald fyrir breytingar. Summan kemur flestum á óvart — og hún er án breytinganna, en hjá okkur fylgja verkeiningar fyrir breytingar þjónustusamningnum í hverjum mánuði. Bættu svo við: engir tímareikningar, aldrei; uppsetningargjaldið er fast verð sem er vitað fyrir fram; og hvert verk er metið áður en það hefst. Ef verðið er samt fyrirstaða: „endanlegt verð kemur í tilboðinu“ — og láttu Halla vita; þú semur aldrei um verð sjálf(ur).</p>' },
  { slug: 'tilbodsferlid', field: 'body',
    from: '<li>Mánaðarverðið og uppsetningargjaldið — þar með talið að uppsetningargjaldið fellur niður með árssamningi.</li>\n<li><strong>Samanburður við núverandi stafla:</strong> hvað fyrirtækið borgar í dag á móti einu föstu mánaðargjaldi. Þetta er sterkasta blaðsíðan — og hún er bara jafn góð og upplýsingarnar sem þú safnaðir.</li>',
    to: '<li>Uppsetningargjaldið og þjónustusamningurinn: mánaðargjaldið og hve margar verkeiningar fylgja, öll verð án VSK. Uppsetningargjaldið er rukkað í tvennu lagi, helmingur við undirritun og helmingur þegar kerfið fer í loftið.</li>\n<li><strong>Samanburður við núverandi stafla:</strong> hvað fyrirtækið borgar í dag á móti föstu mánaðargjaldi þjónustusamningsins, með uppsetningargjaldið sýnt sér. Þetta er sterkasta blaðsíðan — og hún er bara jafn góð og upplýsingarnar sem þú safnaðir.</li>' },
  { slug: 'breytingabeidnir', field: 'body',
    from: '<li><strong>Beiðnin er flokkuð</strong> — smábreyting, stærri breyting eða ný sérsniðin eining.</li>',
    to: '<li><strong>Beiðnin er metin í verkeiningum</strong> — lítið verk (1 eining), meðalstórt (5) eða stórt (20). Viðskiptavinurinn sér matið og samþykkir það áður en vinnan hefst.</li>' },
  { slug: 'breytingabeidnir', field: 'body',
    from: '<p>Þetta eru <strong>markmið sem við vinnum eftir</strong> — orðaðu þau þannig. Segðu „svar innan eins virks dags, smábreytingar að jafnaði innan viku“. Segðu aldrei „samdægurs“, „á morgun“ eða annað umfram markmiðin — það er regla (sjá <em>Hvað þú lofar aldrei</em>). Stærri breytingar og sérsniðnar einingar fá tímamat í svari, ekki fyrir fram frá þér.</p>',
    to: '<p>Þetta eru <strong>markmið sem við vinnum eftir</strong> — orðaðu þau þannig. Segðu „svar innan eins virks dags, smábreytingar að jafnaði innan viku“. Segðu aldrei „samdægurs“, „á morgun“ eða annað umfram markmiðin — það er regla (sjá <em>Hvað þú lofar aldrei</em>). Stærri breytingar og sérsniðnar einingar fá mat í verkeiningum og tímamat í svari, ekki fyrir fram frá þér.</p>' },
  { slug: 'breytingabeidnir', field: 'body',
    from: '<p>Berðu flæðið saman við það sem viðskiptavinurinn þekkir: hjá vefstofu kostar breyting tímagjald og bið; hjá stóru kerfi kostar hún ráðgjafa og mánuði; í app-búð vonar hann að eitthvert app leysi málið. Hjá okkur er breytingin <strong>innifalin í áskriftinni</strong> og afgreidd á dögum. Þess vegna segjum við: flæðið er ekki aukaþjónusta við vöruna — <em>flæðið er varan</em>.</p>',
    to: '<p>Berðu flæðið saman við það sem viðskiptavinurinn þekkir: hjá vefstofu kostar breyting tímagjald og bið; hjá stóru kerfi kostar hún ráðgjafa og mánuði; í app-búð vonar hann að eitthvert app leysi málið. Hjá okkur er breytingin <strong>greidd með verkeiningum sem fylgja þjónustusamningnum</strong>, metin fyrir fram og afgreidd á dögum. Þess vegna segjum við: flæðið er ekki aukaþjónusta við vöruna — <em>flæðið er varan</em>.</p>' },
  { slug: 'manadarleg-samskipti', field: 'body',
    from: '<p>Áskriftarviðskipti lifa á trausti, og traust byggist á reglubundnum samskiptum. Viðskiptavinur sem heyrir aldrei frá okkur man bara eftir gjaldinu sem er dregið mánaðarlega — viðskiptavinur sem fær reglulegt yfirlit sér hvað hann fær fyrir það. Þetta er ódýrasta vörnin gegn uppsögnum.</p>',
    to: '<p>Viðskipti á föstum þjónustusamningi lifa á trausti, og traust byggist á reglubundnum samskiptum. Viðskiptavinur sem heyrir aldrei frá okkur man bara eftir gjaldinu sem er dregið mánaðarlega — viðskiptavinur sem fær reglulegt yfirlit sér hvað hann fær fyrir það. Þetta er ódýrasta vörnin gegn uppsögnum.</p>' },
  { slug: 'manadarleg-samskipti', field: 'body',
    from: '<li><strong>Hvað var afgreitt:</strong> breytingabeiðnir sem var lokið í mánuðinum — taldar upp með einföldum orðum. Þetta er mikilvægasti hlutinn: hann sýnir svart á hvítu að áskriftin skilar vinnu.</li>',
    to: '<li><strong>Hvað var afgreitt:</strong> breytingabeiðnir sem var lokið í mánuðinum — taldar upp með einföldum orðum. Þetta er mikilvægasti hlutinn: hann sýnir svart á hvítu að þjónustusamningurinn skilar vinnu.</li>\n<li><strong>Verkeiningar:</strong> hve margar einingar mánaðarins voru notaðar og í hvað.</li>' },
  { slug: 'manadarleg-samskipti', field: 'body',
    from: '<h2>Árssamningurinn og endurnýjun</h2>\n<p>Munaðu að árssamningur er hagstæðastur fyrir báða: viðskiptavinurinn slapp við uppsetningargjaldið og við fáum fyrirsjáanleika. Þegar líður að endurnýjun áttu að vita stöðuna á sambandinu löngu áður en dagsetningin rennur upp — það er afrakstur mánaðarlegu samtalanna. Öll umræða um verð eða samningskjör við endurnýjun fer til Halla, eins og alltaf.</p>',
    to: '<h2>Samningstíminn og endurnýjun</h2>\n<p>Í drögum að þjónustusamningi gildir samningurinn í 12 mánuði frá því kerfið fer í loftið og endurnýjast svo sjálfkrafa um 12 mánuði í senn (DRÖG — lögfræðingur á eftir að fara yfir samninginn og Halli staðfestir). Fylgstu líka með einingunum: viðskiptavinur sem klárar einingar mánaðarins aftur og aftur gæti átt betur heima í þrepinu fyrir ofan — skráðu það og láttu Halla vita. Þegar líður að endurnýjun áttu að vita stöðuna á sambandinu löngu áður en dagsetningin rennur upp — það er afrakstur mánaðarlegu samtalanna. Öll umræða um verð eða samningskjör við endurnýjun fer til Halla, eins og alltaf.</p>' },
  { slug: 'hvad-thu-lofar-aldrei', field: 'body',
    from: '<li>Viðmiðunarverðin (39/59/79 þ.kr./mán) eru <strong>DRÖG</strong> þar til Halli staðfestir og máttu aðeins nefnast sem viðmið með þeim fyrirvara.</li>',
    to: '<li>Viðmiðunarverðin — uppsetningargjald 390 / 580 / 690 þ.kr. og þjónustusamningur 19 / 29 / 39 þ.kr./mán með 5 / 10 / 20 verkeiningum — eru <strong>DRÖG</strong> þar til Halli staðfestir, og máttu aðeins nefnast sem viðmið með þeim fyrirvara og alltaf án VSK.</li>' },
  { slug: 'hvad-thu-lofar-aldrei', field: 'body',
    from: '<li>Sama gildir um uppsetningargjaldið: reglan „fellur niður með árssamningi“ er það eina sem þú mátt fullyrða um það.</li>',
    to: '<li>Einingaverðið, það sem greitt er fyrir verkeiningar umfram samninginn, er ekki ákveðið — þú nefnir enga tölu. Hvort ónotaðar einingar flytjist milli mánaða er heldur ekki ákveðið — þú lofar engu um það.</li>\n<li>Þú metur aldrei sjálf(ur) hve margar verkeiningar verk kostar. Matið kemur úr ferlinu, áður en vinnan hefst.</li>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<p>Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín þegar viðskiptavinur spyr „er þetta innifalið?“. Ef eiginleiki er ekki hér, þá er hann ekki innifalinn og þú lofar honum ekki (sjá <em>Hvað þú lofar aldrei</em>). Verðin eru DRÖG þar til Halli staðfestir: Vefur 39, Verslun 59, Rekstur 79 þ.kr./mán. Hvert þrep inniheldur allt úr þrepinu á undan.</p>',
    to: '<p>Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín þegar viðskiptavinur spyr „er þetta innifalið?“. Ef eiginleiki er ekki hér, þá er hann ekki innifalinn og þú lofar honum ekki (sjá <em>Hvað þú lofar aldrei</em>). Verðin eru DRÖG þar til Halli staðfestir, öll án VSK: Vefur 390 þ.kr. uppsetning + 19 þ.kr./mán með 5 verkeiningum, Verslun 580 þ.kr. + 29 þ.kr./mán með 10, Rekstur 690 þ.kr. + 39 þ.kr./mán með 20. Hvert þrep inniheldur allt úr þrepinu á undan.</p>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<li><strong>Breytingabeiðnir afgreiddar á dögum</strong> — þjónustuflæðið sjálft (sjá <em>Breytingabeiðnir</em>) er innifalið í öllum þrepum, líka því minnsta. Svar innan eins virks dags, smábreytingar innan viku.</li>',
    to: '<li><strong>Breytingabeiðnir afgreiddar á dögum</strong> — þjónustuflæðið sjálft (sjá <em>Breytingabeiðnir</em>) er innifalið í öllum þrepum, líka því minnsta; verkin eru greidd með verkeiningum þjónustusamningsins (5, 10 eða 20 á mánuði eftir þrepi). Svar innan eins virks dags, smábreytingar innan viku.</li>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<p>Í öllum þrepum er líka innifalið það sem fylgir áskriftinni sjálfri: hýsing í skýinu, vöktun og öryggisuppfærslur — viðskiptavinurinn kaupir aldrei neitt af þessu sérstaklega.</p>',
    to: '<p>Í öllum þrepum er líka innifalið það sem fylgir þjónustusamningnum sjálfum: hýsing í skýinu, vöktun og öryggisuppfærslur — viðskiptavinurinn kaupir aldrei neitt af þessu sérstaklega.</p>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<li><strong>Uppsetningargjald</strong> er samkvæmt samkomulagi og <strong>fellur niður með árssamningi</strong>.</li>',
    to: '<li><strong>Uppsetningargjald</strong> er fast verð eftir þrepi (390 / 580 / 690 þ.kr., DRÖG) og <strong>þjónustusamningur</strong> fylgir öllum þrepum.</li>' },
];

// os_002: the contact page's hero subtitle and "What we take on" cards, per
// locale. Must equal DEFAULT_HERO.subtitle / DEFAULT_AVAILABILITY in
// public/js/views/ContactView.js (contactContentOs002.test.js pins it).
// DRAFT (2026-09-26, Efnishöfundur) — awaiting Halli.
const OS_002_CONTACT = {
  hero_subtitle: {
    en: 'A new website, a system built around the way you work, a move off an old system, or just a question about what is possible. We read every message and reply within one business day.',
    is: 'Nýr vefur, kerfi smíðað utan um verklagið, flutningur af gömlu kerfi eða bara spurning um hvað er hægt. Við lesum öll skilaboð og svörum innan eins virks dags.',
  },
  availability: {
    en: {
      eyebrow: 'Right now',
      title: 'What we take on',
      cards: [
        { status: 'open',    label: 'Custom systems and integrations', body: 'Systems built around the way you work, links to accounting and payment gateways, and automation that takes repetitive manual work off the table.' },
        { status: 'open',    label: 'Websites, stores and migrations', body: 'A new website or online store, or a move off an older system without the business stopping. We host it and keep it maintained.' },
        { status: 'limited', label: 'Larger projects',                 body: 'Work that takes months to build. We take it on when it fits what we are building.' },
      ],
    },
    is: {
      eyebrow: 'Núna',
      title: 'Hvað við tökum að okkur',
      cards: [
        { status: 'open',    label: 'Sérsmíðuð kerfi og tengingar',   body: 'Kerfi utan um verklagið, tengingar við bókhald og greiðslugáttir og sjálfvirkni sem tekur endurtekna handavinnu af borðinu.' },
        { status: 'open',    label: 'Vefir, verslanir og flutningur', body: 'Nýr vefur eða vefverslun, eða flutningur af eldra kerfi án þess að reksturinn stöðvist. Við hýsum og höldum því við.' },
        { status: 'limited', label: 'Stærri verkefni',                body: 'Verkefni sem taka marga mánuði í smíði. Við tökum þau að okkur þegar þau falla að því sem við erum að byggja.' },
      ],
    },
  },
};

// os_003 — D-022 (Halli, 2026-09-26) re-prices the service contract and adds a
// fourth tier. Build fees stay 390/580/690 þ.kr. and verk sizes 1/5/20; the
// contract becomes 29/59/89 þ.kr./mán with 2/3/5 verkeiningar (was 19/29/39
// with 5/10/20), einingaverð 6.000 kr. above the quota, hosting beyond the
// tier's pattern at Azure cost + 15 %, AI inside the system included up to
// 2.000 kr./mán then cost + 15 %. The fourth tier, Samstarf, has no listed
// price: it is agreed after a free assessment, for customers who need a system
// built around their own business. The guides that quoted D-001 (and the ones
// that name the three tiers) learn the new figures, where Samstarf fits and
// when a seller offers the free assessment instead of quoting a tier. Same
// helper, same guard as os_001; applied on top of os_001's text. The seed
// script carries the result; tests/integration/salesGuidesD022.test.js checks
// that D-001 text + these edits == seed text. Every figure and all Samstarf
// copy stay DRÖG until Halli approves; the guides stay unpublished.
const OS_003_EDITS = [
  { slug: 'velkomin-i-soluteymid', field: 'body',
    from: 'keyrir í skýinu (þ.e. á netþjónum sem við sjáum um, viðskiptavinurinn þarf engan búnað) og er í boði í þremur þjónustuleiðum.</p>',
    to: 'keyrir í skýinu (þ.e. á netþjónum sem við sjáum um, viðskiptavinurinn þarf engan búnað) og er í boði í þremur þjónustuleiðum með föstu verði. Fjórða leiðin, <strong>Samstarf</strong>, er fyrir fyrirtæki sem þurfa kerfi smíðað utan um eigin rekstur: þar er verðið samið eftir ókeypis úttekt (sjá <em>Þrepin þrjú</em>).</p>' },
  { slug: 'ordalisti', field: 'body',
    from: '<li><strong>Einingaverð</strong> — fast verð fyrir hverja verkeiningu umfram þær sem fylgja þjónustusamningnum. Upphæðin er ekki ákveðin (DRÖG — Halli staðfestir).</li>',
    to: '<li><strong>Einingaverð</strong> — fast verð fyrir hverja verkeiningu umfram þær sem fylgja þjónustusamningnum: 6.000 kr. án VSK (DRÖG — Halli staðfestir).</li>\n<li><strong>Samstarf</strong> — fjórða leiðin, fyrir fyrirtæki sem þurfa kerfi smíðað utan um eigin rekstur. Samstarf hefur ekkert listaverð: verðið er samið eftir <em>ókeypis úttekt</em>.</li>\n<li><strong>Ókeypis úttekt</strong> — við förum yfir rekstur fyrirtækisins og hvað við leggjum til að smíða fyrir það. Úttektin kostar viðskiptavininn ekkert, og út úr því kemur tilboð í Samstarf.</li>' },
  { slug: 'ordalisti', field: 'body',
    from: '<li><strong>Hýsing</strong> — að geyma og keyra vef eða kerfi á netþjóni. Innifalin í þjónustusamningnum.</li>',
    to: '<li><strong>Hýsing</strong> — að geyma og keyra vef eða kerfi á netþjóni. Innifalin í þjónustusamningnum, í þeirri stærð sem fylgir þrepinu. Þurfi viðskiptavinurinn meira er það sem umfram er rukkað á kostnaðarverði skýjaþjónustunnar (Azure) að viðbættum 15 %.</li>' },
  { slug: 'kerfid-i-stuttu-mali', field: 'body',
    from: '<p>Þjónustuleiðirnar þrjár (sjá <em>Þrepin þrjú</em>) eru einfaldlega mismunandi stórir skammtar af þessu sama kerfi — ekki þrjár ólíkar vörur.</p>',
    to: '<p>Þjónustuleiðirnar þrjár (sjá <em>Þrepin þrjú</em>) eru einfaldlega mismunandi stórir skammtar af þessu sama kerfi — ekki þrjár ólíkar vörur. Fyrirtæki sem þarf kerfi smíðað utan um eigin rekstur fer í fjórðu leiðina, <strong>Samstarf</strong>: þar er verðið samið eftir ókeypis úttekt.</p>' },
  { slug: 'fyrsta-samtalid', field: 'body',
    from: 'Nefndu þrepið sem þér sýnist passa og af hverju. Ef verð ber á góma:',
    to: 'Nefndu þrepið sem þér sýnist passa og af hverju — eða, ef reksturinn þarf kerfi smíðað utan um sig, bjóddu ókeypis úttekt í stað þreps (sjá <em>Þrepin þrjú</em>, kaflann um Samstarf). Ef verð ber á góma:' },
  { slug: 'threpin-thrju', field: 'title',
    from: 'Þrepin þrjú og hverjum þau henta',
    to: 'Þrepin þrjú, Samstarf og hverjum þau henta' },
  { slug: 'threpin-thrju', field: 'summary',
    from: 'Vefur, Verslun og Rekstur: uppsetningargjald 390 / 580 / 690 þ.kr. og þjónustusamningur 19 / 29 / 39 þ.kr./mán með 5 / 10 / 20 verkeiningum á mánuði — öll verð DRÖG þar til Halli staðfestir, öll án VSK. Aldrei tímagjald. Hér lærirðu verðmódelið, hvað verkeining er og hvernig þú parar fyrirtæki við rétt þrep.',
    to: 'Vefur, Verslun og Rekstur: uppsetningargjald 390 / 580 / 690 þ.kr. og þjónustusamningur 29 / 59 / 89 þ.kr./mán með 2 / 3 / 5 verkeiningum á mánuði, einingaverð 6.000 kr. umfram það — öll verð DRÖG þar til Halli staðfestir, öll án VSK. Fjórða leiðin, Samstarf, hefur ekkert listaverð: verðið er samið eftir ókeypis úttekt. Aldrei tímagjald. Hér lærirðu verðmódelið, hvað verkeining er, hvernig þú parar fyrirtæki við rétt þrep og hvenær þú býður ókeypis úttekt í staðinn.' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<p>Rekstrarkerfið er selt í þremur þjónustuleiðum — þrepum. Þau eru ekki þrjár vörur heldur mismunandi stórir skammtar af sama kerfinu; viðskiptavinur getur alltaf fært sig upp síðar.',
    to: '<p>Rekstrarkerfið er selt í þremur þjónustuleiðum með föstu verði — þrepum. Þau eru ekki þrjár vörur heldur mismunandi stórir skammtar af sama kerfinu; viðskiptavinur getur alltaf fært sig upp síðar. Fjórða leiðin, <strong>Samstarf</strong>, er fyrir fyrirtæki sem þurfa kerfi smíðað utan um eigin rekstur; hún hefur ekkert listaverð og henni er lýst neðst í þessari leið.' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Vefur — 390 þ.kr. uppsetning + 19 þ.kr./mán með 5 verkeiningum (DRÖG)</h2>',
    to: '<h2>Vefur — 390 þ.kr. uppsetning + 29 þ.kr./mán með 2 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Verslun — 580 þ.kr. uppsetning + 29 þ.kr./mán með 10 verkeiningum (DRÖG)</h2>',
    to: '<h2>Verslun — 580 þ.kr. uppsetning + 59 þ.kr./mán með 3 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<h2>Rekstur — 690 þ.kr. uppsetning + 39 þ.kr./mán með 20 verkeiningum (DRÖG)</h2>',
    to: '<h2>Rekstur — 690 þ.kr. uppsetning + 89 þ.kr./mán með 5 verkeiningum (DRÖG)</h2>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<li><strong>Þjónustusamningur</strong> — fylgir öllum þrepum, enginn kaupir kerfið án hans: 19 / 29 / 39 þ.kr. á mánuði. Hann innifelur hýsingu, vöktun, öryggisuppfærslur og <strong>5 / 10 / 20 verkeiningar á mánuði</strong> fyrir breytingar og sérsmíði. Hann er rukkaður mánaðarlega fyrir fram, frá þeim mánuði sem kerfið fer í loftið.</li>',
    to: '<li><strong>Þjónustusamningur</strong> — fylgir öllum þrepum, enginn kaupir kerfið án hans: 29 / 59 / 89 þ.kr. á mánuði. Hann innifelur hýsingu, vöktun, öryggisuppfærslur og <strong>2 / 3 / 5 verkeiningar á mánuði</strong> fyrir breytingar og sérsmíði. Hann er rukkaður mánaðarlega fyrir fram, frá þeim mánuði sem kerfið fer í loftið.</li>\n<li><strong>Hýsing umfram þrepið</strong> — hverju þrepi fylgir hýsing í ákveðinni stærð. Þurfi viðskiptavinurinn meira, t.d. fast prófunarumhverfi eða stærri gagnagrunn, er það sem umfram er rukkað á kostnaðarverði Azure að viðbættum 15 %. Lofaðu aldrei aukahýsingu innifalinni.</li>\n<li><strong>Gervigreind í kerfinu</strong> — gervigreind sem vinnur inni í kerfi viðskiptavinarins, t.d. við innlestur pantana, er innifalin upp að 2.000 kr. á mánuði. Umfram það er hún rukkuð á kostnaðarverði að viðbættum 15 %.</li>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<p>Til að gera þetta áþreifanlegt: 5 einingar í Vef duga fyrir fimm litlum verkum eða einu meðalstóru á mánuði; 20 einingar í Rekstri duga fyrir einu stóru verki eða fjórum meðalstórum.</p>',
    to: '<p>Til að gera þetta áþreifanlegt: 2 einingar í Vef duga fyrir tveimur litlum verkum á mánuði; 5 einingar í Rekstri duga fyrir fimm litlum verkum eða einu meðalstóru. Stórt verk (20 einingar) er stærra en mánaðarskammtur nokkurs þreps, svo það sem umfram er greiðist á einingaverði — og viðskiptavinurinn sér upphæðina áður en hann samþykkir verkið.</p>' },
  { slug: 'threpin-thrju', field: 'body',
    from: 'fyrir það sem umfram er — og fær verðið alltaf gefið upp áður en verkið hefst. Upphæð einingaverðsins er ekki ákveðin: DRÖG — Halli staðfestir. Nefndu enga tölu.</li>',
    to: 'fyrir það sem umfram er: <strong>6.000 kr. á einingu án VSK</strong> (DRÖG — Halli staðfestir). Hann fær upphæðina alltaf gefna upp áður en verkið hefst.</li>' },
  { slug: 'threpin-thrju', field: 'body',
    from: '<p>Einföld regla: <strong>engin vefverslun → Vefur; vefverslun eða búð → Verslun; vill líka losna við sérstakt bókhaldskerfi → Rekstur.</strong> Ef þú ert í vafa, veldu lægra þrepið — það er auðvelt að færa sig upp og enginn upplifir sig plataðan. Hvað það kostar að færa sig upp um þrep síðar er ekki ákveðið: DRÖG — Halli staðfestir.</p>',
    to: '<p>Einföld regla: <strong>engin vefverslun → Vefur; vefverslun eða búð → Verslun; vill líka losna við sérstakt bókhaldskerfi → Rekstur; þarf kerfi smíðað utan um eigin rekstur → Samstarf.</strong> Ef þú ert í vafa milli tveggja þrepa, veldu lægra þrepið — það er auðvelt að færa sig upp og enginn upplifir sig plataðan. Hvað það kostar að færa sig upp um þrep síðar er ekki ákveðið: DRÖG — Halli staðfestir. Ef þú ert í vafa um hvort nokkurt þrep passi, bjóddu ókeypis úttekt (sjá hér að neðan).</p>\n<h2>Samstarf — fjórða leiðin, verð eftir ókeypis úttekt (DRÖG)</h2>\n<p><em>Fyrir fyrirtæki sem þurfa kerfi smíðað utan um eigin rekstur.</em></p>\n<p>Sum fyrirtæki passa ekki í neitt þrepanna. Þau vantar ekki stærri skammt af sama kerfinu heldur kerfi sem er smíðað utan um verklagið þeirra: sérstaka vöruflokka og verðlagningu, tengingar við kerfi birgja og viðskiptavina, ferla sem ekkert staðlað kerfi kann. Fyrsti viðskiptavinurinn okkar er einmitt slíkt fyrirtæki. Fyrir þau er <strong>Samstarf</strong>.</p>\n<p>Samstarf hefur <strong>ekkert listaverð</strong>. Verðið er samið eftir <strong>ókeypis úttekt</strong>: við förum yfir rekstur fyrirtækisins og hvað við leggjum til að smíða fyrir það, og út úr því kemur tilboð sem Halli sendir. Úttektin kostar viðskiptavininn ekkert. Hvernig samningurinn er byggður upp — uppsetning, mánaðargjald, verkeiningar — kemur fram í tilboðinu, ekki frá þér.</p>\n<h2>Hvenær þú býður ókeypis úttekt í stað þreps</h2>\n<p>Bjóddu ókeypis úttekt, og nefndu ekkert verð, þegar þú heyrir eitthvað af þessu:</p>\n<ul>\n<li>Reksturinn byggist á verklagi sem staðlað kerfi styður ekki — „við gerum þetta öðruvísi en allir aðrir“.</li>\n<li>Kerfið þarf að tala við mörg önnur kerfi: birgja, heildsala, bókhald, sérhæfðan búnað.</li>\n<li>Sérþarfirnar eru margar eða stórar strax í upphafi — ekki ein eða tvær sérsniðnar einingar heldur mörg stór verk.</li>\n<li>Fyrirtækið er á leið af eldra kerfi sem hefur verið lagað að því árum saman, og gögnin eða ferlarnir eru flóknir.</li>\n<li>Þú getur ekki sagt með vissu hvaða þrep passar, jafnvel eftir fyrsta samtalið.</li>\n</ul>\n<p>Þá segirðu: <em>„Það sem þið lýsið þarf að smíða utan um ykkar rekstur. Við bjóðum ókeypis úttekt: við förum yfir reksturinn og hvað við myndum smíða, og þið fáið tilboð út frá því. Úttektin kostar ykkur ekkert.“</em> Skráðu það sem þú heyrðir eins og fyrir tilboð (sjá <em>Tilboðsferlið</em>) og láttu Halla vita. Þú framkvæmir ekki úttektina sjálf(ur) og nefnir aldrei verð í Samstarfi, ekki heldur „svona í kringum“. Nefndu heldur aldrei fyrsta viðskiptavininn á nafn eða tölur úr því verkefni.</p>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'summary',
    from: 'hvað bætist við í Verslun og hvað er aðeins í Rekstri. Þetta er heimildin',
    to: 'hvað bætist við í Verslun og hvað er aðeins í Rekstri. Samstarf er utan töflunnar: þar ræður ókeypis úttektin. Þetta er heimildin' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: 'Vefur 390 þ.kr. uppsetning + 19 þ.kr./mán með 5 verkeiningum, Verslun 580 þ.kr. + 29 þ.kr./mán með 10, Rekstur 690 þ.kr. + 39 þ.kr./mán með 20. Hvert þrep inniheldur allt úr þrepinu á undan.</p>',
    to: 'Vefur 390 þ.kr. uppsetning + 29 þ.kr./mán með 2 verkeiningum, Verslun 580 þ.kr. + 59 þ.kr./mán með 3, Rekstur 690 þ.kr. + 89 þ.kr./mán með 5; einingaverð umfram það 6.000 kr. Hvert þrep inniheldur allt úr þrepinu á undan. Samstarf, fjórða leiðin, er ekki í töflunni: þar er kerfið smíðað utan um rekstur viðskiptavinarins og innihaldið ákveðið eftir ókeypis úttekt.</p>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '(5, 10 eða 20 á mánuði eftir þrepi)',
    to: '(2, 3 eða 5 á mánuði eftir þrepi)' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<p>Í öllum þrepum er líka innifalið það sem fylgir þjónustusamningnum sjálfum: hýsing í skýinu, vöktun og öryggisuppfærslur — viðskiptavinurinn kaupir aldrei neitt af þessu sérstaklega.</p>',
    to: '<p>Í öllum þrepum er líka innifalið það sem fylgir þjónustusamningnum sjálfum: hýsing í skýinu í þeirri stærð sem fylgir þrepinu, vöktun, öryggisuppfærslur og gervigreind inni í kerfinu upp að 2.000 kr. á mánuði. Aðeins það sem fer umfram — meiri hýsing en þrepinu fylgir, eða gervigreind yfir 2.000 kr. á mánuði — er rukkað sérstaklega, á kostnaðarverði að viðbættum 15 %.</p>' },
  { slug: 'hvad-er-i-hverju-threpi', field: 'body',
    from: '<li><strong>Uppsetningargjald</strong> er fast verð eftir þrepi (390 / 580 / 690 þ.kr., DRÖG) og <strong>þjónustusamningur</strong> fylgir öllum þrepum.</li>',
    to: '<li><strong>Uppsetningargjald</strong> er fast verð eftir þrepi (390 / 580 / 690 þ.kr., DRÖG) og <strong>þjónustusamningur</strong> fylgir öllum þrepum.</li>\n<li><strong>Samstarf</strong> er utan þrepanna: hvað er smíðað og hvað það kostar ræðst af ókeypis úttekt (sjá <em>Þrepin þrjú</em>). Lofaðu engum eiginleika í Samstarfi fyrr en úttektin liggur fyrir.</li>' },
  { slug: 'tilbodsferlid', field: 'body',
    from: '<li><strong>Líklegt þrep:</strong> Vefur, Verslun eða Rekstur, með rökstuðningi í einni setningu.</li>',
    to: '<li><strong>Líklegt þrep:</strong> Vefur, Verslun eða Rekstur, með rökstuðningi í einni setningu — eða <strong>Samstarf</strong>, ef reksturinn þarf kerfi smíðað utan um sig (sjá <em>Þrepin þrjú</em>). Þá er næsta skref ókeypis úttekt, ekki tilboð beint.</li>' },
  { slug: 'tilbodsferlid', field: 'body',
    from: '<li>Uppsetningargjaldið og þjónustusamningurinn: mánaðargjaldið og hve margar verkeiningar fylgja, öll verð án VSK.',
    to: '<li>Uppsetningargjaldið og þjónustusamningurinn: mánaðargjaldið, hve margar verkeiningar fylgja og einingaverðið umfram þær, öll verð án VSK. Þurfi viðskiptavinurinn meiri hýsingu en þrepinu fylgir kemur hún fram sér, á kostnaðarverði að viðbættum 15 %.' },
  { slug: 'tilbodsferlid', field: 'body',
    from: '<li>Næstu skref: hvað gerist ef tilboðinu er tekið.</li>\n</ol>',
    to: '<li>Næstu skref: hvað gerist ef tilboðinu er tekið.</li>\n</ol>\n<p><strong>Í Samstarfi kemur ókeypis úttektin á undan tilboðinu.</strong> Við förum yfir reksturinn með viðskiptavininum og hvað við leggjum til að smíða, og tilboðið byggist á úttektinni. Þú safnar sömu upplýsingum og í skrefi 1 — þær eru grunnurinn að úttektinni — en nefnir ekkert verð, hvorki fyrir úttektina (hún er ókeypis) né fyrir samstarfið sjálft.</p>' },
  { slug: 'hvad-thu-lofar-aldrei', field: 'body',
    from: 'þjónustusamningur 19 / 29 / 39 þ.kr./mán með 5 / 10 / 20 verkeiningum — eru',
    to: 'þjónustusamningur 29 / 59 / 89 þ.kr./mán með 2 / 3 / 5 verkeiningum og einingaverð 6.000 kr. — eru' },
  { slug: 'hvad-thu-lofar-aldrei', field: 'body',
    from: '<li>Einingaverðið, það sem greitt er fyrir verkeiningar umfram samninginn, er ekki ákveðið — þú nefnir enga tölu. Hvort ónotaðar einingar flytjist milli mánaða er heldur ekki ákveðið — þú lofar engu um það.</li>',
    to: '<li>Hvort ónotaðar einingar flytjist milli mánaða er ekki ákveðið — þú lofar engu um það.</li>\n<li><strong>Samstarf hefur ekkert verð fyrr en eftir ókeypis úttektina.</strong> Þú nefnir enga tölu, ekki heldur „svona í kringum“, og lofar hvorki hvað verður smíðað né hvenær.</li>' },
];

// os_004 — follow-up to os_003 (Halli, 2026-09-26). Verk sizes stay 1/5/20 but
// the D-022 monthly quotas are 2/3/5, so the queue promise "a verk nobody is
// waiting for can wait for next month and take its units, at no extra cost"
// cannot hold for a verk bigger than one month's units. It now says such a verk
// is paid with the units of the coming months, spread over several if one month
// cannot hold it, and a worked example follows (a stórt verk of 20 einingar on
// Rekstur, 5/mán: four months, or start now and pay the rest at the einingaverð
// 6.000 kr.; the customer chooses, agreed before work starts). Same helper and
// guard as os_001/os_003; the seed carries the result;
// tests/integration/salesGuidesQueueSpread.test.js checks os_003 text + this
// edit == seed text. DRÖG; the guides stay unpublished.
const OS_004_EDITS = [
  { slug: 'threpin-thrju', field: 'body',
    from: '<li><strong>Verk sem ekkert liggur á</strong> má geyma til næsta mánaðar og taka af einingum hans, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>',
    to: '<li><strong>Verk sem ekkert liggur á</strong> má geyma og greiða með einingum næstu mánaða — stærra verk en einn mánuður rúmar má dreifa á fleiri mánuði, án aukakostnaðar. Nýjar einingar bætast við um mánaðamót.</li>\n<li><strong>Dæmi:</strong> viðskiptavinur í Rekstri (5 einingar á mánuði) vill stórt verk (20 einingar). Annaðhvort dreifist verkið á fjóra mánuði og einingar þeirra mánaða fara í það, eða það hefst strax og hann greiðir það sem er umfram einingar mánaðarins á einingaverði: 15 × 6.000 kr. = 90.000 kr. án VSK. Viðskiptavinurinn velur, og samið er um valið áður en vinnan hefst.</li>' },
];

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
  {
    // The handbook moves to D-001 pricing and the demo instance (see
    // OS_001_EDITS above). Pure data, no schema; `edits` is carried for the test.
    // Reference copy: server/migrations/product/os_001_sales_guides_d001_pricing.sql
    name: 'os_001_sales_guides_d001_pricing',
    edits: OS_001_EDITS,
    statements: OS_001_EDITS.map(guideEdit),
  },
  {
    // The contact page speaks for the whole company, not Rekstrarkerfið alone,
    // and names no software it replaces (Halli, 2026-09-26). 092 seeded the
    // hero and availability rows with "Shopify, Wix or WordPress" and a
    // migrate-onto-Rekstrarkerfið card, and seeded rows win over the
    // ContactView defaults, so the new copy (OS_002_CONTACT, identical to the
    // defaults) lands here. The 091/092 guard: updated_by IS NULL, so copy a
    // person saved is kept. The hero keeps its other fields (subtitle only).
    // The contact_built_with rows are left in place, inert: the view no longer
    // reads them (the "Undir húddinu" section left the page). Pure data.
    // DRAFT copy — Halli approves.
    // Reference copy: server/migrations/product/os_002_contact_content_offering.sql
    name: 'os_002_contact_content_offering',
    content: OS_002_CONTACT,
    statements: ['en', 'is'].flatMap(lang => [
      `UPDATE site_content SET value = jsonb_set(value, '{subtitle}', to_jsonb(${sqlText(OS_002_CONTACT.hero_subtitle[lang])}::text)), updated_at = NOW()
         WHERE key = 'contact_hero' AND locale = ${sqlText(lang)} AND updated_by IS NULL`,
      `UPDATE site_content SET value = ${sqlText(JSON.stringify(OS_002_CONTACT.availability[lang]))}::jsonb, updated_at = NOW()
         WHERE key = 'contact_availability' AND locale = ${sqlText(lang)} AND updated_by IS NULL`,
    ]),
  },
  {
    // The handbook moves to D-022 pricing and learns the fourth tier, Samstarf
    // (see OS_003_EDITS above). Pure data, no schema, expand-only: text in
    // rows nobody saved, `published` untouched. `edits` is carried for the test.
    // Reference copy: server/migrations/product/os_003_sales_guides_d022_pricing.sql
    name: 'os_003_sales_guides_d022_pricing',
    edits: OS_003_EDITS,
    statements: OS_003_EDITS.map(guideEdit),
  },
  {
    // The queue promise spreads a verk over several months (see OS_004_EDITS
    // above). Pure data, no schema, expand-only: text in rows nobody saved,
    // `published` untouched. `edits` is carried for the test.
    // Reference copy: server/migrations/product/os_004_sales_guides_queue_spread.sql
    name: 'os_004_sales_guides_queue_spread',
    edits: OS_004_EDITS,
    statements: OS_004_EDITS.map(guideEdit),
  },
  ],
  aliases: {},
  superseded: {},
};
