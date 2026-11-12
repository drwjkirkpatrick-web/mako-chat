// Types the preload bridge (electron/preload.ts) for the React app.
// window.mako exists only when running inside the Electron desktop app.
export interface MakoBridge {
  isElectron: boolean;
  platform: string;
}

declare global {
  interface Window {
    mako?: MakoBridge;
  }
}

export {};
