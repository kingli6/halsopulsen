---
name: Published plan sharing
description: The durable boundary and security limitations for personal plan links.
---

Published plans should be immutable snapshots. Each publish creates a new
server-stored version and a new random participant share token; later draft
edits must not change the already shared plan or its history.

**Why:** A participant link needs to work across browsers and devices, while
the owner needs a recoverable history of exactly what was shared.

**How to apply:** Keep the participant route read-only for program structure,
persist participant logs against the shared snapshot, and replace the current
browser-held owner key with real owner authentication before production use.