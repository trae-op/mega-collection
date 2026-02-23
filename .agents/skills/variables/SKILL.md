---
name: variables
description: "Use when working with JavaScript/TypeScript variable quality and style: choosing const vs let, removing var, renaming unclear variables, boolean/array/function naming, initialization defaults, scope and block-scope fixes, destructuring and aliasing, loop variable naming, extracting intermediate variables, replacing magic numbers/strings with constants, null/undefined handling (optional chaining and nullish coalescing), and refactoring code to follow consistent variable conventions."
argument-hint: "[task goal] [target files/modules] [naming/scope/style constraints]"
user-invokable: true
disable-model-invocation: false
---

# Skill Instructions

Use this skill when the request matches **JavaScript Variables — Instruction for AI Agents**.

## Workflow

1. Read [SOURCE.md](./SOURCE.md) for the full repository guidance.
2. Identify concrete variable-related violations and required outputs.
3. Apply the guidance directly to the current task, keeping changes minimal and repository-consistent.
   Don't validate results (tests/lint/build where relevant). Wait until I tell you this!
4. Summarize what was applied from this skill and where.

## Input Guidance

When invoking this skill manually, include:

- Task goal
- Target files or modules
- Any constraints (style, readability, architecture, tests)
