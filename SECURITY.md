# Security Policy

We take security seriously, even though we're a small, early-stage team. Thanks
for helping keep Dim0 and its users safe.

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues, discussions,
or pull requests.**

Instead, email **contact@dim0.net** with:

- A description of the issue and the impact you think it has
- Steps to reproduce (a proof of concept helps a lot)
- The affected version or commit, and whether it's the hosted app
  (app.dim0.net) or a self-hosted setup

If you'd like to encrypt your report or need another channel, say so in a first
email and we'll arrange it.

## What to expect

We're a small team, so we can't promise enterprise SLAs — but we will:

- Acknowledge your report, typically within a few business days
- Keep you updated as we investigate and work on a fix
- Credit you when the fix ships, if you'd like (let us know)

Please give us a reasonable window to address the issue before any public
disclosure. We'll work with you on timing.

## Supported versions

Dim0 moves fast and is pre-1.0. Security fixes land on the **latest release**;
if you're self-hosting, the safest path is to stay current with the most recent
published images and the `main` branch.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ (please upgrade) |

## Scope

This policy covers the Dim0 codebase in this repository, the official Docker
images, and the hosted app at app.dim0.net. Issues in third-party dependencies
are best reported upstream, but please let us know if they affect Dim0 so we can
track and patch.
