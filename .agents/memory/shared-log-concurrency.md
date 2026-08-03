---
name: Shared log concurrency
description: The consistency rule for participant saves on shared training-plan links.
---

Shared participant state is an optimistic-concurrency document. Every save must include the revision the participant loaded and a request ID; the server advances the revision only for an accepted request, treats a repeated request ID as already applied, and rejects stale revisions.

**Why:** A shared link can be open in multiple tabs or devices. Blindly replacing the full assignments/logs snapshot can silently erase a newer session, move, or skip action.

**How to apply:** Keep the participant UI read-only after a conflict and offer an explicit reload. Serialize saves within one tab, do not save immediately after loading, and preserve backward compatibility by treating missing legacy revisions as zero.