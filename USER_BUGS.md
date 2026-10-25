# User acceptance bugs

## UAT-001 — Missing favicon request returns 404

- **Severity:** Low.
- **Reproduction:** Open `http://localhost:4173/` in a clean browser context and inspect resource responses/console.
- **Expected:** The application should provide its declared site icon without failed resource requests.
- **Actual:** The browser requested `/favicon.ico`, producing 404 console errors (three occurrences across the initial session's navigations).
- **Evidence:** First UAT report console contained three `Failed to load resource ... 404` messages. No page exceptions or failed application API/assets were recorded.
- **Root cause:** `index.html` did not declare an icon and no favicon was served.
- **Fix:** Added `public/favicon.svg` and declared it in `index.html`; rebuilt production assets.
- **Regression coverage:** Fresh-browser Playwright session plus final console/network audit in `scripts/user-acceptance.mjs`; targeted retest also inspected errors.
- **Retest:** PASS. Final UAT browser result reports zero console errors, page exceptions, failed requests, and failed responses.

## Harness findings, not product bugs

The initial broad run had three red checks caused by the acceptance script's own setup: it matched a force slider ambiguously, expected rewind snapshots while the restored clock remained paused, and pressed the `h` shortcut with the range slider still focused. The slider selector was made label-exact; rewind retest explicitly resumed and advanced at 4× before scrubbing; the shortcut retest moved focus to a tool button. Each workflow passed in retest. These are documented to preserve the initial evidence and avoid misclassifying the failures as application defects.

No reproducible critical, high, or medium severity product defects were found during the executed journeys. Untested device/hardware and adversarial boundary cases are listed in `USER_ACCEPTANCE_REPORT.md` and `USER_JOURNEY_MATRIX.md`.
