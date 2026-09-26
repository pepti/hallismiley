<a id="fix-roles-phone-overflow-2026-09-26"></a>
## 2026-09-26 — Roles page on a phone: the title row wraps instead of scrolling sideways

**What broke.** CI failed on master after harvest 2 lane 3 merged
(`e2e/admin-roles-grid.spec.js`, "Roles grid on a phone"): at 375px the page
scrolled sideways by 1px. Locally it passed. The cause was the shared
`.disc-head` title row (`public/css/admin-discounts.css`), a flex row that
never wrapped: the "Nýtt hlutverk" button stuck 8.5px out of the page into the
shell's side padding. On Windows that still fit inside the viewport; with CI's
Linux text rendering it crossed the edge.

**Fix.** `.disc-head` wraps (`flex-wrap: wrap`, children `min-width: 0`), so a
title's action button drops under the title on a narrow screen. The discounts
and Collections pages share the row (one `h1` + one primary button each) and get the same behaviour.

**Test.** The phone spec now measures against `clientWidth` (as
`admin-home.spec.js` does) and also asserts that nothing inside `.admin-page`
reaches past the page's own right edge. That second check fails locally too
(it named `button#role-new` before the fix), so this class of bug no longer
depends on the CI font stack to show up.

Follows [harvest2-lane3-2026-09-26](2026-09-26-harvest2-lane3-users.md#harvest2-lane3-2026-09-26).
