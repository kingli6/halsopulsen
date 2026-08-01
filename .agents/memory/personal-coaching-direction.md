---
name: Personal coaching direction
description: Product decisions for the HälsoPulsen redesign from group challenges to individual AI-assisted coaching.
---

The first product should be an admin-led personal goal and training dashboard.
The administrator creates or reviews structured programs and publishes a
private dashboard for each person. AI should help interpret natural-language
requests, draft goals and assignments, analyze logs, answer contextual
questions, and propose changes. It should not silently publish important
training changes.

**Why:** Admin-led authoring is easier to validate and safer than autonomous
AI-generated dashboards, while still proving the valuable coaching loop.

**How to apply:** Keep goals, programs, exercises, assignments, conditions,
and logs as structured records. Treat chat as an interface for questions and
proposals, not as the source of truth. Build individual progress before
group/social features.