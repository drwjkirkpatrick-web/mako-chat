# MAKO CHAT 🦈

**Private institutional messaging — owned by the institution, not by a tech company.**

MAKO CHAT is a self-hosted chat platform for schools, training centres and
organizations. Members install a desktop app (Windows or macOS), log in with
an administrator-issued account, and can then message each other one-to-one or
in groups — inside the building or from home — while the institution's own
server keeps every message and file.

## Status

- **Phase:** Batch 8 of 9 done — packaging: NSIS one-click .exe + both-arch .dmg via GitHub Actions (tag → installers), Save dialogs for downloads, member install guide (116 tests). Hardening/launch docs next.
- This repository is the single source of truth:
  - `docs/SPEC.md` — the full product specification (what we are building and why)
  - `docs/PLAN.md` — architecture, design decisions, and the batch-by-batch build plan
  - `Project_state.md` — where the build stands right now

## Getting it onto members' computers

Push a tag (e.g. `v0.8.0`) and GitHub Actions builds the installers on real
Windows/macOS runners: a one-click `.exe` and `.dmg` files for both Mac
architectures, attached to the release page — ready for the USB stick.
Member instructions (including the one-time unsigned-app security notices):
`client/INSTALL.md`.

## How it fits together (plain language)

- A **server program** (Matrix Synapse) runs on an institution computer and holds
  all accounts, conversations and shared files in its own database.
- A **desktop app** (built with Electron and React) is what members install. It
  talks to the server the way a phone talks to a cell tower.
- People outside the building connect through a **private tunnel** (Tailscale) —
  like having a key to a private road into the institution.

## For technical readers

Stack: Matrix Synapse + PostgreSQL (Docker, Ubuntu) · Electron + React client ·
Synapse Admin API for the admin dashboard. Build details, decisions, and the
batch plan live in `docs/`. Note: v1 rooms are protected by transport
encryption but **not** end-to-end encrypted — see `docs/PLAN.md` decision D6.
