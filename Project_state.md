# Project State: MAKO CHAT

> **Last updated:** 2026-11-12
> **Current phase:** build (Batch 5 complete)
> **Overall health:** green

---

## 1. Goal (1–2 sentences)
A private, self-hosted institutional chat platform: a Matrix Synapse server on
institution hardware plus a branded Electron/React desktop app (Windows and
macOS) where admin-managed members message one-to-one or in groups, share
files, and connect over LAN or Tailscale.

## 2. Current Status
### Done
- [x] Repository scaffolded (`~/projects/mako-chat/`, branch `main`)
- [x] Product spec captured verbatim in `docs/SPEC.md`
- [x] Architecture + 9-batch build plan in `docs/PLAN.md`
- [x] Batch 1 — server deployment stack authored + statically validated
- [x] Batch 2 — client foundation: Electron/React scaffold, branded login, matrix-js-sdk 45 wrapper; 16 tests green, production build verified
- [x] Batch 3 — messaging core: sync loop, room list, conversations, DM creation; 40 tests green, offline shell browser-verified
- [x] Batch 4 — presence, typing indicators, read receipts/Seen: presence dots on DMs, typing line + preview, throttled typing-out, auto-read; 61 tests green
- [x] Batch 5 — file sharing: attach with upload progress, inline images (thumb→full), file cards, per-room files drawer, download links; 73 tests green

### In Progress
- [ ] Batch 6 — profiles, avatars, desktop notifications

### Not Started
- [ ] Batches 2–9 (client, messaging, files, admin mode, packaging, docs)

## 3. Architecture & Key Decisions
| Decision | Rationale | Date |
|---|---|---|
| Synapse server, `server_name: mako`, no email domain | Spec requires internal usernames | 2026-11-12 |
| Registration disabled; admin creates accounts via Admin API/CLI | Spec: administrator-controlled accounts | 2026-11-12 |
| Admin dashboard = admin mode in desktop app (no separate web service) | One deliverable, fewer attack surfaces | 2026-11-12 |
| Federation off; E2EE deferred to roadmap (D6) | Closed institutional island; institution is the trusted party | 2026-11-12 |
| Installers built on GitHub Actions (win/mac runners) | Can't cross-build .exe/.dmg from Linux ARM64 | 2026-11-12 |
| Server stack integration-tested on target Ubuntu box, not dev Jetson | Dev Jetson Docker daemon broken (no-root) | 2026-11-12 |

## 4. Blockers & Risks
- **Blocker:** Docker unusable on the dev Jetson → server stack cannot run
  locally. → Mitigation: author + static-validate configs; run live on the
  institution's Ubuntu machine at deploy time using `server/deploy.md`.
- **Risk:** Unsigned installers trigger OS security warnings. → Mitigation:
  document the override steps for Windows and macOS in the install guide (Batch 8).
- **Risk:** matrix-js-sdk API churn. → Mitigation: pin the SDK version, wrap
  all SDK calls in one client-side data module (D9).

## 5. Next Step (only ONE)
> **Next:** Batch 6 — profiles and avatars (display name + picture set in
> app), desktop notifications on new messages (Electron Notification).

## 6. Environment & Tooling Notes
- Dev host: Jetson (Linux ARM64, Docker daemon broken — no-root environment)
- Client toolchain: Node 26; `npm test` / `npm run dev` in `client/`; install with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (no display)
- Server target: institution Ubuntu machine with Docker + Tailscale
- GitHub: `drwjkirkpatrick-web/mako-chat`, branch `main`; Walker pushes after commits
- Hermes skills in use: project-state-management, software-development-workflows

## 7. Recent Session Log
- 2026-11-12: Repo scaffolded; SPEC/PLAN/Project_state written; Batch 1 queued.
- 2026-11-12: Batch 1 — server stack (compose, synapse template, first-run, backup, deploy runbook) authored + static-validated; committed.
- 2026-11-12: Batch 2 — client foundation built + verified (SDK-45 signatures checked against installed types; 16 tests; production build; login + error paths browser-checked); committed.
- 2026-11-12: Batch 3 — messaging core built + verified (sync loop/rooms/DMs against verified SDK-45 surface; 40 tests; offline chat shell + validation browser-checked; polish backlog noted in PLAN).
- 2026-11-12: Batch 4 — presence/typing/receipts built + verified (verified v45 API incl. sendTyping, getReadReceiptForUserId, IPresenceOpts; 61 tests; browser regression check clean).
- 2026-11-12: Batch 5 — file sharing built + verified (uploadContent/UploadOpts/mxcUrlToHttp verified; Parameters<> overload trap documented; 73 tests; browser regression clean).

## 8. References
- Spec: `docs/SPEC.md`
- Plan: `docs/PLAN.md`
