# MAKO CHAT — Desktop Client (Electron + React)

The branded desktop app members install. Electron provides the Windows/macOS
shell; React provides everything the user sees.

## Everyday commands

| Command | What it does |
|---|---|
| `npm install` | First time only. On a headless dev box (e.g. the Jetson) prefix `ELECTRON_SKIP_BINARY_DOWNLOAD=1` — the GUI binary is only needed on machines with a display; installers are built by CI (docs/PLAN.md D7). |
| `npm run dev` | Vite dev server at http://localhost:5188 — open in a browser, or run the Electron shell on a desktop with `MAKO_DEV=1`. |
| `npm test` | Vitest unit suite (no network, no server needed). |
| `npm run typecheck` | TypeScript against the REAL matrix-js-sdk types — this is what catches SDK drift. |
| `npm run build` | Full production build (`dist/` + `dist-electron/`). |

## Note on bundle size

The production bundle includes matrix-js-sdk's Rust-crypto wasm (~7.8 MB).
It is dormant until end-to-end encryption becomes a feature (docs/PLAN.md D6)
— the SDK loads it unconditionally.

## The one rule (docs/PLAN.md D9)

`src/matrix/client.ts` is the ONLY file allowed to import `matrix-js-sdk`.
Everything else talks to the wrapper using our own `MakoSession` type.
Tests mock the SDK at that one seam; SDK upgrades are one-file changes.

## Where things live

```
client/
  electron/     main.ts (window shell) + preload.ts (the window.mako bridge)
  src/
    brand.ts          name / emoji / tagline — rebranding starts here
    matrix/client.ts  ⭐ the Matrix boundary (see above)
    components/       React UI pieces (LoginScreen first)
  tests/        vitest specs, mirroring src/
```
