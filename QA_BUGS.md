# QA bugs

## QA-001 — Body renderer cache reused for another body kind

- **Severity:** High
- **Reproduction:** Load Prime Field, Total Chaos, Binary Dance, and Stellar Collapse in rapid succession; repeat the sequence. A failure was also observed during the twelve-switch browser stress check.
- **Expected:** Every body renders according to its current kind after each world transition.
- **Actual:** Renderer threw `TypeError: Cannot set properties of undefined (setting 'value')` from `syncBodies`; the render loop stopped updating.
- **Root cause:** Cached Three.js `BodyView` entries were keyed by entity ID only, while scenario loads reuse IDs for different kinds. The stale shader/material layout could lack uniforms required by the replacement kind.
- **Fix:** Store `kind` in `BodyView`; dispose and recreate a cached view when the current body's kind differs, in both `refreshBodies` and `syncBodies`.
- **Regression:** `scripts/qa-smoke.mjs` repeatedly changes worlds and then asserts no page exceptions, console errors, or failed requests.
- **Retest:** Pass after fix; twelve rapid switches and all seven additional browser checks passed.

## QA-002 — Import smoke check read an unrelated newest toast

- **Severity:** Low (test harness; no app defect demonstrated)
- **Reproduction:** Run the supplied smoke suite while a discovery notification can occur immediately after import. The test waited for the import event, then inspected only `.toast`.last().
- **Expected:** Assert the import confirmation exists among active notifications and verify the imported state.
- **Actual:** The latest toast could be `Discovery: Gravitational slingshot`, producing a false failure even though the import event had occurred.
- **Root cause:** Toast order is time-dependent; unrelated notifications share the same toast region.
- **Fix:** Search all currently active toast messages for the expected import confirmation. Existing state checks continue to validate the imported experiment.
- **Regression:** Run `npm run smoke` against port 4173.
- **Retest:** Pass, 17 checks passed and 0 failed.
