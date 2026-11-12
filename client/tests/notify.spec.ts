import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureNotificationPermission, showNotification } from "../src/notify";

// The Web Notification API does not exist in jsdom — stub it per test.

afterEach(() => vi.unstubAllGlobals());

describe("notify", () => {
  it("shows a notification when permission is granted", () => {
    const created: Array<{ title: string; body: string }> = [];
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        constructor(
          public title: string,
          public options: { body: string },
        ) {
          created.push({ title: this.title, body: this.options.body });
        }
      },
    );
    showNotification("MAKO CHAT — Jdoe", "jdoe: hello");
    expect(created).toEqual([{ title: "MAKO CHAT — Jdoe", body: "jdoe: hello" }]);
  });

  it("does nothing without a Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    showNotification("t", "b"); // must not throw
  });

  it("stays silent when permission was denied", () => {
    let constructed = 0;
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "denied";
        constructor() {
          constructed++;
        }
      },
    );
    showNotification("t", "b");
    expect(constructed).toBe(0);
  });

  it("requests permission when it is still 'default'", async () => {
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "default";
        static async requestPermission() {
          return "granted";
        }
      },
    );
    expect(await ensureNotificationPermission()).toBe(true);
  });
});
