// MAKO CHAT — preload bridge.
//
// The ONLY doorway between the web app and the desktop shell. WHY so tiny:
// everything exposed here is callable from the web page, so each addition
// is a deliberate security decision. (Batch 8 will add a save-file dialog
// for downloads — nothing else is planned.)
import { contextBridge } from "electron";
import * as os from "node:os";

contextBridge.exposeInMainWorld("mako", {
  isElectron: true,          // lets the app tell "desktop" from "plain browser"
  platform: os.platform(),   // "win32" | "darwin" | "linux" — for UI tweaks
});
