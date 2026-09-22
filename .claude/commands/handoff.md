---
description: Generate the customer handoff packet (deploy steps, admin guide, what-changed) as a polished document
---

Produce a customer-facing handoff packet under `docs/handoff/`. Use the `docx` and/or `pdf` skill for the final polished file. Write only inside `docs/handoff/`.

1. **Deploy + run steps:** from the base's `RUNBOOK.md` / `Dockerfile` / deploy config and this project's `.env.example`, write how to run and deploy the site — env vars needed, DB setup, `npm run migrate`, start command. Record the base SHA so they know the engine version.
2. **Admin guide:** walk the admin surface this customer actually kept after `/strip-base` (products, orders, discounts, collections, roles, bins, customers, analytics — whichever survived). One short "how to do X" per common task: add a product, fulfil an order, create a discount, add a staff role.
3. **What changed vs the old site:** from `docs/frontend-audit.md` + `PLAN.md`, a plain-language list of what's new or better than the customer's previous site (faster, reorder, running totals, online payment, etc.).
4. **Render the deliverable:** invoke the `docx` skill (or `pdf`) to produce `docs/handoff/<name>-handoff.docx`. Keep it non-technical and skimmable.
