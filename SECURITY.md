# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/dpologdvinity/tagalingo/security/advisories/new)
rather than in a public issue. Include the steps to reproduce and what an attacker could do.

You should get a reply within a week. Fixes land on `master`, which is the only supported
version.

## What counts

Anything that lets a learner see exercise answers before grading, read or change another
account's progress, bypass the Studio reviewer role, or leak secrets (`AUTH_SECRET`, API keys)
is in scope, as are the usual web issues (XSS, CSRF, injection, auth bypass).
