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
         (title, slug, summary, body, category, author_id, published, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, title, slug`,
      [
        LAUNCH_ARTICLE.title,
        LAUNCH_ARTICLE.slug,
        LAUNCH_ARTICLE.summary,
        LAUNCH_ARTICLE.body,
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
