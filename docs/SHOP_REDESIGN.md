# Shop redesign — multi-section storefront

**Status:** Plan, not yet implemented.
**Owner:** Halli.
**Last updated:** 2026-05-17.

## Goal

Restructure `/shop` from a single flat product grid into three distinct departments — Products, Tech Services, Carpentry — using an Amazon-inspired layout: persistent department tabs, mixed featured landing, per-section pages with their own filters.

## Decisions locked in

| Question | Decision |
|---|---|
| Navigation pattern | Amazon-style top tabs below the global nav |
| How services are sold | Fixed-price packages, Stripe checkout (no quote forms in v1) |
| Data model | Extend the existing `products` table — single table, category column |
| `/shop` default view | Mixed featured landing (curated rows from each section) |

## Information architecture

```
/shop                  Mixed featured landing (default)
/shop/products         Physical goods (apparel today)
/shop/tech             Tech services (advisement, AI teaching, lecturing)
/shop/carpentry        Carpentry (advisement, TV wall artwork)
```

Sub-routes, not query params, so each section is independently linkable, SEO-indexable, and gets its own i18n meta tags.

Department-tab bar sits below the existing top nav (HOME / PROJECTS / SHOP / NEWS / HALLI / CONTACT / PARTY) and is persistent across all four routes. Active tab underlined in the existing gold accent. Tabs: **All · Products · Tech Services · Carpentry**.

## /shop landing layout

Stacked rows, Amazon-homepage feel:

1. **Hero / featured strip** — one or two manually curated items.
2. **"Halli's workshop"** — 3–4 product cards + "See all products →" link.
3. **"Work with Halli — tech"** — 3–4 tech service cards + "See all tech services →".
4. **"Work with Halli — carpentry"** — same shape.

Horizontal scroller on mobile, fixed grid on desktop. Reuse existing product card component. Search/sort/filter bar moves to section pages — landing is for discovery, deep browse happens in sections.

## Section pages

Each section keeps the existing search/sort UI but with section-aware filters:

- **Products:** in-stock toggle, price range (current behavior).
- **Tech services:** duration filter (1h / half-day / full-day), format (remote / in-person / hybrid).
- **Carpentry:** type (consultation vs commissioned work), region.

Filters that don't apply to a section don't render — markup driven by a per-section filter config.

## Data model — migration

Single new sequential migration under `server/scripts/migrations/`. Extends the existing `products` table:

```sql
ALTER TABLE products
  ADD COLUMN category TEXT NOT NULL DEFAULT 'product';
  -- 'product' | 'tech_service' | 'carpentry_service'

ALTER TABLE products
  ADD COLUMN subcategory TEXT;
  -- e.g. 'apparel', 'tv-wall', 'ai-teaching', 'lecture', 'consultation'

ALTER TABLE products
  ADD COLUMN duration_minutes INTEGER;
  -- nullable, services only

ALTER TABLE products
  ADD COLUMN delivery_format TEXT;
  -- 'remote' | 'in_person' | 'hybrid', nullable

ALTER TABLE products
  ADD COLUMN is_bookable BOOLEAN NOT NULL DEFAULT FALSE;
  -- true => triggers post-checkout scheduling

CREATE INDEX products_category_idx ON products (category);
```

Existing apparel rows backfill cleanly with `category = 'product'` and the service fields NULL. No data loss, no API contract rewrite — `GET /api/products?category=tech_service` becomes the section query.

Admin product form: add a category dropdown; show/hide service-specific fields based on selection.

## Cart and checkout

All flows through existing Stripe cart — no second payment system, per CLAUDE.md invariants. Two changes:

- **`is_bookable` items trigger a scheduling step.** v1: confirmation page + email say "Halli will reach out within 24h to schedule." v2 candidate: a "preferred times" textarea at checkout, persisted with the order. Calendly-style live booking deferred.
- **Stock semantics differ for services.** Start with `stock_count = NULL → treated as available`. Add `max_bookings_per_week` only if overbooking becomes a real problem.

## i18n and SEO

- Every new string (section titles, filter labels, row headings, "See all") needs EN + IS entries.
- `npm run check:i18n` before pushing, per CLAUDE.md.
- Each section route gets its own `<title>` and meta description.

## Build order

1. Migration + admin form changes — no UI impact yet, services appear as categorized products.
2. Section sub-routes + department tabs — re-skin of current `/shop`.
3. Per-section filter configs.
4. Landing page mixed-row layout.
5. Booking follow-up flow (scheduling email + admin notification).

Each step ships independently. Stopping after step 3 still yields a functioning multi-section shop.

## Open questions (resolve before/during step 5)

1. **Scheduling UX for services.** "Halli reaches out" email (~1 day of work) vs. preferred-times textarea (~2 days) vs. live calendar (~1 week+). Which level for v1?
2. **Day-one service catalog.** Need concrete SKUs and prices for:
   - Tech advisement (hourly? package?)
   - AI teaching sessions (1h? half-day?)
   - Tech lecturing (per-talk rate?)
   - Carpentry advisement
   - TV wall artwork (likely quote-based — does this need a quote-mode after all?)

Until question 2 is answered, seed data and the duration/format dropdown values are placeholders.
