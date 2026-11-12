# Project State: MAKO CHAT

> **Last updated:** 2026-11-12
> **Current phase:** build (Batch 0 complete)
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

### In Progress
- [ ] Batch 1 — server deployment stack (docker-compose, synapse config)

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
> **Next:** Batch 1 — write the server deployment stack (`docker-compose.yml`,
> `homeserver.template.yaml`, `first-run.sh`, `backup.sh`, `.env.example`,
> `server/deploy.md`).

## 6. Environment & Tooling Notes
- Dev host: Jetson (Linux ARM64, Docker daemon broken — no-root environment)
- Server target: institution Ubuntu machine with Docker + Tailscale
- GitHub: `drwjkirkpatrick-web/mako-chat`, branch `main`; Walker pushes after commits
- Hermes skills in use: project-state-management, software-development-workflows

## 7. Recent Session Log
- 2026-11-12: Repo scaffolded; SPEC/PLAN/Project_state written; Batch 1 queued.

## 8. References
- Spec: `docs/SPEC.md`
- Plan: `docs/PLAN.md`
