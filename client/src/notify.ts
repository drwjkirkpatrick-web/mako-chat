// Desktop notifications — guarded so the same code runs in a plain browser
// (asks permission) and inside the Electron shell (permission granted).

/**
 * Ask once, early (at app start), so notifications can fire later without
 * a prompt interrupting a message. Returns whether they're available.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false; // no API at all
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false; // some platforms throw instead of prompting — never crash chat over a toast
  }
}

/** Fire a notification if (and only if) the user allowed them. */
export function showNotification(title: string, body: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    /* platforms requiring a service worker throw — ignore */
  }
}
