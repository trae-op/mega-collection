# Goal

The goal is to make sure all Git commits in this project are clear, well-structured, and use the **Conventional Commits** standard.

## Main Rules

1.  **Format:** Always use the **Conventional Commits** format: `<type>(<scope>): <short description>`
2.  **Length Limit:** **Keep the first line short (max 50 characters)**. If you need more info, use the message body.
3.  **Language:** The commit message must be in English.
4.  **Test Organization:**
    - **All test files** must be located in a folder named **`__tests__`**.
    - The **folder structure** inside **`__tests__`** must **mirror the structure** of the project folders (e.g., if code is in `src/components/Button.tsx`, the test should be in `src/components/__tests__/Button.test.ts`).

## Types You Must Use

Always use these words to start your commit message:

- **`feat`**: New feature (New thing for the user).
- **`fix`**: Bug fix (Correct an error).
- **`docs`**: Documentation change (Change in README or comments).
- **`refactor`**: Code cleanup (Make the code better, no new features).
- **`test`**: Tests change (Add or fix unit tests).
- **`chore`**: Build change (Update packages or config files).
- **`style`**: Formatting change (Change spaces or semicolons). |

## Using the Body of the Message

- If you need to tell **what** you changed and **why** you did it, add an empty line after the first line and write more details.
- Keep the body lines **short** (max 72 characters).
- Put references to closed issues at the end (for example, `Closes #123`).
