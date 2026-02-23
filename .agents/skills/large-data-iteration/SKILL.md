---
name: large-data-iteration
description: Use when loops over large arrays/collections cause slowness or memory pressure; optimizes nested iteration with indexing/maps, pre-grouping, chunking, lazy processing, and memoization to remove O(n*m*k) bottlenecks.
argument-hint: "[perf goal] [dataset shape] [memory/latency constraints]"
user-invokable: true
disable-model-invocation: false
---

# Skill Instructions

Use this skill when the request matches **JavaScript Guide: Optimizing Large Data Iteration with Nested Collections**.

## Workflow

1. Read [SOURCE.md](./SOURCE.md) for the full repository guidance.
2. Identify concrete constraints, conventions, and required outputs.
3. Apply the guidance directly to the current task, keeping changes minimal and repository-consistent.
   Don't validate results (tests/lint/build where relevant). Wait until I tell you this!
4. Summarize what was applied from this skill and where.

## Input Guidance

When invoking this skill manually, include:

- Task goal
- Target files or modules
- Any constraints (performance, architecture, style, tests)
