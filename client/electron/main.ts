// MAKO CHAT — Electron main process.
//
// NOTE: The main process is "Node-land": its only jobs are opening the
// window and handing it our React app (the renderer). It must NEVER touch
// the Matrix SDK — all app logic lives in the renderer, which is the part
// we can test without a desktop.
//
// HOW DEV WORKS: with MAKO_DEV=1 the window loads the Vite dev server
// (live reload); otherwise it loads the production build from dist/.
// WHY an explicit env var: Electron has no bundler NODE_ENV semantics.
import { app, BrowserWindow, session } from "electron";
import * as path from "node:path";

const isDev = process.env.MAKO_DEV === "1";
const DEV_URL = process.env.MAKO_DEV_URL ?? "http://localhost:5188";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MAKO CHAT",
    backgroundColor: "#0b3a53", // avoids a white flash before React mounts
    autoHideMenuBar: true,
    webPreferences: {
      // preload.ts runs before the page and installs the tiny window.mako bridge.
      preload: path.join(__dirname, "preload.js"),
      // SECURITY: the renderer is ordinary web code — it gets NO direct Node/
      // Electron access. Anything it needs arrives via the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  // Batch 8: shared files arrive as direct media links. Without this,
  // Electron downloads silently to a hidden folder; members expect a
  // normal Save dialog instead — pre-filled with the file's real name.
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: item.getFilename() });
  });
  createWindow();
});

// Standard desktop-app behaviour:
app.on("window-all-closed", () => {
  // on Windows and Linux, closing the last window quits the app;
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  // on macOS the app stays alive and the dock icon re-opens it.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
