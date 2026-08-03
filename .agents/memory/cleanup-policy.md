---
name: Cleanup policy
description: How to distinguish safe dead-code cleanup from intentional compatibility and reference material.
---

Remove code, styles, and assets only when repository-wide references show they are not used by a live page, route, or documented workflow.

**Why:** The project intentionally preserves old participant URLs, data migrations, internal demos, and reference material while the product is being redesigned. Deleting those based only on naming or age can break existing links or future maintenance.

**How to apply:** During cleanup audits, verify route targets and exact references first. Prefer removing isolated no-reference helpers, selectors, and assets; leave migrations, legacy redirects, sample-plan routes, internal pitch material, and screenshots unless the owner explicitly retires them.