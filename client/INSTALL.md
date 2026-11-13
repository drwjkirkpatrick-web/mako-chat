# Installing MAKO CHAT

For members: how to get the app onto a computer and log in.
For admins: how the installers are produced.

## For members — Windows

1. Copy `MAKO-CHAT-Setup-…​.exe` (e.g. from the USB stick your institution gave you) onto the computer, or download it from the institution's release page.
2. Double-click it. It installs itself — no wizard, no choices.
3. **One-time security notice (expected):** because the installer is not signed, Windows may show "Windows protected your PC". Click **More info** → **Run anyway**. This is the standard message for in-house software; your institution built this file itself.
4. Start **MAKO CHAT** from the Start menu.
5. Log in with the server address, username and password your administrator gave you (the server field is usually pre-filled).

## For members — macOS

1. Copy or download `MAKO-CHAT-…​.dmg`. Note the file name ends in `-arm64` (newer Macs) or `-x64` (older Macs) — ask your admin which one your computer needs if you are not sure.
2. Open the .dmg, drag **MAKO CHAT** into **Applications**.
3. **One-time security notice (expected):** the first launch shows "…cannot be opened because the developer cannot be verified" because the app is not signed. Right-click **MAKO CHAT** → **Open** → **Open** (or System Settings → Privacy & Security → **Open Anyway**). Again: standard for in-house software.
4. Log in with the server address, username and password your administrator gave you.

## Where do the files come from? (admins)

Installers are built by GitHub Actions whenever a tag like `v0.8.0` is pushed:

```
git tag v0.8.0
git push origin v0.8.0
```

Watch the **Actions** tab: Test → Windows → macOS → Publish. When it
finishes, the release page holds the `.exe` and both `.dmg` files.
Download them and put them on the USB stick for distribution.

- Windows `.exe`: built on a Windows runner — one-click NSIS installer.
- macOS `.dmg`: built on a macOS runner, for both x64 and arm64 Macs.
- Everything is **unsigned** in v1. Buying codesigning certificates
  (OV/EV for Windows, an Apple Developer ID for macOS) removes the
  security-notice steps above; the `electron-builder.yml` keys are ready
  for them.

## Building locally (admins, optional)

On a Windows machine: `npm run dist:win`. On a Mac: `npm run dist:mac`.
A Linux dev box cannot produce Windows/macOS installers — that is what
the Actions pipeline is for.
