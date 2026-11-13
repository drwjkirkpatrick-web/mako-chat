# MAKO CHAT — Server Deployment Guide

> Runbook for the institution's server machine. Written for a competent admin,
> not necessarily a Linux expert: every step is a command to run and a line
> saying what to expect. Stack: Synapse + PostgreSQL under Docker, on Ubuntu;
> Tailscale carries remote members in.

## 0. What you need

- A dedicated computer with Ubuntu 22.04 or 24.04 LTS
  (2+ GB RAM is plenty at small-institution scale)
- Ethernet on the institution LAN
- (only if members work from home) a Tailscale account — the free plan covers
  up to 100 devices

## 1. Install Docker

```
curl -fsSL https://get.docker.com | sh
docker compose version        # expect a version line
```

> Security note: that is the official convenience script piped to `sh`; if the
> institution's policies prefer it, use the apt repository route instead
> (docs.docker.com → Install → Ubuntu) — the rest of this guide is unchanged.

## 2. Install Tailscale (remote access)

```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up             # opens a login link; join the tailnet
```

- In the Tailscale admin console, name this machine `mako-server` and keep
  MagicDNS ON (default). Every member device that joins the same tailnet can
  then reach this machine as `http://mako-server:8008`.
- Members who never leave the building can skip Tailscale entirely and use
  the server's LAN IP.

## 3. Get the server software onto this machine

```
git clone https://github.com/drwjkirkpatrick-web/mako-chat.git
cd mako-chat/server
```

(Or copy the project over by USB and `cd mako-chat/server`.)

## 4. Configure

```
cp .env.example .env
nano .env          # or any editor
```

- `POSTGRES_PASSWORD`: generate a long random one with `openssl rand -hex 24`.
- `SERVER_NAME` (default `mako`): user IDs like `@jdoe:mako` embed it forever.
  Choose once.
- `PUBLIC_BASEURL`: with Tailscale, `http://mako-server:8008`.

Then generate the server's cryptographic identity and config:

```
bash first-run.sh
```

Expect docker pull output, then `==> [3/3] Done. Next steps:`.

## 5. Start the server

```
docker compose config --quiet    # sanity-checks the compose file + .env (no output = good)
docker compose up -d
curl http://localhost:8008/health          # expect: OK
```

Reboots are covered: both containers restart automatically
(`restart: unless-stopped` in docker-compose.yml).

## 6. Create the first admin account

```
docker compose exec -it synapse register_new_matrix_user http://localhost:8008 -a
```

- It asks for the **registration shared secret** — print it with:
  `grep registration_shared_secret data/synapse/homeserver.yaml`
- Pick the admin's username and password. This is account #1; every further
  account is created from the MAKO CHAT admin dashboard (Batch 7), or by
  re-running this command without `-a` for a regular member.

## 7. Create the announcements room

Bootstrap step, done ONCE with any Matrix client (members will use MAKO CHAT):
point it at homeserver `http://mako-server:8008`, log in as the admin, create a
public room named `announcements`. Its address must be exactly
`#announcements:mako` (matching SERVER_NAME). Once it exists, every new
account auto-joins it (`auto_join_rooms` in the config) — that is how
institution-wide broadcasts work (spec: Group Management).

## 8. Smoke tests (from a second machine)

- LAN: `curl http://<server-LAN-IP>:8008/health` → `OK`
- Tailscale (member device on the tailnet): `curl http://mako-server:8008/health` → `OK`

## 9. Backups

Nightly, via cron — dumps the database and archives all shared files:

```
sudo crontab -e
# add (adjust the path):
30 2 * * * cd /home/USER/mako-chat/server && bash backup.sh >> backups/backup.log 2>&1
```

`backup.sh` keeps the newest 14 of each archive. Copy `backups/` off this
machine regularly (USB, NAS, or cloud storage) — a backup that lives only on
the machine it backs up is not a backup.

## 10. Restore (practice this once, before you need it)

```
cd mako-chat/server
docker compose stop synapse
# database:
gunzip -c backups/mako-db-YYYY-MM-DD_HHMM.sql.gz | \
  docker compose exec -T postgres psql -U mako -c 'DROP DATABASE mako;' -c 'CREATE DATABASE mako;'
gunzip -c backups/mako-db-YYYY-MM-DD_HHMM.sql.gz | \
  docker compose exec -T postgres psql -U mako mako
# shared files:
sudo tar -C data/synapse -xzf backups/mako-media-YYYY-MM-DD_HHMM.tar.gz
docker compose up -d
curl http://localhost:8008/health          # expect: OK
```

(Run as root or with sudo where noted — the media files belong to the
Synapse container's user.)

## 11. Firewall — an honest limitation

Docker-published ports (our 8008) insert their own iptables rules and are
**not filtered by ufw**. Do not rely on the host firewall to gate port 8008.
The security posture instead:

- the server sits on the trusted institution LAN;
- the router does NO port forwarding — the server is unreachable from the
  internet;
- remote access happens only through Tailscale (authenticated, encrypted).

If LAN segmentation is required, bind the port to the LAN IP only
(`ports: ["192.168.1.10:8008:8008"]`) — but note tailnet clients then cannot
reach it; prefer the posture above.

## 12. Upgrading Synapse

1. Read the release notes (github.com/element-hq/synapse/releases).
2. Edit the tag in BOTH `docker-compose.yml` and `first-run.sh`.
3. `docker compose pull && docker compose up -d`
4. `curl http://localhost:8008/health` → `OK`

## 13. Troubleshooting

| Symptom | First checks |
|---|---|
| `/health` fails | `docker compose ps` — are both up? `docker compose logs synapse --tail 50` |
| synapse crash-loops on database errors | password mismatch: fix `.env`, re-run `first-run.sh`, `up -d` |
| a user can't connect from another machine | wrong address: LAN uses the server IP, Tailscale uses `mako-server:8008`; on their device run `tailscale status` |
| files won't send | disk space (`df -h`) and the 100 MB upload cap |

## 14. Launch checklist

Run through this ONCE, before telling members to install anything.
Every box matters — especially the restore drill.

- [ ] `docker compose ps` — both services healthy
- [ ] `curl http://localhost:8008/health` — answers `OK`
- [ ] First admin account created (§6); its password stored somewhere safe
- [ ] `#announcements` room exists (§7)
- [ ] A second test account created from the admin dashboard, logged in on
      ANOTHER machine
- [ ] Two-way chat verified between them: text, a file, an image, "Seen"
      on both sides
- [ ] Presence dot and typing indicator visible on both sides
- [ ] A test account suspended → confirmed locked out → reactivated →
      confirmed working again
- [ ] Nightly backups installed (root crontab, §9) and `backups/` contains
      one night's files
- [ ] **RESTORE DRILL:** actually restore the last backup (§10) on this or
      a scratch machine. An untested backup is a hope, not a backup.
- [ ] One copy of `backups/` taken off the machine (USB or NAS)
- [ ] Tailscale healthy (`tailscale status`); a remote device reaches
      `http://mako-server:8008/health`
- [ ] Installers built: version tag pushed, GitHub Actions run green,
      `.exe` + `.dmg` downloaded from the release page
- [ ] One real Windows machine AND one real Mac installed from the USB
      stick, including the one-time security-notice override
      (`client/INSTALL.md`)
