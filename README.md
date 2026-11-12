# MAKO CHAT 🦈

**Private institutional messaging — owned by the institution, not by a tech company.**

MAKO CHAT is a self-hosted chat platform for schools, training centres and
organizations. Members install a desktop app (Windows or macOS), log in with
an administrator-issued account, and can then message each other one-to-one or
in groups — inside the building or from home — while the institution's own
server keeps every message and file.

## Status

- **Phase:** Batch 1 of 9 done — server stack written; deployment runbook: `server/deploy.md`. Client build next; not yet usable.
- This repository is the single source of truth:
  - `docs/SPEC.md` — the full product specification (what we are building and why)
  - `docs/PLAN.md` — architecture, design decisions, and the batch-by-batch build plan
  - `Project_state.md` — where the build stands right now

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
