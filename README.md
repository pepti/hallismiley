# Halli Smiley

Personal portfolio of Halli — an Icelandic carpenter and computer scientist. Showcases twenty years of precision joinery and timber framing alongside full-stack software engineering work.

Live site: **https://halliprojects.is**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 4.18 |
| Database | PostgreSQL 16 |
| Frontend | Vanilla JS SPA (MVC + Component pattern) |
| Auth | RS256 JWT (access + refresh tokens) |
| Deployment | Railway |

---

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- OpenSSL (for generating RSA keys)

---

## Local Setup

**1. Clone and install dependencies**

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/halliprojects.git
cd halliprojects
npm install
```

**2. Configure environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in all values. See [Environment Variables](#environment-variables) below.

**3. Generate RSA keys**

```bash
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

**4. Create the database and run migrations**

```bash
createdb halliprojects        # or create via psql
npm run migrate
```

**5. (Optional) Seed sample data**

```bash
npm run seed
```

**6. Start the development server**

```bash
npm run dev       # nodemon — auto-restarts on changes
# or
npm start         # plain node
```

The app is served at `http://localhost:3000`.

---

## Running Tests

```bash
npm test           # run all tests
npm run test:ci    # CI mode (--runInBand --forceExit)
```

Tests are integration tests and require a running PostgreSQL instance. Configure `DATABASE_URL` in `.env` before running.

---

## Environment Variables

All variables are documented in `.env.example`. Key ones:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `DB_SSL` | Set `true` for hosted PostgreSQL (Railway, Supabase, Render) |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash — generate with `setup-admin.js` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `PRIVATE_KEY` | RS256 private key (newlines as `\n`) |
| `PUBLIC_KEY` | RS256 public key (newlines as `\n`) |

---

## Admin Access

The admin panel (`/admin`) requires a seeded admin account. To create or reset it:

```bash
node server/scripts/setup-admin.js
```

The script prompts for a username and password, hashes the password with bcrypt, and prints the values to add to your `.env`.

---

## Deployment on Railway

1. Push the repo to GitHub.
2. Create a new Railway project and connect the GitHub repo.
3. Add a PostgreSQL plugin — Railway sets `DATABASE_URL` automatically.
4. Set `DB_SSL=true` and all other required environment variables in the Railway dashboard.
5. Railway runs `npm start` by default (configured in `railway.toml`).
6. Run migrations once after first deploy:
   ```bash
   railway run npm run migrate
   ```

---

## Database Backup Strategy

This app relies on Railway's managed PostgreSQL service.

**Automatic backups (Railway):**
- Railway provides automatic daily backups on paid plans. Verify this is enabled in the Railway dashboard under your PostgreSQL plugin settings.
- Retention period depends on your Railway plan (typically 7 days).

**Verifying backups are working:**
1. In the Railway dashboard, open the PostgreSQL plugin.
2. Navigate to **Backups** — confirm recent snapshots are listed.
3. Periodically test a restore to a staging environment to validate backup integrity.

**Manual backup (on-demand):**
```bash
pg_dump "$DATABASE_URL" --no-acl --no-owner -F c -f backup_$(date +%Y%m%d).dump
```

**Restore from dump:**
```bash
pg_restore --clean --no-acl --no-owner -d "$DATABASE_URL" backup_YYYYMMDD.dump
```

---

## Environment-Specific Configuration

| Variable | Development | Staging | Production |
|----------|-------------|---------|------------|
| `NODE_ENV` | `development` | `staging` | `production` |
| `DB_SSL` | `false` (local PG) | `true` (hosted) | `true` (hosted) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | staging URL | `https://halliprojects.is` |
| `SENTRY_DSN` | leave blank | optional | set for error tracking |
| Cookie `secure` flag | off (http ok) | on | on |
| HTTPS redirect | disabled | enabled | enabled |

**Conventions:**
- Never commit `.env` — only `.env.example` is tracked.
- Staging should mirror production env vars as closely as possible.
- Rotate RSA keys (`PRIVATE_KEY`/`PUBLIC_KEY`) independently per environment — never share keys across environments.
- Use `LOG_LEVEL=debug` locally for verbose output; leave unset (defaults to `info`) in production.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 Halli
