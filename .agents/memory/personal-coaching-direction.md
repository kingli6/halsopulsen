---
name: Personal coaching direction
description: Product decisions for the HälsoPulsen redesign from group challenges to individual AI-assisted coaching.
---

The first product should be a simple personal goal and training dashboard.
The initial implementation should be AI-free: the person uses a structured
program, logs actual work, sees progress, and exports clean CSV or copyable
summary data to any external AI tool. The longer-term product can add an
admin-led workflow where the administrator creates or reviews structured
programs and publishes a private dashboard for each person. AI can eventually
draft goals and assignments, analyze logs, answer contextual questions, and
propose changes, but it should not silently publish important training changes.

**Why:** A reliable data and reflection loop is easier to validate than an
AI-first product, and external analysis lets the experiment prove value before
adding API cost, complexity, or autonomous behavior.

**How to apply:** Keep goals, programs, exercises, assignments, conditions,
and logs as structured records. Keep recommended days flexible: users can move
unfinished work and the app preserves both the recommended and actual dates.
Build individual progress before group/social features or embedded AI.