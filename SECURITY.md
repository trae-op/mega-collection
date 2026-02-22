# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of `@devisfuture/mega-collection` seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do NOT report security vulnerabilities through public GitHub issues.**

### How to Report

Send an email to **[devisfuture@gmail.com]** with the following information:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue (including code samples if possible)
3. **Impact assessment** — what an attacker could achieve
4. **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgement**: We will acknowledge your email within **48 hours**.
- **Assessment**: We will investigate and provide an initial assessment within **5 business days**.
- **Fix & Disclosure**: Once confirmed, we will work on a fix and coordinate disclosure with you.

### Scope

Since this is a pure computation library (no network, no file I/O, no eval), the most likely security concerns are:

- **Prototype pollution** — if user-supplied keys could modify `Object.prototype`
- **ReDoS** (Regular Expression Denial of Service) — if regex is used on user input
- **Excessive memory allocation** — if crafted input could cause OOM

We follow these principles:

- No use of `eval()` or `Function()` constructors
- No dynamic property access on prototypes
- Input validation on public API boundaries
- Strict TypeScript with no implicit `any`

## Disclosure Policy

- We will credit reporters in the release notes (unless they prefer to stay anonymous).
- We aim to release a patch within **7 days** of confirming a vulnerability.
- We follow [responsible disclosure](https://en.wikipedia.org/wiki/Responsible_disclosure) practices.

Thank you for helping keep `@devisfuture/mega-collection` and its users safe!
