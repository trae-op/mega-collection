# Contributing to @devisfuture/mega-collection

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/mega-collection.git`
3. Create a feature branch: `git checkout -b feat/my-feature`
4. Make your changes
5. Push and open a Pull Request

## Development Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Type-check without emitting
npm run typecheck

# Watch mode for development
npm run dev
```

The package is organised into three independent modules (`search`, `filter`, `sort`) plus a lightweight `merge` wrapper that composes them around a shared dataset. Each engine can be imported individually for optimal tree‑shaking:

```ts
// Full package (includes MergeEngines facade)
import { MegaCollection, MergeEngines } from "@devisfuture/mega-collection";

// Individual modules
import { TextSearchEngine } from "@devisfuture/mega-collection/search";
import { FilterEngine } from "@devisfuture/mega-collection/filter";
import { SortEngine } from "@devisfuture/mega-collection/sort";
```

## Making Changes

### Adding a New Feature

1. Decide which module the feature belongs to (`search`, `filter`, `sort`, `merge`, or the core facade).
2. Write the implementation in the appropriate module directory.
3. Export it from the module's `index.ts` barrel file.
4. If it's a public API, also export from `src/index.ts` and, when applicable, from `merge/index.ts`.
5. Update types in `src/types.ts` if necessary.
6. Update the README with usage examples — include Quick Start snippets for the single-engine and `MergeEngines` workflows.

### Performance Considerations

This library is designed for **50k+** item collections. When contributing, please:

- Prefer `for` loops over `.forEach()` / `.map()` / `.filter()` in hot paths.
- Use typed arrays (`Float64Array`, `Uint32Array`) where appropriate for numeric data.
- Avoid creating closures in tight loops.
- Use `Map` / `Set` instead of plain objects for dynamic key collections.
- Benchmark your changes against the existing implementation with large datasets.

## Pull Request Process

1. Ensure your code compiles without errors: `npm run typecheck`
2. Ensure the build succeeds: `npm run build`
3. Update documentation if you changed any public API.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages:
   - `feat:` — new feature
   - `fix:` — bug fix
   - `perf:` — performance improvement
   - `docs:` — documentation only
   - `refactor:` — code change that neither fixes a bug nor adds a feature
   - `chore:` — build process or auxiliary tool changes
5. Open a Pull Request with a clear description of what and why.

## Coding Guidelines

- **TypeScript**: All code must be written in TypeScript with strict mode enabled.
- **No runtime dependencies**: This package has zero runtime dependencies. Keep it that way.
- **Generics**: Use `T extends CollectionItem` for all public APIs that operate on collection items.
- **JSDoc**: Document all public classes, methods, and interfaces with JSDoc comments.
- **Naming**:
  - Classes: `PascalCase` (e.g., `SortEngine`)
  - Methods/functions: `camelCase` (e.g., `buildIndex`)
  - Types/interfaces: `PascalCase` (e.g., `FilterCriterion`)
  - Constants: `UPPER_SNAKE_CASE`
- **No `any` in public APIs**: Use proper generics and type constraints.
- **Exports**: Every module has a barrel `index.ts` that re-exports only the public API.
