---
name: typescript
description: Use when creating or refactoring TypeScript code to strict standards; enforces type-first modeling, T-prefixed aliases, explicit return types, safe generics, discriminated unions, and maintainable module-level typings.
argument-hint: "[goal] [ts files] [typing constraints]"
user-invokable: true
disable-model-invocation: false
---

# Skill Instructions

Use this skill when the request matches **TypeScript Best Practices Guide**.

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
