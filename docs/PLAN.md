# MAKO CHAT — Architecture & Build Plan

> Living document. Which batch we are on lives in `Project_state.md`; decisions
> made while building are recorded here and in the state file.

## 1. Architecture at a glance

```
+---------------------------+       +----------------------------------+
|  MAKO CHAT desktop app    |       |  Institution server (Ubuntu)     |
|  Electron + React         |<----->|  Docker:                         |
|  Windows .exe / macOS     |  LAN  |    - Matrix Synapse (messaging)  |
|  .dmg                     |  or   |    - PostgreSQL (storage)        |
|                           |  VPN  |  Tailscale for remote members    |
+---------------------------+       +----------------------------------+
```

- **Synapse** does the heavy lifting a from-scratch server would have to
  implement itself: accounts, rooms, delivery, history, media, presence.
  We configure it, extend it with its Admin API, and put a fully-branded
  MAKO CHAT face on top.
- **The desktop app** is the only thing members ever see: institution-branded
  login, chats, groups, files, and an admin mode.
- **Tailscale** is the private road: the same server address works on the
  institution network and from home; no ports are opened to the internet.

## 2. Design decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | `server_name` = `mako`; user IDs look like `@jdoe:mako` | Spec: internal usernames, no commercial email domain |
| D2 | Self-registration disabled; accounts created via Synapse Admin API / CLI | Spec: administrator-controlled account creation |
| D3 | Admin dashboard is an admin mode inside the desktop app, calling the Synapse Admin API directly | One deliverable; no second web service to run and secure |
| D4 | Announcements = server-wide `#announcements` room, auto-joined, admin-posted | Spec: institutional broadcasts |
| D5 | Federation off; a private Matrix island | Spec is institutional communication; minimal attack surface |
| D6 | v1 rooms are encrypted in transit (TLS via Tailscale) but not end-to-end; E2EE is a roadmap item | The institution is the trusted party in this model; cuts v1 complexity sharply. Stated plainly in README |
| D7 | Installers built by GitHub Actions on windows/macos runners | Cross-building .exe/.dmg installers from Linux/ARM64 is not possible; CI produces them natively |
| D8 | Server stack authored and reviewed on the dev box, integration-tested on the target Ubuntu machine | Dev Jetson's Docker daemon is unusable (no-root environment) |
| D9 | matrix-js-sdk pinned and wrapped in one client data module | SDK churn is real; a wrapper keeps it a one-file problem |

## 3. Spec feature → what delivers it

| Spec feature | Delivered by |
|---|---|
| Private 1:1 conversations | Direct-message rooms (Synapse) |
| Group chats | Matrix rooms, member management in client |
| Real-time message delivery | Synapse `/sync` (matrix-js-sdk) |
| Message history | Room timeline persisted in PostgreSQL |
| Read receipts / typing indicators / presence | Matrix receipts, typing, presence (on by default) |
| File sharing + downloads | Synapse media repository |
| Profiles + profile pictures | Matrix profile and avatar APIs |
| Account activation / suspension | Admin API deactivate / reactivate |
| Announcements / broadcasts | `#announcements` room (D4) |
| Message notifications | Electron notifications on sync events |
| Centralized admin dashboard | Admin mode in client (D3) |
| Storage management + backups | Admin API media stats; `server/backup.sh` + cron |

## 4. Build batches

| Batch | Scope | State |
|---|---|---|
| 0 | Repo scaffold, spec, plan, state file | done |
| 1 | Server stack: docker-compose, homeserver template, first-run, backup, deploy guide | done (config-review; live test at deploy) |
| 2 | Client foundation: Electron+React+Vite scaffold, branding, login, session | done (16 tests; login + error paths verified in browser) |
| 3 | Messaging core: sync loop, room list, DMs, timeline, send/receive | done (40 tests; offline shell + validation browser-verified) |
| 4 | Presence, typing, read receipts | done (61 tests; offline shell regression-checked in browser) |
| 5 | File sharing: upload/download/room files | done (73 tests; upload+progress, image/file rendering, files drawer, download links) |
| 6 | Profiles, avatars, desktop notifications | done (93 tests; profile editor, DM avatar images, notification decision logic) |
| 7 | Admin mode: users, groups, announcements, storage stats | done (116 tests; dashboard verified in browser with stubbed admin API — reversible suspend chosen over destructive erase) |
| 8 | Packaging: electron-builder NSIS + dmg, GitHub Actions release | done (local Linux --dir packaging smoke verified config + asar contents; win/mac installers build in CI on tag) |
| 9 | Hardening: server checklist, restore drill, final README, runbook | — |

Batch rule (Walker's): one batch at a time — build, test, commit, update
README + Project_state, commit; Walker pushes to GitHub.

### Polish backlog (collected during verification; fold into Batch 9)

- While offline, the "New chat" input and Start button stay enabled —
  consider disabling or greying them (Batch 3 browser check).
- Empty-state text says "Pick a conversation, or start one" even when
  there are none yet — tailor the wording to the empty-room case.
- The offline status gives no manual retry button (SDK auto-retries); fine
  for v1, revisit if users report it.

## 5. Testing & verification strategy

- **Client (Batches 2–7):** Vitest unit tests around a mocked Matrix data
  layer; per-batch manual smoke checklist; UI exercised via the Vite dev server.
- **Server (Batch 1):** static validation on the dev box (bash -n, YAML parse,
  placeholder audit). The Docker daemon on the dev Jetson is broken — live
  startup happens on the institution machine (server/deploy.md is the runbook).
- **Integration gate:** two users, two machines, one live conversation plus a
  file transfer, executed against the institution server at deploy time.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dev box cannot run Docker | Careful templating + deploy runbook; first deploy runs the checklist |
| Unsigned installers (SmartScreen / Gatekeeper) | Documented override steps in install guide (v1); certs optional later |
| E2EE absent in v1 (D6) | Stated plainly in README; rooms stay inside the institution's server |
| matrix-js-sdk API churn | Pinned version + wrapper module (D9) |
| Synapse config schema drift across versions | Pinned image tag; minimal config keys; sane Synapse defaults used |
