---
name: Lean production architecture
description: The agreed hosting and sequencing decision for the personal training service.
---

Use GitHub/GitHub Pages for the frontend and small public assets, Supabase for
private structured data and access control, and Gemini only for optional
server-side coaching features. Keep the current Express/local JSON prototype
until the product loop is stable, then migrate deliberately.

**Why:** The initial users and files do not justify a home file server or a
large security system, while public static hosting still needs a real backend
for persistence, authentication, and access rules.

**How to apply:** Add practical request limits and validation now. Design
Supabase Auth/RLS before GitHub Pages production. Never make the core tracker
depend on Gemini, and do not expose a Gemini key in browser code. Revisit
personal-computer storage only if large-file cost or capacity becomes a real
constraint.

The local JSON participant-state store is a single-process prototype boundary;
its optimistic revision checks do not make a multi-instance read/modify/write
cycle transactional.

**Why:** Two app instances can both accept the same revision and the later
whole-file write can erase the other instance's accepted participant changes.

**How to apply:** Keep the documented boundary while prototyping, and move
shared state to a transactional store or serialized single-writer design
before scaling the app horizontally.