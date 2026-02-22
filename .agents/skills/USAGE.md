# Як використовувати Agent Skills у `.agents/skills/`

Цей файл пояснює, як працювати зі скілами, які були згеновані з `docs/*.md`.

## Що вже зроблено

- Для кожного `docs/*.md` створено окремий skill у `.agents/skills/<skill-id>/`.
- У кожному skill є:
  - `SKILL.md` — метадані (`name`, `description`) + інструкції використання.
  - `SOURCE.md` — оригінальний зміст документа з `docs/`.
- Загальний індекс відповідностей: `.agents/skills/INDEX.md`.

## Як Copilot використовує skills

1. **Discovery (рівень 1):** читає тільки `name` і `description` з `SKILL.md`.
2. **Instructions (рівень 2):** якщо skill релевантний задачі, підвантажує тіло `SKILL.md`.
3. **Resources (рівень 3):** за потреби читає `SOURCE.md` та інші файли skill-папки.

Це означає, що можна мати багато skill-ів без перевантаження контексту.

## Premium тюнінг (вже застосовано)

У всіх `SKILL.md` виконано тюнінг метаданих:

- `description` — короткий, task-oriented, з акцентом **коли саме** skill вмикати.
- `argument-hint` — спеціалізований під домен skill-а (а не загальний шаблон).
- `user-invokable: true` — skill явно доступний як slash-команда.
- `disable-model-invocation: false` — skill може підключатися автоматично, якщо релевантний.

Практичний ефект:

- кращий auto-match skill-ів на запит,
- зрозуміліші підказки в `/`-меню,
- менше випадків, коли агент підтягує «не той» skill.

## Ручний виклик skill-ів

1. У Copilot Chat введіть `/` і виберіть потрібний skill.
2. Або введіть команду напряму, наприклад:

```text
/react optimize rerenders in TopPanel and move logic into hooks
```

Рекомендований формат аргументів після slash-команди:

```text
/<skill-id> [goal] [target files/modules] [constraints]
```

Після premium-тюнінгу краще використовувати предметні аргументи з `argument-hint`, наприклад:

```text
/ipc-communication add channel dictionaries:sync types/invokes.d.ts src/main/dictionaries/ipc.ts strict payload types
```

```text
/tailwind-css refactor TopPanel responsive spacing src/renderer/windows/home/TopPanel.tsx dark mode + focus states
```

Приклад:

```text
/typescript refactor renderer hooks to strict types in src/renderer/conceptions/User
```

## Автоматичне застосування (без slash)

Якщо ваш запит явно описує тему skill-а (наприклад, IPC, Tailwind, архітектура main process), Copilot може сам підключити релевантний skill.

## Мапа: docs → skills + приклади

| Документація (`docs/*md`)                   | Skill                                | Приклад виклику                                                                         |
| ------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `docs/react.md`                             | `/react`                             | `/react split large component into memoized subcomponents + hooks`                      |
| `docs/typescript.md`                        | `/typescript`                        | `/typescript enforce T-prefixed types and replace interface with type`                  |
| `docs/javascript.md`                        | `/javascript`                        | `/javascript refactor utility module to modern JS best practices`                       |
| `docs/tailwind-css.md`                      | `/tailwind-css`                      | `/tailwind-css clean up class composition in src/renderer/components/Button`            |
| `docs/clsx-tailwind.md`                     | `/clsx-tailwind`                     | `/clsx-tailwind normalize conditional classes with clsx in AvatarButton`                |
| `docs/react-lazy.md`                        | `/react-lazy`                        | `/react-lazy lazy-load heavy window component with suspense fallback`                   |
| `docs/lazy-render.md`                       | `/lazy-render`                       | `/lazy-render virtualize long dictionary word list in renderer`                         |
| `docs/event-delegation-guide.md`            | `/event-delegation-guide`            | `/event-delegation-guide replace per-item handlers with delegated click handling`       |
| `docs/react-form-instructions.md`           | `/react-form-instructions`           | `/react-form-instructions refactor sign-in form to field components and useActionState` |
| `docs/ipc-communication.md`                 | `/ipc-communication`                 | `/ipc-communication add new invoke channel for groups:getAll with typed payload`        |
| `docs/renderer-process-architecture.md`     | `/renderer-process-architecture`     | `/renderer-process-architecture create new conception module for Dictionaries`          |
| `docs/renderer-process-unit-tests.md`       | `/renderer-process-unit-tests`       | `/renderer-process-unit-tests add tests for UserPopover actions`                        |
| `docs/main-process-modular-architecture.md` | `/main-process-modular-architecture` | `/main-process-modular-architecture scaffold new main module with service+ipc`          |
| `devisfuture_electron-modular.md`           | `/electron-modular`                  | `/electron-modular add lazy analytics module with typed trigger and window manager`     |
| `docs/main-process-modular-unit-tests.md`   | `/main-process-modular-unit-tests`   | `/main-process-modular-unit-tests add vitest tests for auth service`                    |
| `docs/electron-path-aliasing.md`            | `/electron-path-aliasing`            | `/electron-path-aliasing migrate relative imports to #main/#shared aliases`             |
| `docs/lucide-react.md`                      | `/lucide-react`                      | `/lucide-react replace custom svg icons with lucide-react icons`                        |
| `docs/large-data-iteration.md`              | `/large-data-iteration`              | `/large-data-iteration optimize nested loops in dictionaries aggregation`               |
| `docs/PERFORMANCE_MONITORING.md`            | `/performance-monitoring`            | `/performance-monitoring add timing instrumentation around words fetch`                 |
| `docs/rest-api.md`                          | `/rest-api`                          | `/rest-api implement dictionary words add/remove endpoints in renderer API layer`       |
| `docs/git-commit-instructions.md`           | `/git-commit-instructions`           | `/git-commit-instructions generate commit message from changed files`                   |
| `docs/сontext-pattern.md`                   | `/context-pattern`                   | `/context-pattern build subscription-based context selectors for updater state`         |

## Комбінування skill-ів

Можна поєднувати кілька skill-ів в одному запиті:

```text
/renderer-process-architecture /typescript create Dictionaries conception with strict typed selectors
```

```text
/ipc-communication /main-process-modular-architecture add IPC flow for dictionaries sync
```

## Як додати новий skill з нового документа

1. Додайте новий `docs/<topic>.md`.
2. Створіть `.agents/skills/<topic>/SKILL.md` з YAML frontmatter:

```md
---
name: topic
description: What this skill does and when to use it
---

# Skill Instructions

...
```

3. Додайте `SOURCE.md` (або інші ресурси) у цю ж папку.
4. За потреби внесіть skill в `.agents/skills/INDEX.md`.

## Корисно

- Відкрити список навичок швидко: введіть `/skills` у чаті.
- Базовий індекс існуючих skill-ів: `.agents/skills/INDEX.md`.
