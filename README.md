# 🦈 MAKO CHAT

**Messaging that belongs to your institution — not to a tech company.**

Most chat apps rent you a conversation. MAKO CHAT gives your school,
training centre, or organization its own. Every message, every file, every
account lives on *your* computer, under *your* control — and the people
you serve stay connected, down the hall or at home.

## What members get

- **Conversations that feel familiar.** One-to-one chats and group rooms.
  Typing indicators, "Seen" marks, online dots, and a desktop notification
  when someone writes while you're elsewhere. Everything people already
  know how to use.
- **Files that just work.** Drop a document, a photo, or a PDF into the
  chat. It uploads with a progress bar, pictures appear right inside the
  conversation, and everyone can download what they need. Each room also
  keeps a list of everything ever shared there.
- **One installer, two clicks.** A Windows computer gets the app from a
  USB stick and a double-click — no wizard, no choices. A Mac gets a
  standard installer image. Nobody needs to be technical.
- **A name and a face.** Members set their own display name and profile
  picture in the app.
- **Announcements that reach everyone.** Every new member is placed in the
  institution's announcements room automatically.

## What the administrator gets

- **A dashboard, right inside the app.** Create accounts and hand out
  passwords, suspend and reactivate them, reset passwords, promote a
  colleague to help administer — all without ever touching the server.
- **A server that stays home.** Everything runs on an institution
  computer, with nightly backups, a tested restore procedure, and an
  honest security summary.
- **No domain to buy.** Accounts are internal — `@jdoe:mako` — not email
  addresses. The institution never registers with anyone.

## How it fits together (plain language)

- A **server program** runs on an institution computer and holds all
  accounts, conversations, and shared files — like a telephone exchange
  for your messages.
- The **desktop app** members install talks to that server the way a
  phone talks to the cell tower.
- Members outside the building connect through a **private tunnel** —
  a keyed road that only your people can travel. Nothing is opened to
  the public internet.

## Getting MAKO CHAT onto computers

Push a version tag, and the build pipeline produces the installers on
real Windows and Mac computers — ready for the release page and your USB
stick. Member instructions, including the one-time "unknown developer"
notice that in-house software always receives, live in
[`client/INSTALL.md`](client/INSTALL.md).

## An honest security note

Messages travel through an encrypted tunnel and stay inside your server —
but conversations are **not** end-to-end encrypted in this version. The
trusted party is your institution: it runs the server and the accounts.
(End-to-end encryption is on the roadmap — see
[`docs/PLAN.md`](docs/PLAN.md), decision D6.)

## For technical readers

Matrix Synapse + PostgreSQL under Docker on Ubuntu; an Electron + React
desktop client with `matrix-js-sdk` behind a single wrapper module;
administrator features through the Synapse Admin API; installers built by
GitHub Actions on native Windows/macOS runners; 119 tests across 10
suites. The full architecture, decisions, and batch history live in
[`docs/PLAN.md`](docs/PLAN.md); the server runbook in
[`server/deploy.md`](server/deploy.md); client development in
[`client/README.md`](client/README.md).

**Status: v1.0.0 — feature-complete and ready for its first institutional
deployment.**
