/**
 * seed-news.js — Seeds the first news article: the site launch story.
 *
 * Safe to re-run: uses ON CONFLICT DO NOTHING on the unique slug.
 * Run after migrations: node server/scripts/seed-news.js
 */
require('dotenv').config();

const db = require('../config/database');

const LAUNCH_ARTICLE = {
  title:    "We're Live! Welcome to Halli Smiley",
  slug:     'were-live-welcome',
  category: 'announcement',
  summary:  "After months of building, the portfolio is finally live. Here's the story behind it — what it is, how it's built, and what's coming next.",
  body: `<p>Right. So it's actually live. I keep refreshing the page half-expecting it to explode, but somehow it just... works. Welcome to <strong>Halli Smiley</strong> — my little corner of the internet where carpentry meets code and both get taken equally seriously.</p>

<h2>Why a Portfolio Site?</h2>

<p>Honestly? I got tired of explaining what I do at dinner parties. "So you're a carpenter?" Yes. "But you also write software?" Also yes. "At the same time?" Kind of. The confusion was real. So I built this thing partly to showcase the work and partly so I can hand people a URL and walk away.</p>

<p>I've been doing carpentry for over twenty years — hand tools, power tools, joinery, timber framing, the lot. And somewhere along the way I got seriously into programming. Not because I had to, but because the problem-solving itch is the same. Fitting a mortise-and-tenon joint that closes without force, or debugging a session management edge case that only triggers under specific race conditions — same brain, different materials.</p>

<h2>How It's Built</h2>

<p>This site is <strong>Node.js on the backend, vanilla JavaScript on the frontend</strong>. No React. No Next.js. No framework making decisions for me. Just a router I wrote myself, views that render to the DOM the old-fashioned way, and a PostgreSQL database doing exactly what databases are supposed to do.</p>

<p>The authentication is Lucia v3 with session cookies — proper httpOnly, SameSite, the works. There's a full CSRF protection layer, rate limiting, input sanitization, Prometheus metrics, structured logging with Pino, and a circuit breaker on the database connection. I may have gone slightly overboard on the observability for a portfolio site. I regret nothing.</p>

<p>The frontend is a single-page app with hash-based routing. It loads fast, works without JavaScript for the static bits, and the CSS is hand-written with CSS variables for a design system that doesn't fight me. The dark theme is intentional — I spend most of my day in sawdust or terminal windows, and both look better in dark mode.</p>

<h2>What's On Here</h2>

<p>A few things worth knowing about:</p>

<ul>
  <li><strong>Project Gallery</strong> — Both carpentry and tech projects in one place. Filter by discipline. Each project has its own page with photos, tools used, and the story behind it.</li>
  <li><strong>User Accounts</strong> — You can create an account, pick an avatar, and save favourite projects. Accounts are real — email verification, password reset, the full thing.</li>
  <li><strong>The Party Page</strong> — I'm turning 40 this year. There's a birthday party, and I built a whole invite and RSVP system for it. Because of course I did.</li>
  <li><strong>This News Feed</strong> — Where I'll post about projects as they happen, write-ups on techniques, and the occasional rant about wood movement or JavaScript quirks.</li>
</ul>

<h2>The First Real Project: Stofan Bakhús</h2>

<p>The first carpentry project up on the site is <strong>Stofan Bakhús</strong> — a living-room-to-garden outbuilding conversion I did a few years back. It's the project I'm most proud of from that era: proper timber frame, hand-cut joints, built to last decades. The photos don't do it justice but they're the best I've got.</p>

<p>More projects are coming. I've got a backlog of work to document — both carpentry and code — and I'll be adding them as I find time between the actual work.</p>

<h2>What's Next</h2>

<p>Short term: more projects, more write-ups, a proper about page. Medium term: I want to add a comments system and maybe some kind of workshop log where I track active builds in real time. Long term: who knows. The site is a living thing and I'll build it like I build furniture — one piece at a time, fitted properly before moving on.</p>

<p>If you made it this far: thanks for reading. Create an account if you want to follow along, or just poke around the projects. Either way, I'm glad you're here.</p>

<p>— Halli</p>`,

  // Icelandic sibling fields (migration 031). Same conversational voice as the
  // English original — Halli's first-person tone translated faithfully rather
  // than corporate-polished.
  title_is:   "Við erum í loftinu! Velkomin á Halli Smiley",
  summary_is: "Eftir margra mánaða vinnu er síðan loks í loftinu. Hér er sagan á bak við hana — hvað þetta er, hvernig hún er byggð og hvað kemur næst.",
  body_is: `<p>Jæja. Þetta er sem sagt komið í loftið. Ég held áfram að ýta á refresh í þeirri von að sjá hana springa, en einhvern veginn... virkar þetta bara. Velkomin á <strong>Halli Smiley</strong> — minn litla kima á netinu þar sem smíði mætir kóða og hvort tveggja er tekið jafn alvarlega.</p>

<h2>Af hverju vefsíða með verkefnasafni?</h2>

<p>Í hreinskilni sagt? Ég var orðinn þreyttur á því að útskýra hvað ég geri í matarboðum. „Þú ert sem sagt smiður?" Já. „En þú skrifar líka hugbúnað?" Já líka. „Samtímis?" Svona hálfpartinn. Ruglingurinn var raunverulegur. Svo ég bjó til þetta apparat bæði til að sýna vinnuna og til að geta rétt fólki slóð og labbað í burtu.</p>

<p>Ég hef verið í smíðum í yfir tuttugu ár — handverkfæri, rafmagnsverkfæri, fellingar, grindarsmíði, allt það. Og einhvern tímann á leiðinni datt ég af alvöru í forritun. Ekki af því að ég þyrfti þess, heldur af því að kitlið við að leysa vandamál er það sama. Að fella sinklagið svo skápurinn lokist án átaks, eða að finna villu í setustjórnun sem kemur aðeins fram undir tilteknum keppnisskilyrðum — sami heilinn, önnur efni.</p>

<h2>Hvernig hún er byggð</h2>

<p>Þessi síða er <strong>Node.js á bakendanum og hrein JavaScript á framendanum</strong>. Enginn React. Ekkert Next.js. Enginn rammi að taka ákvarðanir fyrir mig. Bara leiðarvísir sem ég skrifaði sjálfur, viðmót sem teiknar sig upp á gamla mátann, og PostgreSQL-gagnagrunnur sem gerir nákvæmlega það sem gagnagrunnar eiga að gera.</p>

<p>Auðkenningin er Lucia v3 með setu-kökum — rétta leiðin með httpOnly, SameSite, allt það. Svo er full CSRF-vörn, hraðatakmörkun, hreinsun á innsendum gögnum, Prometheus-mælingar, formfastir loggar með Pino, og straumrof á gagnagrunnstengingunni. Ég viðurkenni að ég gæti hafa farið örlítið yfir strikið með vöktuninni á vefsíðu fyrir verkefnasafn. Ég sé ekkert eftir því.</p>

<p>Framendinn er eitt-síðu vefforrit með slóðasjá á viðskiptavinahlið. Hann hleðst hratt, virkar án JavaScript fyrir kyrrstæða hlutann, og CSS-ið er handskrifað með CSS-breytum fyrir hönnunarkerfi sem þvælist ekki fyrir mér. Dökka þemað er meðvituð ákvörðun — ég eyði flestum deginum annaðhvort í tréspæni eða skipanalínugluggum, og hvort tveggja kemur betur út í myrkri.</p>

<h2>Hvað er hér að finna</h2>

<p>Nokkrir punktar sem vert er að nefna:</p>

<ul>
  <li><strong>Verkefnasafn</strong> — Bæði smíða- og tækniverkefni á einum stað. Síað eftir grein. Hvert verkefni á sína eigin síðu með myndum, notuðum verkfærum og sögunni á bak við.</li>
  <li><strong>Notendaaðgangar</strong> — Þú getur búið til aðgang, valið mynd og vistað uppáhaldsverkefni. Aðgangarnir eru alvöru — netfangsstaðfesting, lykilorðsendurstilling, heili pakkinn.</li>
  <li><strong>Veislusíðan</strong> — Ég verð 40 ára í ár. Það verður afmælisveisla, og ég smíðaði heilt boðskorta- og skráningarkerfi fyrir hana. Auðvitað gerði ég það.</li>
  <li><strong>Þessi fréttaveita</strong> — Hér mun ég birta greinar um verkefni á meðan þau eru í vinnslu, skrif um tækni, og endrum og eins tuða yfir hreyfingum í viði eða sérkennum JavaScript.</li>
</ul>

<h2>Fyrsta alvöru verkefnið: Stofan Bakhús</h2>

<p>Fyrsta smíðaverkefnið á síðunni er <strong>Stofan Bakhús</strong> — umbreyting á útihúsi í stofu með útsýn í garðinn, sem ég vann fyrir nokkrum árum. Þetta er verkefnið sem ég er hvað stoltastur af frá þeim tíma: almennileg timburgrind, handsmíðaðar fellingar, byggt til að endast áratugum saman. Myndirnar skila þessu ekki nógu vel en þær eru það besta sem ég á.</p>

<p>Fleiri verkefni eru á leiðinni. Ég á nóg af verkum í bakka sem ég þarf að skjalfesta — bæði smíðaverkefni og hugbúnaðarverkefni — og ég bæti þeim við þegar ég finn tíma á milli raunverulegu vinnunnar.</p>

<h2>Hvað kemur næst</h2>

<p>Til skamms tíma: fleiri verkefni, fleiri skrif, almennileg Um mig-síða. Til miðlungs langs tíma: mig langar að bæta við athugasemdakerfi og kannski einhvers konar verkstæðisdagbók þar sem ég fylgist með virkum verkefnum í rauntíma. Til langs tíma: hver veit. Síðan er lifandi fyrirbæri og ég bý hana til eins og ég smíða húsgögn — einn hlut í einu, rétt felldan áður en haldið er áfram.</p>

<p>Ef þú komst alla leið hingað: takk fyrir lesturinn. Búðu þér til aðgang ef þú vilt fylgjast með, eða flettu bara í verkefnunum. Annaðhvort er, þá er ég glaður að þú sért hér.</p>

<p>— Halli</p>`,
};

async function seedNews() {
  try {
    // Find the first admin user to set as author
    const { rows: admins } = await db.query(
      "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    );
    const authorId = admins[0]?.id || null;

    const { rows } = await db.query(
      `INSERT INTO news_articles
         (title, slug, summary, body, title_is, summary_is, body_is,
          category, author_id, published, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
       ON CONFLICT (slug) DO UPDATE
         SET title_is   = COALESCE(news_articles.title_is,   EXCLUDED.title_is),
             summary_is = COALESCE(news_articles.summary_is, EXCLUDED.summary_is),
             body_is    = COALESCE(news_articles.body_is,    EXCLUDED.body_is)
       RETURNING id, title, slug`,
      [
        LAUNCH_ARTICLE.title,
        LAUNCH_ARTICLE.slug,
        LAUNCH_ARTICLE.summary,
        LAUNCH_ARTICLE.body,
        LAUNCH_ARTICLE.title_is,
        LAUNCH_ARTICLE.summary_is,
        LAUNCH_ARTICLE.body_is,
        LAUNCH_ARTICLE.category,
        authorId,
      ]
    );

    if (rows[0]) {
      console.log(`✓ Seeded article: "${rows[0].title}" (slug: ${rows[0].slug})`);
    } else {
      console.log('Article already exists — skipped.');
    }
  } catch (err) {
    console.error('Failed to seed news:', err.message);
    throw err;
  }
}

module.exports = { seedNews };

// When invoked directly: node server/scripts/seed-news.js
if (require.main === module) {
  seedNews()
    .then(() => db.pool.end())
    .catch(err => { console.error('Seed failed:', err.message); db.pool.end(); process.exit(1); });
}
