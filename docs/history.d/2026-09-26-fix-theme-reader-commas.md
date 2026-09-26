<a id="theme-reader-commas-2026-09-26"></a>
## 2026-09-26 — The theme-token reader reads comma-joined selectors

`tests/themeTokens.js`, the reader behind the theme contrast test (harvest 2
lane 4a), took a rule's selector as one string. A downstream that writes a
shared block for several themes (rekstrarkerfid: its dark themes share one
`html[data-theme="glacier"], html[data-theme="moss"], … { … }` block, and
black-sand is comma-joined too) was read as having no block for those themes,
so the test measured them with the `:root` tokens: 19 failures in rk's sync,
of which 6 were real. A rule now applies to every selector it names. The
engine's own themes are unchanged (38/38).

Review (self, a four-line test-infra change): a selector with a comma inside
parentheses (`:is(a, b)`) would split wrongly; no themes.css in the estate
writes one at the top level of a theme block. Won't fix until one does.
