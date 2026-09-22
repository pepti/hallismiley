// Seeds the initial Handbók sölufólks guide set into sales_guides (migration 090).
// Run: node server/scripts/seed-sales-guides.js
// Idempotent: ON CONFLICT (slug) DO NOTHING — never overwrites edited guides.
// ALL guides land as drafts (published = FALSE); Halli publishes from /admin/handbok
// — publishing is the approval act (docs/SALES-STAFF.md).
// Icelandic is canonical; the *_en columns stay NULL for now (EN falls back to IS).
require('dotenv').config();
const { pool } = require('../config/database');

const GUIDES = [
  // ── GRUNNUR ────────────────────────────────────────────────────────────────
  {
    slug: 'velkomin-i-soluteymid',
    section: 'grunnur',
    sort_order: 0,
    title: 'Velkomin(n) í söluteymið — hvað er Orange Smiley og hvað selur þú?',
    summary:
      'Fyrsta leiðin í handbókinni: hvað fyrirtækið gerir, hvað varan heitir og hvert þitt hlutverk er. Lykilregla frá fyrsta degi: við fólk segjum við alltaf „Rekstrarkerfið“ — fyrirtækið heitir Orange Smiley ehf.',
    body: `
<p>Velkomin(n) í hópinn. Þessi handbók er vinnutækið þitt — hér er allt sem þú þarft að vita til að selja og þjónusta af öryggi. Byrjaðu á þessari leið og farðu svo í gegnum hinar í röð.</p>
<h2>Fyrirtækið og varan</h2>
<p><strong>Orange Smiley ehf.</strong> er íslenskt hugbúnaðarfyrirtæki í Hafnarfirði. Það smíðar og rekur vefi, vefverslanir og rekstrarkerfi fyrir lítil og meðalstór íslensk fyrirtæki. Fyrirtækið selur <strong>eina vöru</strong>: <strong>Rekstrarkerfið</strong> — eitt kerfi sem sameinar heimasíðu, vefverslun og bókhald, keyrir í skýinu (þ.e. á netþjónum sem við sjáum um, viðskiptavinurinn þarf engan búnað) og er í boði í þremur þjónustuleiðum.</p>
<p>Sérstaða vörunnar í einni setningu: <em>allir viðskiptavinir fá sama trausta kjarnann, og hver og einn fær að auki sérsníðin sem passa nákvæmlega hans rekstri — af því að gervigreind smíðar og viðheldur sérsniðnu hlutunum kostar það áskrift, ekki ráðgjafatíma.</em></p>
<h2>Nafnareglan — lærðu hana utan að</h2>
<ul>
<li>Við fólk — í samtölum, tölvupóstum, tilboðum, auglýsingum — segjum við alltaf <strong>„Rekstrarkerfið“</strong> (með greini).</li>
<li><strong>Orange Smiley ehf.</strong> er nafn fyrirtækisins — það stendur á reikningum, samningum og í fótum vefsíðna.</li>
<li>Ritháttinn „rekstrarkerfi“ án greinis sérðu bara í vefslóðum og tæknilegum auðkennum — aldrei í texta til fólks.</li>
</ul>
<h2>Hvernig fyrirtækið vinnur</h2>
<p>Orange Smiley er rekið af einum stofnanda, <strong>Halla</strong>, með aðstoð gervigreindarumboða — hugbúnaðar sem vinnur verkin undir hans stjórn. Það þýðir afköst á við stóra stofu á verði sem lítil fyrirtæki ráða við. Grundvallarreglan í öllum rekstrinum er: <em>umboðin og starfsfólkið undirbúa — Halli samþykkir allt sem er óafturkræft.</em> Fyrir þig þýðir það:</p>
<ul>
<li>Halli samþykkir og sendir öll tilboð, öll verð og allan opinberan texta. Alltaf.</li>
<li>Þú lofar aldrei verði, dagsetningu eða eiginleika upp á eigin spýtur (sjá leiðina <em>Hvað þú lofar aldrei</em>).</li>
<li>Verðin sem þú sérð í handbókinni eru merkt <strong>DRÖG</strong> þar til Halli staðfestir þau.</li>
</ul>
<h2>Þitt hlutverk</h2>
<p>Þú ert andlit fyrirtækisins gagnvart viðskiptavinum. Verkefnin þín eru þrjú:</p>
<ol>
<li><strong>Samtöl:</strong> finna fyrirtæki sem passa, hlusta á hvað pirrar þau í núverandi kerfum og finna hvaða þjónustuleið hentar.</li>
<li><strong>Upplýsingasöfnun:</strong> safna því sem þarf í tilboð — tilboðið sjálft er samið í kerfinu og Halli samþykkir og sendir það.</li>
<li><strong>Þjónustusamband:</strong> halda sambandi við viðskiptavini, taka á móti breytingabeiðnum og koma skilaboðum rétta leið.</li>
</ol>
<p>Þú þarft ekki að vera tæknimanneskja. Handbókin útskýrir öll hugtök á mannamáli (sjá <em>Orðalistann</em>) og þú mátt alltaf segja við viðskiptavin: „Þetta læt ég tæknifólkið okkar svara — þú heyrir frá okkur innan eins virks dags.“</p>
`,
  },
  {
    slug: 'innskraning-og-handbokin',
    section: 'grunnur',
    sort_order: 1,
    title: 'Innskráning, lykilorð og handbókin sjálf',
    summary:
      'Hvernig þú kemst inn: póstur með tengli til að velja lykilorð, innskráning á orangesmiley.is og handbókin á /admin/handbok. Líka: hvernig útlitsþemu síðunnar virka og hvað þú gerir ef eitthvað lítur ekki rétt út.',
    body: `
<p>Aðgangurinn þinn er stofnaður fyrir þig — þú þarft ekki að skrá þig sjálf(ur). Svona virkar ferlið frá fyrsta pósti að daglegri notkun.</p>
<h2>Fyrsta innskráning</h2>
<ol>
<li>Þú færð tölvupóst með tengli til að <strong>velja þér lykilorð</strong>. Smelltu á tengilinn og veldu gott lykilorð — langt er betra en flókið, og notaðu það hvergi annars staðar.</li>
<li>Farðu svo á <strong>orangesmiley.is</strong> og skráðu þig inn með netfanginu þínu og nýja lykilorðinu.</li>
<li>Eftir innskráningu birtist <strong>„Admin“</strong> í notandavalmyndinni (efst á síðunni). Smelltu þar — þú lendir beint í <strong>Handbók sölufólks</strong>.</li>
</ol>
<p>Hliðarstikan þín sýnir aðeins einn lið: <em>Handbók</em>. Það er rétt og eðlilegt — sölufólk hefur lesaðgang að handbókinni og ekkert annað í stjórnborðinu. Ef þú sérð fleiri liði, eða ef tengillinn í póstinum er útrunninn, láttu Halla vita.</p>
<h2>Hvernig handbókin er byggð upp</h2>
<p>Leiðunum er skipt í fjóra hluta:</p>
<ul>
<li><strong>Grunnur</strong> — það sem allir þurfa að kunna fyrst (þessi hluti).</li>
<li><strong>Sala</strong> — sölusagan, þjónustuleiðirnar, mótbárur, tilboðsferlið.</li>
<li><strong>Þjónusta</strong> — hvernig við sinnum viðskiptavinum eftir að samningur er kominn.</li>
<li><strong>Vara</strong> — nákvæm lýsing á því hvað er í hverri þjónustuleið.</li>
</ul>
<p>Þú sérð aðeins <strong>útgefnar</strong> leiðir. Drög í vinnslu eru falin þar til Halli hefur yfirfarið þau og gefið út — þannig geturðu treyst því að allt sem þú lest hér hefur verið samþykkt. Ef tvær heimildir stangast á (t.d. gömul glósa hjá þér og handbókin) gildir handbókin; ef handbókin virðist stangast á við vefsíðuna sjálfa, láttu vita — það er villa sem á að laga.</p>
<h2>Útlitsþemu — af hverju síðan getur litið mismunandi út</h2>
<p>Vefurinn okkar er með <strong>þemuval</strong>: gestir og notendur geta valið á milli fimm útlita (t.d. bjart, pappírslitað, svarthvítt og tvö dökk). Valið er gert í útlitsvalmyndinni á síðunni og vefurinn man stillinguna í vafranum þínum. Þetta skiptir þig máli af tveimur ástæðum:</p>
<ul>
<li>Ef viðskiptavinur segir „síðan lítur öðruvísi út hjá mér“ er skýringin oftast valið þema — ekki bilun.</li>
<li>Þegar þú sýnir kerfið er fínt að sýna þemuvalið: það er áþreifanlegt dæmi um að kerfið lagar sig að notandanum.</li>
</ul>
<h2>Öryggisvenjur</h2>
<ul>
<li>Deildu aldrei lykilorðinu þínu — ekki heldur með samstarfsfólki.</li>
<li>Skráðu þig út á tölvum sem aðrir nota.</li>
<li>Ef þú heldur að einhver hafi komist í aðganginn þinn: láttu Halla vita strax og skiptu um lykilorð.</li>
</ul>
`,
  },
  {
    slug: 'ordalisti',
    section: 'grunnur',
    sort_order: 2,
    title: 'Orðalisti — tæknihugtök á mannamáli',
    summary:
      'Öll hugtök sem koma fyrir í handbókinni og í samtölum við viðskiptavini, útskýrð í einni línu hvert. Flettu hér upp þegar orð vefst fyrir þér — og notaðu íslensku orðin í samtölum.',
    body: `
<p>Þú þarft ekki að vera tæknimanneskja til að selja Rekstrarkerfið — en þú þarft að geta útskýrt hugtökin á mannamáli. Hér er listinn. Notaðu íslensku orðin í samtölum; viðskiptavinurinn á ekki að þurfa orðabók.</p>
<h2>Grunnhugtök</h2>
<ul>
<li><strong>Áskrift</strong> — fast mánaðargjald sem innifelur allt: kerfið, hýsinguna, vöktun, öryggisuppfærslur og breytingar. Andstæðan við tímagjald.</li>
<li><strong>Kerfi í skýinu</strong> — kerfið keyrir á netþjónum sem við rekum; viðskiptavinurinn opnar það bara í vafra. Enginn búnaður, engar uppsetningar hjá honum.</li>
<li><strong>Hýsing</strong> — að geyma og keyra vef eða kerfi á netþjóni. Innifalin í áskriftinni.</li>
<li><strong>Lén</strong> — nafn vefsins á netinu, t.d. fyrirtaeki.is. Viðskiptavinurinn á sitt lén; kerfið hans svarar á því.</li>
<li><strong>Gagnagrunnur</strong> — skipulögð geymsla gagnanna: vörur, pantanir, viðskiptavinir, reikningar. Hver viðskiptavinur er með sinn eigin, aðskilinn frá öllum öðrum.</li>
<li><strong>Uppfærsla</strong> — ný útgáfa kerfisins með lagfæringum og nýjungum. Berst sjálfkrafa til allra; viðskiptavinurinn gerir ekkert.</li>
</ul>
<h2>Varan og sérsníðin</h2>
<ul>
<li><strong>Kjarni</strong> — sá hluti kerfisins sem allir viðskiptavinir deila: vefur, verslun, bókhald, notendakerfi.</li>
<li><strong>Sérsniðin eining</strong> — viðbót sem er smíðuð ofan á kjarnann fyrir einn viðskiptavin, af því að reksturinn hans þarf eitthvað sérstakt. Gervigreind smíðar hana og viðheldur henni.</li>
<li><strong>Gervigreind (AI)</strong> — hugbúnaður sem vinnur verk undir stjórn manneskju. Hjá okkur: smíðar sérsníðin og sinnir breytingabeiðnum — Halli ber ábyrgð á öllu sem fer út.</li>
<li><strong>Breytingabeiðni</strong> — ósk viðskiptavinar um breytingu eða viðbót við kerfið sitt. Fer í fast ferli; svar innan eins virks dags. Þetta er kjarninn í þjónustunni okkar.</li>
<li><strong>Eilífðarleyfi</strong> — viðskiptavinurinn fær varanlegt leyfi til að nota sína uppsetningu kerfisins, líka ef samstarfinu lýkur. Kóðinn er áfram eign Orange Smiley.</li>
<li><strong>Efnisstjórnun (CMS)</strong> — að viðskiptavinurinn getur sjálfur breytt texta og myndum á vefnum sínum, án forritara.</li>
</ul>
<h2>Verslun og bókhald</h2>
<ul>
<li><strong>Vefverslun</strong> — verslun á netinu: vörulisti, karfa, greiðslur, pantanir.</li>
<li><strong>Karfa og greiðslusíða</strong> — það sem kaupandinn notar: safnar vörum og borgar með korti.</li>
<li><strong>Afgreiðslukerfi (POS)</strong> — kerfið á afgreiðsluborðinu í búðinni sjálfri; hjá okkur talar það við sama vörulistann og vefverslunin.</li>
<li><strong>Strikamerki</strong> — merkið sem er skannað á vörunni; tengir vöruna í búðinni við kerfið.</li>
<li><strong>VSK</strong> — virðisaukaskattur; kerfið reiknar hann rétt á reikninga.</li>
<li><strong>Viðskiptamannabókhald</strong> — yfirlit yfir hver skuldar hvað: útgefnir reikningar og hvað er ógreitt.</li>
<li><strong>Vörumóttaka</strong> — að skrá vörur inn á lager þegar sending berst frá birgja.</li>
<li><strong>Leitarvélabestun (SEO)</strong> — að vefurinn sé þannig úr garði gerður að Google finni hann og birti ofarlega.</li>
</ul>
`,
  },
  {
    slug: 'kerfid-i-stuttu-mali',
    section: 'grunnur',
    sort_order: 3,
    title: 'Kerfið í stuttu máli — hvað gerir Rekstrarkerfið?',
    summary:
      'Yfirlit yfir vöruna á einni síðu: eitt íslenskt kerfi í skýinu sem sameinar heimasíðu, vefverslun og bókhald — sami kjarni fyrir alla, sérsníðin fyrir hvern og einn, allt innifalið í fastri mánaðaráskrift.',
    body: `
<p>Áður en þú lærir söluræðuna þarftu að skilja vöruna. Hér er Rekstrarkerfið eins og þú myndir útskýra það fyrir vini.</p>
<h2>Eitt kerfi í stað margra</h2>
<p>Lítil fyrirtæki eru gjarnan með sundurlausan búnað: heimasíðu frá vefstofu, vefverslun frá erlendri þjónustu með viðbótaröppum, bókhaldskerfi frá þriðja aðila — og enginn þessara aðila talar við hinn. Rekstrarkerfið sameinar þetta í <strong>einu íslensku kerfi</strong>:</p>
<ul>
<li><strong>Vefur:</strong> heimasíða með efnisstjórnun (viðskiptavinurinn breytir sjálfur texta og myndum), á íslensku og ensku, leitarvélabestuð, með fyrirspurnarformi.</li>
<li><strong>Verslun:</strong> vörulisti og lagerstaða, karfa, greiðslur og pantanir, aðgangar viðskiptavina, strikamerki og afgreiðslukerfi fyrir búðina.</li>
<li><strong>Rekstur:</strong> reikningagerð með VSK, viðskiptamannabókhald og vörumóttaka — bókhaldshliðin á sama stað og salan.</li>
</ul>
<p>Þjónustuleiðirnar þrjár (sjá <em>Þrepin þrjú</em>) eru einfaldlega mismunandi stórir skammtar af þessu sama kerfi — ekki þrjár ólíkar vörur.</p>
<h2>Sami kjarni fyrir alla — sérsníðin fyrir hvern og einn</h2>
<p>Allir viðskiptavinir keyra sama kjarnann. Það þýðir að endurbætur og öryggisuppfærslur berast öllum, sjálfkrafa — enginn situr eftir á gamalli útgáfu. Ofan á kjarnann fær hver viðskiptavinur <strong>sérsniðnar einingar</strong>: viðbætur sem passa nákvæmlega hans rekstri. Gervigreind smíðar þær og viðheldur þeim, og þess vegna kosta þær áskrift en ekki ráðgjafatíma. Hver viðskiptavinur er með sína eigin uppsetningu og sinn eigin gagnagrunn — gögnin hans blandast aldrei við annarra.</p>
<h2>Allt innifalið í áskriftinni</h2>
<p>Fasta mánaðargjaldið innifelur kerfið sjálft, hýsingu í skýinu, vöktun, öryggisuppfærslur — og <strong>breytingar</strong>. Breytingabeiðnir eru afgreiddar á dögum, ekki mánuðum: svar innan eins virks dags, smábreytingar innan viku. Engir tímareikningar, aldrei. Það er stærsti munurinn á okkur og hefðbundinni vefstofu eða kerfissala.</p>
<h2>Við notum kerfið sjálf</h2>
<p>Vefur Orange Smiley keyrir á sama kerfi og við seljum — kerfið sem viðskiptavinurinn kaupir er kerfið sem við rekum sjálf. Fyrsti viðskiptavinurinn er íslensk heildverslun sem flutti af Shopify yfir á kerfið. Þegar þú sýnir orangesmiley.is ertu því um leið að sýna vöruna.</p>
<h2>Það sem kerfið er ekki</h2>
<p>Rekstrarkerfið er ekki risakerfi með þúsund stillingum sem enginn notar, og ekki „app-búð“ þar sem hver viðbót kostar aukalega. Það er heldur ekki launakerfi — og lofaðu aldrei eiginleika sem þú finnur ekki í handbókinni (sjá <em>Hvað þú lofar aldrei</em>).</p>
`,
  },

  // ── SALA ───────────────────────────────────────────────────────────────────
  {
    slug: 'solusagan',
    section: 'sala',
    sort_order: 0,
    title: 'Sölusagan — gegn „einu kerfi fyrir alla“',
    summary:
      'Kjarnasagan sem öll sala byggist á: stöðluð kerfi reyna að passa öllum og enginn fær það sem hann þarf — Rekstrarkerfið snýr þessu við. Sami trausti kjarninn fyrir alla, sérsníðin fyrir hvern og einn. Sérsniðið kostar áskrift, ekki ráðgjafatíma.',
    body: `
<p>Góð sala byggist á einni skýrri sögu. Hér er okkar — lærðu hana þar til þú getur sagt hana með eigin orðum.</p>
<h2>Vandinn: kerfi sem reyna að passa öllum</h2>
<p>Hefðbundin rekstrar- og bókhaldskerfi eru hönnuð til að passa öllum fyrirtækjum í einu. Afleiðingin er kunnugleg hverjum sem hefur notað þau:</p>
<ul>
<li><strong>Stíf kerfi</strong> — fyrirtækið á að laga sig að kerfinu, ekki öfugt. Verkferlar eru eins og þeir eru, punktur.</li>
<li><strong>Ráðgjafareikningar</strong> — sérhver aðlögun kostar ráðgjafatíma á tímagjaldi, og reikningurinn kemur á óvart.</li>
<li><strong>Mánaða bið</strong> — breytingar fara í forgangsröð hjá stórum söluaðila; lítið fyrirtæki er aftast í röðinni.</li>
</ul>
<p>Viðskiptavinir eru þreyttir á þessu módeli. Þeir borga fyrir kerfi sem passar þeim ekki og borga svo aftur fyrir að láta laga það.</p>
<h2>Svarið okkar: sami kjarni, þín sérsníðin</h2>
<p>Rekstrarkerfið snýr módelinu við. Allir viðskiptavinir fá <strong>sama trausta kjarnann</strong> — vef, verslun og bókhald sem er í stöðugri þróun og fær öryggisuppfærslur sjálfkrafa. Og hver viðskiptavinur fær að auki <strong>sérsniðnar einingar</strong> sem passa nákvæmlega hans rekstri — gervigreind smíðar þær og viðheldur þeim, undir ábyrgð Orange Smiley.</p>
<blockquote><p><strong>Sérsniðið kostar áskrift, ekki ráðgjafatíma.</strong></p></blockquote>
<p>Þessi setning er hjarta sögunnar. Hjá öðrum er sérsníðin dýrasti hlutinn; hjá okkur eru þau innifalin í módelinu — breytingabeiðni fer í ferli og er afgreidd á dögum, ekki mánuðum, án aukareiknings.</p>
<h2>Hin sagan: staflinn á mörgum reikningum</h2>
<p>Margir mögulegir viðskiptavinir eru ekki með stórt kerfi heldur <strong>stafla</strong>: erlend vefverslunarþjónusta (t.d. Shopify), viðbótaröpp þar ofan á hvert með sínu gjaldi, sérstakt bókhaldskerfi og vefstofa fyrir heimasíðuna. Fjórir til fimm reikningar á mánuði, enginn aðili ber ábyrgð á heildinni, og allt á ensku. Svarið okkar:</p>
<blockquote><p>Allt sem vefverslunarkerfi, bókhaldskerfi og vefstofa gera — í einu íslensku kerfi, á einum reikningi, ódýrara en núverandi stafli, og breytingar afgreiddar á dögum.</p></blockquote>
<h2>Söguna í eina mínútu</h2>
<p>Ef þú hefur bara eina mínútu: <em>„Þið eruð sennilega með þrjú, fjögur kerfi og jafn marga reikninga — og þegar ykkur vantar breytingu bíðið þið vikum saman eða borgið tímagjald. Við setjum þetta allt í eitt íslenskt kerfi á föstu mánaðargjaldi, og þegar ykkur vantar breytingu er hún afgreidd á dögum. Sérsniðið kostar áskrift, ekki ráðgjafatíma.“</em></p>
<p>Taktu eftir hverju sagan lofar ekki: engum verðum (þau eru DRÖG þar til Halli staðfestir), engum dagsetningum, engum eiginleikum umfram handbókina. Sagan þarf ekkert af því — hún stendur sjálf.</p>
`,
  },
  {
    slug: 'threpin-thrju',
    section: 'sala',
    sort_order: 1,
    title: 'Þrepin þrjú og hverjum þau henta',
    summary:
      'Vefur (39), Verslun (59) og Rekstur (79) þ.kr./mán — öll verð DRÖG þar til Halli staðfestir. Flöt áskrift, aldrei tímagjald; uppsetningargjald fellur niður með árssamningi. Hér lærirðu að para fyrirtæki við rétt þrep.',
    body: `
<p>Rekstrarkerfið er selt í þremur þjónustuleiðum — þrepum. Þau eru ekki þrjár vörur heldur mismunandi stórir skammtar af sama kerfinu; viðskiptavinur getur alltaf fært sig upp síðar. Nákvæm eiginleikaskipting er í vöruhlutanum (<em>Hvað er í hverju þrepi</em>); hér er sölusjónarhornið.</p>
<h2>Verðin — mikilvægasta reglan fyrst</h2>
<p>Verðin hér að neðan eru <strong>DRÖG — óstaðfest</strong> þar til Halli staðfestir þau. Þau eru ekki birt á orangesmiley.is, svo vísaðu viðskiptavini ekki þangað eftir verði. Í samtali máttu nefna þau sem viðmið, en alltaf með fyrirvara: „endanlegt verð kemur í tilboðinu“. Skriflegt verð kemur aðeins frá Halla.</p>
<h2>Vefur — 39 þ.kr./mán (DRÖG)</h2>
<p><em>Fyrir fyrirtæki sem vilja af Wix eða WordPress.</em></p>
<p>Heimasíða og efnisstjórnun, íslenska og enska, leitarvélabestun og fyrirspurnarform — og breytingabeiðnir afgreiddar á dögum. Hentar þjónustufyrirtækjum, iðnaðarmönnum, félögum og öllum sem vilja trausta heimasíðu án þess að hugsa um tækni. Sölumerki: heimasíðan er gömul, enginn þorir að breyta henni, vefstofan svarar seint eða rukkar tímagjald fyrir hverja smábreytingu.</p>
<h2>Verslun — 59 þ.kr./mán (DRÖG)</h2>
<p><em>Fyrir verslanir sem vilja allt á einum stað.</em></p>
<p>Allt í Vef, plús vörulisti og lagerstaða, karfa, greiðslur og pantanir, aðgangar viðskiptavina, strikamerki og afgreiðslukerfi. Hentar smásölu og heildsölu. Sölumerki: fyrirtækið er með Shopify eða sambærilegt plús mörg viðbótaröpp, lagerstaða í búð og á vef stemmir ekki, gjöldin safnast upp í erlendri mynt.</p>
<h2>Rekstur — 79 þ.kr./mán (DRÖG)</h2>
<p><em>Fyrir rekstur sem vill sleppa Shopify + bókhaldskerfi + vefstofu.</em></p>
<p>Allt í Verslun, plús reikningagerð og VSK, viðskiptamannabókhald og vörumóttaka. Hentar fyrirtækjum sem vilja fækka kerfum niður í eitt — salan og bókhaldshliðin á sama stað. Sölumerki: handavinna við að slá pantanir inn í bókhaldskerfi, reikningar sendir úr öðru kerfi en salan gerist í, „þetta talar ekkert saman“.</p>
<h2>Gjaldareglurnar</h2>
<ul>
<li><strong>Flöt áskrift</strong> — fast mánaðargjald sem innifelur kerfi, hýsingu, vöktun, öryggisuppfærslur og breytingar. <strong>Aldrei tímagjald.</strong></li>
<li><strong>Uppsetningargjald</strong> samkvæmt samkomulagi — <strong>fellur niður með árssamningi</strong>. Það er besta röksemdin fyrir árssamningi og þú mátt alltaf nefna hana.</li>
<li>Sérsniðnar einingar ríða á hvaða þrepi sem er — sérþarfir þvinga engan upp um þrep.</li>
</ul>
<h2>Að velja þrep í samtali</h2>
<p>Einföld regla: <strong>engin vefverslun → Vefur; vefverslun eða búð → Verslun; vill líka losna við sérstakt bókhaldskerfi → Rekstur.</strong> Ef þú ert í vafa, veldu lægra þrepið — það er auðvelt að færa sig upp og enginn upplifir sig plataðan.</p>
`,
  },
  {
    slug: 'fyrsta-samtalid',
    section: 'sala',
    sort_order: 2,
    title: 'Fyrsta samtalið — spurningarnar sem finna þrepið',
    summary:
      'Fyrsta samtalið er könnun, ekki sölutækifæri: spyrðu um núverandi kerfi, vefverslun, hvar bókhaldið er og hvað pirrar mest. Svörin segja þér þrepið og gefa efnið í tilboðið. Þú lofar engu — þú safnar.',
    body: `
<p>Fyrsta samtalið snýst ekki um að sannfæra heldur um að <strong>hlusta og kortleggja</strong>. Ef þú veist í lok samtals hvaða kerfi fyrirtækið notar, hvað þau kosta samtals og hvað pirrar mest, þá tókst samtalið — jafnvel þótt þú hafir varla sagt orð um Rekstrarkerfið.</p>
<h2>Fjórar lykilspurningar</h2>
<ol>
<li><strong>„Hvaða kerfi notið þið í dag?“</strong> — Heimasíða: hver smíðaði hana, hver breytir henni? Vefverslun: hvaða þjónusta, hvaða viðbótaröpp? Bókhald: hvaða kerfi, hver færir það? Skrifaðu allt niður — þessi listi verður samanburðurinn í tilboðinu.</li>
<li><strong>„Eruð þið með vefverslun — eða búð?“</strong> — Svarið sker á milli Vefs og Verslunar. Ef búð: spurðu um afgreiðslukerfið og hvort lagerstaða á vef og í búð stemmi. Ef hvorugt: spurðu hvort netsala sé á dagskrá — þá er vaxtarleiðin hluti af sögunni.</li>
<li><strong>„Hvar er bókhaldið — og hvernig komast sölurnar þangað?“</strong> — Ef svarið felur í sér handavinnu („við sláum þetta inn“) er það sterk vísbending um Rekstrarþrepið. Spurðu líka hver sendir reikninga og úr hvaða kerfi.</li>
<li><strong>„Hvað pirrar ykkur mest í þessu í dag?“</strong> — Mikilvægasta spurningin. Svarið er sölusagan þeirra sjálfra: bið eftir breytingum, óvæntir reikningar, kerfi sem tala ekki saman, allt á ensku. Notaðu þeirra eigin orð í framhaldinu.</li>
</ol>
<h2>Gagnlegar aukaspurningar</h2>
<ul>
<li>„Hvað borgið þið samtals á mánuði fyrir þetta allt — með öppum og þjónustusamningum?“ (Margir vita það ekki. Það er í sjálfu sér sölupunktur.)</li>
<li>„Hvað gerist þegar ykkur vantar breytingu á vefnum? Hve lengi bíðið þið?“</li>
<li>„Ef þið mættuð breyta einu í kerfunum ykkar á morgun — hvað yrði það?“ (Svarið er oft fyrsta sérsniðna einingin þeirra.)</li>
</ul>
<h2>Það sem þú segir — og segir ekki</h2>
<p>Segðu söguna stutt (sjá <em>Sölusöguna</em>): eitt íslenskt kerfi, einn reikningur, breytingar á dögum, sérsniðið kostar áskrift en ekki ráðgjafatíma. Nefndu þrepið sem þér sýnist passa og af hverju. Ef verð ber á góma: viðmiðunarverðin eru drög og endanlegt verð kemur í tilboðinu frá Halla. Lofaðu engri dagsetningu og engum eiginleika sem þú ert ekki viss um — „þetta læt ég tæknifólkið svara, þú heyrir frá okkur innan eins virks dags“ er alltaf gilt svar.</p>
<h2>Lok samtals</h2>
<p>Endaðu alltaf á skýru næsta skrefi: „Ég tek þetta saman og við sendum ykkur tilboð með samanburði við núverandi kostnað — hvaða netfang á það að fara á?“ Skráðu strax: tengilið, netfang, núverandi kerfi, líklegt þrep, helsta pirring og hvað var lofað (sem á bara að vera: tilboð kemur).</p>
`,
  },
  {
    slug: 'motbarur-og-svor',
    section: 'sala',
    sort_order: 3,
    title: 'Mótbárur og svör',
    summary:
      'Fjórar algengustu mótbárurnar og svörin sem standast skoðun: „of dýrt“ (samanburður við staflann), „hvað ef þið hverfið?“ (eilífðarleyfi + flutningsákvæði), „getur gervigreind virkilega...?“ og „við erum með Shopify“. Aldrei svara með loforði sem handbókin styður ekki.',
    body: `
<p>Mótbárur eru ekki höfnun — þær eru spurningar í dulargervi. Hér eru þær fjórar algengustu og svörin sem við stöndum við. Reglan er alltaf sú sama: svaraðu með staðreyndum úr handbókinni, aldrei með loforði sem hún styður ekki.</p>
<h2>„Þetta er of dýrt.“</h2>
<p>Svarið er samanburður, ekki afsláttur. Fáðu viðmælandann til að leggja saman það sem hann borgar í dag: vefverslunarþjónustu í erlendri mynt, viðbótaröpp hvert með sínu mánaðargjaldi, bókhaldskerfi, vefstofu sem rukkar tímagjald fyrir breytingar. Summan kemur flestum á óvart — og hún er án breytinganna, sem hjá okkur eru innifaldar. Bættu svo við: engir tímareikningar, aldrei; og uppsetningargjaldið fellur niður með árssamningi. Ef verðið er samt fyrirstaða: „endanlegt verð kemur í tilboðinu“ — og láttu Halla vita; þú semur aldrei um verð sjálf(ur).</p>
<h2>„Hvað ef þið hverfið? Þið eruð lítið fyrirtæki.“</h2>
<p>Réttmæt spurning og við eigum gott svar — í tveimur hlutum:</p>
<ul>
<li><strong>Eilífðarleyfi:</strong> viðskiptavinurinn fær varanlegt leyfi til að nota sína uppsetningu kerfisins, líka sérsniðnu einingarnar sínar. Kerfið hans slokknar ekki þótt samstarfinu ljúki.</li>
<li><strong>Flutningsákvæði:</strong> hver viðskiptavinur er með sína eigin, aðskildu uppsetningu í skýinu — og samningurinn kveður á um að hún sé flytjanleg til hans að beiðni. Gögnin og kerfið eru ekki í gíslingu.</li>
</ul>
<p>Berðu þetta saman við staflann sem hann er í: hjá erlendri áskriftarþjónustu fær hann ekkert slíkt — hættir hann að borga, hverfur búðin hans.</p>
<h2>„Getur gervigreind virkilega smíðað og viðhaldið kerfi?“</h2>
<p>Svarið hefur þrjá fætur og allir eru sannir:</p>
<ol>
<li><strong>Kjarninn er handsmíðaður og prófaður</strong> — kerfið sem allir keyra er þróað og prófað eins og hver annar vandaður hugbúnaður, með sjálfvirkum prófunum, og er í rekstri hjá alvöru fyrirtækjum, þar á meðal okkur sjálfum.</li>
<li><strong>Gervigreindin sér um sérsníðin — með prófunum.</strong> Sérsniðnar einingar fara í gegnum sömu prófunargáttir og annað; breytingar eru reyndar á okkar eigin kerfum áður en þær ná til viðskiptavina.</li>
<li><strong>Halli ber ábyrgð.</strong> Manneskja samþykkir allt sem fer út. Gervigreindin er verkfærið; ábyrgðin er hjá fyrirtækinu.</li>
</ol>
<h2>„Við erum með Shopify og það virkar ágætlega.“</h2>
<p>Ekki tala Shopify niður — það er ágætt í því sem það gerir. Spurðu frekar: hvað kostar staflinn allur (grunngjald + öpp + greiðslugjöld, í erlendri mynt)? Hver sér um heimasíðuna og bókhaldið — og á hvaða reikningum? Hvað gerist þegar ykkur vantar breytingu sem ekkert app leysir? Okkar saga: allt á einum reikningi, á íslensku, með breytingum á dögum — og fyrsti viðskiptavinurinn okkar er einmitt íslensk heildverslun sem flutti af Shopify yfir á kerfið. (Nefndu engar tölur eða nöfn úr því verkefni — aðeins það sem er birt opinberlega.)</p>
<p>Ef mótbára kemur sem þú kannt ekki svarið við: „Góð spurning — ég ætla að svara henni almennilega frekar en að giska; þú heyrir frá okkur innan eins virks dags.“ Skráðu hana og láttu Halla vita — svörin sem virka fara í handbókina.</p>
`,
  },
  {
    slug: 'tilbodsferlid',
    section: 'sala',
    sort_order: 4,
    title: 'Tilboðsferlið — þú safnar, Halli samþykkir og sendir',
    summary:
      'Þrjú skref: þú safnar upplýsingum um fyrirtækið og staflann þess, tilboð er samið með verðum og samanburði — og Halli samþykkir og sendir ALLTAF. Sölufólk lofar aldrei verði né dagsetningum; allt verð er DRÖG þar til það stendur í sendu tilboði.',
    body: `
<p>Tilboð er formlegasta skjalið í söluferlinu — og þess vegna gildir strangasta reglan um það: <strong>Halli samþykkir og sendir öll tilboð, alltaf, engar undantekningar.</strong> Þitt hlutverk er að leggja til efnið sem gerir tilboðið gott.</p>
<h2>Skref 1: Þú safnar</h2>
<p>Gott tilboð stendur og fellur með upplýsingunum úr fyrsta samtali. Áður en tilboðsvinna hefst þarftu að hafa skráð:</p>
<ul>
<li><strong>Fyrirtækið:</strong> nafn, tengiliður, netfang, sími.</li>
<li><strong>Núverandi stafla:</strong> hvaða kerfi eru í notkun (vefur, vefverslun, öpp, bókhald, vefstofa) og — ef fæst — hvað hvert þeirra kostar á mánuði.</li>
<li><strong>Líklegt þrep:</strong> Vefur, Verslun eða Rekstur, með rökstuðningi í einni setningu.</li>
<li><strong>Helsta pirring:</strong> með orðum viðskiptavinarins sjálfs — það rammar tilboðið inn.</li>
<li><strong>Sérþarfir:</strong> allt sem hljómaði eins og sérsniðin eining („okkur vantar að kerfið geri X“).</li>
</ul>
<h2>Skref 2: Tilboðið er samið</h2>
<p>Tilboðið er samið á íslensku upp úr þínum upplýsingum. Kjarni þess er alltaf sá sami:</p>
<ol>
<li>Þrepið sem er lagt til og hvað er innifalið í því.</li>
<li>Mánaðarverðið og uppsetningargjaldið — þar með talið að uppsetningargjaldið fellur niður með árssamningi.</li>
<li><strong>Samanburður við núverandi stafla:</strong> hvað fyrirtækið borgar í dag á móti einu föstu mánaðargjaldi. Þetta er sterkasta blaðsíðan — og hún er bara jafn góð og upplýsingarnar sem þú safnaðir.</li>
<li>Næstu skref: hvað gerist ef tilboðinu er tekið.</li>
</ol>
<p>Á meðan tilboðið er í vinnslu er það <strong>drög</strong>. Sendu það aldrei sjálf(ur), ekki heldur „bara óformlega í pósti svo þau sjái tölurnar“ — ósamþykkt drög í pósthólfi viðskiptavinar eru loforð sem við höfum ekki gefið.</p>
<h2>Skref 3: Halli samþykkir og sendir</h2>
<p>Halli yfirfer verðin, samanburðinn og öll loforð í textanum — og sendir tilboðið sjálfur. Fyrst þá er verðið raunverulegt. Fram að því svarar þú verð- og tímaspurningum svona: „Það kemur í tilboðinu — þið fáið það fljótlega.“</p>
<h2>Reglurnar í hnotskurn</h2>
<ul>
<li>Þú lofar <strong>engu um verð</strong> — viðmiðunarverðin eru DRÖG þar til þau standa í sendu tilboði.</li>
<li>Þú lofar <strong>engum dagsetningum</strong> — hvorki um afhendingu tilboðs né uppsetningu kerfis.</li>
<li>Þú semur ekki um afslætti. Óski viðskiptavinur eftir öðru verði skráirðu það og lætur Halla vita.</li>
<li>Eftir sendingu fylgirðu tilboðinu eftir með símtali eða pósti — það er aftur þitt hlutverk.</li>
</ul>
`,
  },

  // ── ÞJÓNUSTA ───────────────────────────────────────────────────────────────
  {
    slug: 'breytingabeidnir',
    section: 'thjonusta',
    sort_order: 0,
    title: 'Breytingabeiðnir — flæðið sem er þjónustan',
    summary:
      'Breytingabeiðnin er kjarni þjónustunnar: viðskiptavinur biður um breytingu, beiðnin fer í fast ferli, gervigreind útfærir og Halli ber ábyrgð. Markmiðin: svar innan eins virks dags, smábreytingar innan viku. Þetta flæði er stærsta sölurök vörunnar.',
    body: `
<p>Þegar samningur er kominn í hús hefst raunverulega varan: þjónustan. Og kjarni þjónustunnar er <strong>breytingabeiðnin</strong> — ferlið sem gerir „breytingar á dögum“ að veruleika. Ef þú skilur þetta flæði geturðu bæði selt það og staðið við það.</p>
<h2>Hvað er breytingabeiðni?</h2>
<p>Ósk viðskiptavinar um að kerfið hans geri eitthvað nýtt eða öðruvísi: nýr texti eða síða, breyting á vörulista, ný skýrsla, nýr eiginleiki sem passar hans rekstri. Allt frá smálagfæringu upp í sérsniðna einingu fer í gegnum sama farveginn.</p>
<h2>Flæðið, skref fyrir skref</h2>
<ol>
<li><strong>Viðskiptavinurinn biður um breytinguna í kerfinu sínu</strong> — beiðnin er send inn og skráist í ferli. Berist ósk til þín í síma eða pósti er þitt hlutverk að koma henni inn í sama farveg, ekki að leysa hana sjálf(ur) á staðnum.</li>
<li><strong>Beiðnin er flokkuð</strong> — smábreyting, stærri breyting eða ný sérsniðin eining.</li>
<li><strong>Gervigreindin útfærir</strong> — breytingin er smíðuð með sjálfvirkum prófunum og reynd áður en hún fer á kerfi viðskiptavinarins.</li>
<li><strong>Halli ber ábyrgð</strong> — manneskja stendur á bak við allt sem fer út; gervigreindin er verkfærið.</li>
<li><strong>Viðskiptavinurinn fær svar og sér breytinguna</strong> — í kerfinu sínu, án þess að gera neitt sjálfur.</li>
</ol>
<h2>Markmiðin — og hvernig þú orðar þau</h2>
<ul>
<li><strong>Svar innan eins virks dags</strong> — viðskiptavinurinn heyrir frá okkur, jafnvel þótt svarið sé „þetta er komið í ferli“.</li>
<li><strong>Smábreytingar innan viku.</strong></li>
</ul>
<p>Þetta eru <strong>markmið sem við vinnum eftir</strong> — orðaðu þau þannig. Segðu „svar innan eins virks dags, smábreytingar að jafnaði innan viku“. Segðu aldrei „samdægurs“, „á morgun“ eða annað umfram markmiðin — það er regla (sjá <em>Hvað þú lofar aldrei</em>). Stærri breytingar og sérsniðnar einingar fá tímamat í svari, ekki fyrir fram frá þér.</p>
<h2>Af hverju þetta er sölurök númer eitt</h2>
<p>Berðu flæðið saman við það sem viðskiptavinurinn þekkir: hjá vefstofu kostar breyting tímagjald og bið; hjá stóru kerfi kostar hún ráðgjafa og mánuði; í app-búð vonar hann að eitthvert app leysi málið. Hjá okkur er breytingin <strong>innifalin í áskriftinni</strong> og afgreidd á dögum. Þess vegna segjum við: flæðið er ekki aukaþjónusta við vöruna — <em>flæðið er varan</em>.</p>
<h2>Þitt hlutverk í flæðinu</h2>
<ul>
<li>Kenndu nýjum viðskiptavinum að senda beiðnir inn í kerfið — það er fljótlegasta leiðin fyrir þá.</li>
<li>Taktu við óskum sem berast þér og komdu þeim í farveginn samdægurs; staðfestu við viðskiptavininn að beiðnin sé komin í ferli.</li>
<li>Ef beiðni hljómar eins og stór sérsníðing eða snertir verð — láttu Halla vita um leið.</li>
</ul>
`,
  },
  {
    slug: 'thegar-eitthvad-bilar',
    section: 'thjonusta',
    sort_order: 1,
    title: 'Þegar eitthvað bilar',
    summary:
      'Bilanir koma upp í öllum kerfum — viðbrögðin skilja að góða þjónustu og slæma. Hér er hvernig þú róar viðskiptavininn, hvað þú mátt segja og hvenær þú lætur Halla vita tafarlaust. Aldrei giska á orsök og aldrei lofa viðgerðartíma.',
    body: `
<p>Öll kerfi geta bilað — okkar líka. Það sem sker úr um traust viðskiptavinarins er ekki hvort eitthvað bilar heldur <strong>hvernig við bregðumst við</strong>. Þessi leið segir þér nákvæmlega hvað þú gerir.</p>
<h2>Fyrstu viðbrögð: róa og staðfesta</h2>
<p>Viðskiptavinur sem hringir út af bilun er oft stressaður — verslunin hans er kannski tekjulind heimilisins. Fyrstu setningar skipta öllu:</p>
<ul>
<li>Taktu málið alvarlega strax: „Takk fyrir að láta vita — við tökum þetta strax til skoðunar.“</li>
<li>Fáðu lýsingu og skráðu hana: hvað gerðist, hvenær byrjaði það, hvað var viðkomandi að gera, sést villuboð (fáðu skjámynd ef hægt er)?</li>
<li>Endurtaktu lýsinguna til baka svo viðskiptavinurinn heyri að þú skildir hana rétt.</li>
</ul>
<h2>Hvað þú mátt segja</h2>
<ul>
<li>„Við tökum þetta strax til skoðunar — þú heyrir frá okkur innan eins virks dags.“</li>
<li>„Kerfið þitt og gögnin þín eru á eigin, aðskildri uppsetningu“ — ef áhyggjurnar snúast um gögn.</li>
<li>„Ég ætla ekki að giska á orsökina — ég læt skoða þetta og þú færð rétt svar.“</li>
</ul>
<h2>Hvað þú segir ekki</h2>
<ul>
<li><strong>Enga sjúkdómsgreiningu:</strong> þú veist ekki orsökina og giskanir („þetta er örugglega greiðslufyrirtækið“) koma í bakið á okkur.</li>
<li><strong>Engin tímaloforð um viðgerð:</strong> markmiðin okkar eru svar innan eins virks dags og smálagfæringar innan viku — lofaðu aldrei „þetta verður komið eftir hádegi“.</li>
<li><strong>Ekki gera lítið úr málinu:</strong> „þetta er nú ekkert mál“ hljómar eins og við tökum bilunina ekki alvarlega.</li>
<li><strong>Ekki ræða aðra viðskiptavini</strong> — hvorki hvort sama bilun sé hjá fleirum né neitt annað um kerfi annarra.</li>
</ul>
<h2>Hvenær þú lætur Halla vita STRAX</h2>
<p>Flest mál fara í venjulegan farveg. Þessi fara beint til Halla, um leið og þú heyrir af þeim:</p>
<ol>
<li>Vefur eða vefverslun viðskiptavinar er <strong>alveg niðri</strong>.</li>
<li><strong>Greiðslur virka ekki</strong> — kaupendur komast ekki í gegnum kaup.</li>
<li><strong>Gögn virðast röng eða horfin</strong> — pantanir, reikningar, lagerstaða.</li>
<li>Grunur um <strong>öryggisbrest</strong> — óeðlilegar innskráningar, undarlegir póstar, hvað sem lyktar af innbroti.</li>
<li>Viðskiptavinurinn er <strong>mjög reiður</strong>, hótar uppsögn eða nefnir fjölmiðla eða lögfræðing.</li>
</ol>
<p>Í þessum tilvikum hringirðu — sendir ekki bara skilaboð og vonar það besta. Skráðu svo alltaf: hver hringdi, hvenær, lýsinguna og hvað þú sagðir.</p>
<h2>Eftirfylgni</h2>
<p>Þegar málið er leyst skaltu ganga úr skugga um að viðskiptavinurinn viti það og að hann sé sáttur. Bilun sem er vel leyst — með hraðri viðurkenningu, réttum upplýsingum og eftirfylgni — styrkir sambandið oftar en hún skemmir það.</p>
`,
  },
  {
    slug: 'manadarleg-samskipti',
    section: 'thjonusta',
    sort_order: 2,
    title: 'Mánaðarleg samskipti — staða, afgreiðslur og sambandið',
    summary:
      'Reglubundin samskipti eru ódýrasta vörn gegn uppsögnum: mánaðarlegt stöðuyfirlit um hvað var afgreitt og hvað er á leiðinni, plús persónulegt samband frá þér. Stöðupóstar eru samdir í kerfinu og Halli samþykkir sendingar.',
    body: `
<p>Áskriftarviðskipti lifa á trausti, og traust byggist á reglubundnum samskiptum. Viðskiptavinur sem heyrir aldrei frá okkur man bara eftir gjaldinu sem er dregið mánaðarlega — viðskiptavinur sem fær reglulegt yfirlit sér hvað hann fær fyrir það. Þetta er ódýrasta vörnin gegn uppsögnum.</p>
<h2>Mánaðarlega stöðuyfirlitið</h2>
<p>Hver viðskiptavinur á að fá reglulegt stöðuyfirlit. Kjarninn í því er alltaf sá sami:</p>
<ul>
<li><strong>Hvað var afgreitt:</strong> breytingabeiðnir sem var lokið í mánuðinum — taldar upp með einföldum orðum. Þetta er mikilvægasti hlutinn: hann sýnir svart á hvítu að áskriftin skilar vinnu.</li>
<li><strong>Staða kerfisins:</strong> að kerfið hafi verið uppi og í lagi, og að öryggisuppfærslur hafi borist.</li>
<li><strong>Hvað er á leiðinni:</strong> beiðnir í vinnslu og nýjungar sem allir fá með næstu uppfærslum kjarnans.</li>
</ul>
<p>Yfirlitin eru samin í kerfinu upp úr raunverulegum gögnum — og eins og allt sem fer út til viðskiptavina: <strong>Halli samþykkir sendinguna</strong>. Þitt hlutverk er að láta vita ef eitthvað vantar í yfirlit („þau nefndu X í síma, það þarf að koma fram“) og fylgja því eftir að viðskiptavinurinn hafi séð það.</p>
<h2>Persónulega sambandið — þitt framlag</h2>
<p>Stöðupóstur kemur ekki í staðinn fyrir manneskju. Þitt hlutverk sem tengiliður:</p>
<ul>
<li><strong>Hringdu eða kíktu við reglulega</strong> — stutt samtal: „Hvernig gengur? Er eitthvað sem pirrar í kerfinu?“ Fimm mínútur duga.</li>
<li><strong>Hlustaðu eftir nýjum þörfum.</strong> „Okkur vantar eiginlega...“ er upphaf breytingabeiðni eða sérsniðinnar einingar — komdu því í farveginn. „Við erum að fara að byrja með netsölu“ er merki um að næsta þrep eigi við — skráðu það og láttu Halla vita.</li>
<li><strong>Fangaðu óánægju snemma.</strong> Smápirringur sem enginn spyr um verður að uppsögn. Spurningin „er eitthvað sem mætti vera betra?“ kostar ekkert og bjargar samningum.</li>
</ul>
<h2>Árssamningurinn og endurnýjun</h2>
<p>Munaðu að árssamningur er hagstæðastur fyrir báða: viðskiptavinurinn slapp við uppsetningargjaldið og við fáum fyrirsjáanleika. Þegar líður að endurnýjun áttu að vita stöðuna á sambandinu löngu áður en dagsetningin rennur upp — það er afrakstur mánaðarlegu samtalanna. Öll umræða um verð eða samningskjör við endurnýjun fer til Halla, eins og alltaf.</p>
<h2>Lágmarksvenjan</h2>
<p>Ef þú tekur bara eitt úr þessari leið: <strong>enginn viðskiptavinur á að fara heilan mánuð án þess að heyra frá okkur</strong> — annaðhvort með stöðuyfirliti eða frá þér beint. Skráðu hvert samtal stutt: dagsetning, hvað kom fram, hvað þarf að gera næst.</p>
`,
  },
  {
    slug: 'hvad-thu-lofar-aldrei',
    section: 'thjonusta',
    sort_order: 3,
    title: 'Hvað þú lofar aldrei',
    summary:
      'Stutti listinn sem ver bæði þig og fyrirtækið: aldrei lofa þjónustustigi umfram markmiðin (svar < 1 virkur dagur, smálagfæringar < 1 vika), aldrei verði án samþykkis Halla, aldrei eiginleikum sem eru ekki til og aldrei dagsetningum. Öruggu svörin eru hér líka.',
    body: `
<p>Þessi leið er stutt viljandi — hún er listi sem þú átt að kunna utan að. Allt sem hér stendur gildir alls staðar: í símtali, á fundi, í tölvupósti, á kaffistofunni hjá viðskiptavininum. Loforð sölumanns er loforð fyrirtækisins.</p>
<h2>1. Aldrei þjónustustig umfram markmiðin</h2>
<p>Markmiðin okkar eru tvö og aðeins tvö:</p>
<ul>
<li><strong>Svar innan eins virks dags.</strong></li>
<li><strong>Smálagfæringar innan viku.</strong></li>
</ul>
<p>Þú lofar aldrei neinu umfram þetta. Ekki „samdægurs“, ekki „strax í fyrramálið“, ekki „um helgina ef á þarf að halda“, ekki vöktun allan sólarhringinn. Rangt loforð um viðbragðstíma er versta tegund loforðs: það brestur á versta mögulega tíma — þegar eitthvað er bilað og viðskiptavinurinn telur mínúturnar.</p>
<h2>2. Aldrei verð án samþykkis Halla</h2>
<ul>
<li>Viðmiðunarverðin (39/59/79 þ.kr./mán) eru <strong>DRÖG</strong> þar til Halli staðfestir og máttu aðeins nefnast sem viðmið með þeim fyrirvara.</li>
<li>Þú gefur aldrei afslátt, semur aldrei um verð og staðfestir aldrei endanlegt verð — það stendur í tilboðinu sem Halli sendir.</li>
<li>Sama gildir um uppsetningargjaldið: reglan „fellur niður með árssamningi“ er það eina sem þú mátt fullyrða um það.</li>
</ul>
<h2>3. Aldrei eiginleika sem eru ekki til</h2>
<p>Þú lofar aðeins því sem stendur í handbókinni — sérstaklega leiðinni <em>Hvað er í hverju þrepi</em>. Ef viðskiptavinur spyr „getur kerfið gert X?“ og þú ert ekki viss, er svarið: <em>„Ég ætla að fá staðfest svar við þessu frekar en að giska — þú heyrir frá okkur innan eins virks dags.“</em> Það svar er alltaf rétt og enginn hefur tapað sölu á því. Óskir um nýja eiginleika eru ekki loforð frá þér heldur breytingabeiðni í farveg — og hvort og hvenær hún verður að veruleika kemur í svari úr ferlinu.</p>
<h2>4. Aldrei dagsetningar</h2>
<p>Hvorki um afhendingu tilboðs, uppsetningu kerfis, flutning gagna né afgreiðslu stærri breytinga. Dagsetningar koma í tilboðum og svörum sem Halli hefur samþykkt.</p>
<h2>5. Aldrei um aðra viðskiptavini</h2>
<p>Þú ræðir aldrei kerfi, gögn, verð eða samninga annarra viðskiptavina — og notar aðeins þau dæmi úr verkefnum okkar sem birt eru opinberlega, án talna og nafna umfram það.</p>
<h2>6. Aldrei undirskrift</h2>
<p>Þú skrifar ekki undir neitt fyrir hönd fyrirtækisins. Samningar eru Halla.</p>
<h2>Öruggu setningarnar</h2>
<blockquote><p>„Það kemur í tilboðinu.“ · „Þú heyrir frá okkur innan eins virks dags.“ · „Þetta fæ ég staðfest frekar en að giska.“</p></blockquote>
<p>Þessar þrjár setningar leysa nánast allar aðstæður þar sem freistingin til að lofa er mest. Notaðu þær óspart — þær hljóma fagmannlega af því að þær eru það.</p>
`,
  },

  // ── VARA ───────────────────────────────────────────────────────────────────
  {
    slug: 'hvad-er-i-hverju-threpi',
    section: 'vara',
    sort_order: 0,
    title: 'Hvað er í hverju þrepi — ítarlega',
    summary:
      'Nákvæma eiginleikataflan: hvað öll þrep innihalda, hvað bætist við í Verslun og hvað er aðeins í Rekstri. Þetta er heimildin þegar viðskiptavinur spyr „er X innifalið?“ — lofaðu engu sem er ekki hér.',
    body: `
<p>Þessi leið geymir eiginleikatöfluna fyrir þrepin — hún er heimildin þín þegar viðskiptavinur spyr „er þetta innifalið?“. Ef eiginleiki er ekki hér, þá er hann ekki innifalinn og þú lofar honum ekki (sjá <em>Hvað þú lofar aldrei</em>). Verðin eru DRÖG þar til Halli staðfestir: Vefur 39, Verslun 59, Rekstur 79 þ.kr./mán. Hvert þrep inniheldur allt úr þrepinu á undan.</p>
<h2>Í öllum þrepum (Vefur, Verslun og Rekstur)</h2>
<ul>
<li><strong>Heimasíða og efnisstjórnun</strong> — vefur fyrirtækisins með stjórnborði þar sem viðskiptavinurinn breytir sjálfur texta og myndum, án forritara.</li>
<li><strong>Íslenska og enska</strong> — vefurinn er á báðum tungumálum og gesturinn velur á milli.</li>
<li><strong>Leitarvélabestun og deilikort</strong> — vefurinn er þannig úr garði gerður að Google finni hann, og þegar tengli er deilt á samfélagsmiðlum birtist snyrtilegt kort með mynd og texta.</li>
<li><strong>Fyrirspurnarform og póstsendingar</strong> — gestir senda fyrirspurnir beint af vefnum og þær berast í tölvupósti.</li>
<li><strong>Breytingabeiðnir afgreiddar á dögum</strong> — þjónustuflæðið sjálft (sjá <em>Breytingabeiðnir</em>) er innifalið í öllum þrepum, líka því minnsta. Svar innan eins virks dags, smábreytingar innan viku.</li>
</ul>
<p>Í öllum þrepum er líka innifalið það sem fylgir áskriftinni sjálfri: hýsing í skýinu, vöktun og öryggisuppfærslur — viðskiptavinurinn kaupir aldrei neitt af þessu sérstaklega.</p>
<h2>Bætist við í Verslun (og fylgir Rekstri)</h2>
<ul>
<li><strong>Vörulisti og lagerstaða</strong> — allar vörur á einum stað með myndum, verði og stöðu á lager.</li>
<li><strong>Karfa, greiðslur og pantanir</strong> — kaupandinn setur í körfu, borgar með korti og pöntunin skráist í kerfið; viðskiptavinurinn afgreiðir hana úr stjórnborðinu.</li>
<li><strong>Aðgangar viðskiptavina</strong> — kaupendur geta stofnað aðgang, séð pantanir sínar og verslað hraðar næst; nýtist sérstaklega í heildsölu þar sem sami kaupandi pantar aftur og aftur.</li>
<li><strong>Strikamerki og afgreiðslukerfi</strong> — afgreiðsla í búðinni sjálfri með strikamerkjaskanna, tengd sama vörulista og lager og vefverslunin. Salan í búðinni og salan á vefnum tala saman.</li>
</ul>
<h2>Aðeins í Rekstri</h2>
<ul>
<li><strong>Reikningagerð og VSK</strong> — kerfið býr til reikninga með réttum virðisaukaskatti; salan og reikningarnir verða til á sama stað.</li>
<li><strong>Viðskiptamannabókhald</strong> — yfirlit yfir útgefna reikninga og hverjir skulda hvað; ógreiddar kröfur sjást á einum stað.</li>
<li><strong>Vörumóttaka og birgðir</strong> — sendingar frá birgjum eru skráðar inn á lager í kerfinu, svo birgðastaðan er rétt frá móttöku til sölu.</li>
</ul>
<h2>Þvert á öll þrep</h2>
<ul>
<li><strong>Sérsniðnar einingar</strong> ríða á hvaða þrepi sem er — sérþörf þvingar engan upp um þrep.</li>
<li><strong>Uppsetningargjald</strong> er samkvæmt samkomulagi og <strong>fellur niður með árssamningi</strong>.</li>
<li>Uppfærslur á kjarnanum berast öllum þrepum jafnt — enginn er skilinn eftir á gamalli útgáfu.</li>
</ul>
<p>Munurinn milli þrepa er sem sagt eingöngu <em>hvaða hlutar kerfisins eru opnir</em> — kerfið undir niðri er eitt og hið sama, og uppfærsla milli þrepa er opnun, ekki flutningur.</p>
`,
  },
];

async function seed() {
  let inserted = 0;
  let skipped = 0;

  for (const g of GUIDES) {
    const { rowCount } = await pool.query(
      `INSERT INTO sales_guides (slug, section, sort_order, title, summary, body, published)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       ON CONFLICT (slug) DO NOTHING`,
      [g.slug, g.section, g.sort_order, g.title, g.summary, g.body.trim()]
    );
    if (rowCount === 1) {
      inserted++;
      console.log(`Inserted "${g.slug}" (${g.section})`);
    } else {
      skipped++;
      console.log(`Skipped "${g.slug}" — already exists (never overwritten).`);
    }
  }

  console.log(`Guides: ${inserted} inserted, ${skipped} skipped (of ${GUIDES.length}).`);
  console.log('All inserts are drafts (published = FALSE) — Halli publishes from /admin/handbok.');
}

module.exports = { seedSalesGuides: seed };

// When invoked directly: node server/scripts/seed-sales-guides.js
if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
}

// Sources used for every claim above (Söluþjálfari, 2026-08-27 — all guides DRAFT):
// - company/ORANGE-SMILEY-PLAN.md §1 (tiers/offering, positioning, flat subscription,
//   setup fee waived on annual commitment, DRAFT prices 39/59/79), §3 (perpetual
//   license incl. custom modules), §5.2 (support targets: ack < 1 business day,
//   small fixes < 1 week), §5.4/§5.6 (proposal flow: agents draft, Halli sends;
//   monthly-client-report), Phase 0 §2.7 (transfer-on-request + exit provision).
// - company/REKSTRARKERFI-PLAN.md §2 (positioning vs fit-everyone ERP and vs the
//   Shopify+apps+agency stack), §3 (tier packaging, DRAFT prices), §4 (one core,
//   per-customer instance + own database, repo-per-client isolation), §5/§6
//   (AI ops model, CI gates + canary soak on own instances, Halli approves).
// - the tier copy then on /thjonusta (thjonusta.* keys + ThjonustaView.js
//   FEATURES; removed from the company site 2026-09-13, the matrix now lives
//   on rekstrarkerfi.is) (exact tier rows: featWebsite/featI18n/featSeo/featLeadForm/
//   featSupport = all tiers; featCatalog/featCheckout/featCustomers/featBarcode =
//   Verslun+Rekstur; featInvoicing/featLedger/featReceiving = Rekstur only;
//   thjonusta.draft, setupNote, taglines) and umOkkur.story1–3 (dogfooding,
//   customer #1 = Icelandic wholesale off Shopify — no numbers/names).
// - docs/SALES-STAFF.md (set-password onboarding, /admin/handbok, solufolk role,
//   one-item sidebar, drafts invisible, publishing = approval act).
// - Projects/SALES-LOG.md standing facts (DRAFT prices, SLA ceiling, naming law).
