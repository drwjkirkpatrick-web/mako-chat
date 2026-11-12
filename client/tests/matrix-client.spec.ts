import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";

// WHY mock the whole SDK: unit tests must not need a network or a real
// server. The mock mirrors only the small surface the wrapper uses. If the
// REAL SDK drifts, `npm run typecheck` (against real types) catches it —
// these tests check OUR behaviour, not the SDK's.
// NOTE: the wrapper now also imports enums (ClientEvent, RoomEvent, Preset,
// SyncState) at module scope; the factory must define them so the module
// loads in tests, even though the login tests never fire them.
vi.mock("matrix-js-sdk", () => ({
  createClient: vi.fn(),
  ClientEvent: { Sync: "sync", Room: "Room", AccountData: "accountData" },
  RoomEvent: { Timeline: "Room.timeline", Name: "Room.name", MyMembership: "Room.myMembership", Receipt: "Room.receipt" },
  RoomMemberEvent: { Typing: "RoomMember.typing" },
  UserEvent: { Presence: "User.presence" },
  ReceiptType: { Read: "m.read" },
  Preset: { TrustedPrivateChat: "trusted_private_chat" },
  EventType: { Direct: "m.direct" },
  SyncState: {
    Error: "ERROR", Prepared: "PREPARED", Syncing: "SYNCING",
    Stopped: "STOPPED", Catchup: "CATCHUP", Reconnecting: "RECONNECTING",
  },
}));

import { createClient } from "matrix-js-sdk";
import * as matrix from "../src/matrix/client";

// The fake mirrors exactly the SDK surface the wrapper touches in v45:
// login() for the handshake, logout() to end the session.
function fakeClient() {
  return {
    login: vi.fn().mockResolvedValue({
      user_id: "@jdoe:mako",
      access_token: "tok_123",
      device_id: "DEV01",
    }),
    logout: vi.fn().mockResolvedValue({}),
  };
}

// NOTE: the wrapper keeps its state in module variables, and vitest reuses
// the module across tests in a file. Calling logout() here guarantees each
// test starts from a genuinely logged-out world (with client === null,
// logout() only clears local state — no server call happens).
beforeEach(async () => {
  await matrix.logout();
  vi.mocked(createClient).mockReset();
  localStorage.clear();
});

describe("normalizeBaseUrl (pure — no mocks needed)", () => {
  it("adds http:// to a bare host:port", () => {
    expect(matrix.normalizeBaseUrl("mako-server:8008")).toBe("http://mako-server:8008");
  });
  it("keeps https exactly as typed", () => {
    expect(matrix.normalizeBaseUrl("https://chat.school.org")).toBe("https://chat.school.org");
  });
  it("strips trailing slashes and stray whitespace", () => {
    expect(matrix.normalizeBaseUrl("  http://mako-server:8008/  ")).toBe("http://mako-server:8008");
  });
  it("returns empty for empty input", () => {
    expect(matrix.normalizeBaseUrl("   ")).toBe("");
  });
});

describe("login", () => {
  it("creates the SDK client at the normalized URL and persists the session", async () => {
    const c = fakeClient();
    vi.mocked(createClient).mockReturnValue(c as unknown as MatrixClient);

    const session = await matrix.login("mako-server:8008", "jdoe", "correct-horse");

    expect(createClient).toHaveBeenCalledWith({ baseUrl: "http://mako-server:8008" });
    expect(c.login).toHaveBeenCalledWith("m.login.password", {
      identifier: { type: "m.id.user", user: "jdoe" },
      password: "correct-horse",
      initial_device_display_name: "MAKO CHAT desktop",
    });
    expect(session.userId).toBe("@jdoe:mako");
    expect(session.accessToken).toBe("tok_123");
    expect(matrix.currentSession()?.deviceId).toBe("DEV01");
    expect(localStorage.getItem("mako.session")).toContain("tok_123");
    expect(localStorage.getItem("mako.serverUrl")).toBe("http://mako-server:8008");
  });

  it("stores nothing when the server rejects the credentials", async () => {
    const c = fakeClient();
    c.login.mockRejectedValue({ httpStatus: 403, errcode: "M_FORBIDDEN" });
    vi.mocked(createClient).mockReturnValue(c as unknown as MatrixClient);

    await expect(matrix.login("http://s:8008", "jdoe", "wrong")).rejects.toBeTruthy();
    expect(localStorage.getItem("mako.session")).toBeNull();
    expect(matrix.currentSession()).toBeNull();
  });
});

describe("restoreSession / logout", () => {
  it("restores a saved session at startup", async () => {
    const c = fakeClient();
    vi.mocked(createClient).mockReturnValue(c as unknown as MatrixClient);
    await matrix.login("http://s:8008", "jdoe", "pw");

    // restoreSession re-creates the client from storage — a second call must
    // succeed even though it goes through createClient again.
    const restored = matrix.restoreSession();
    expect(restored?.userId).toBe("@jdoe:mako");
    expect(restored?.baseUrl).toBe("http://s:8008");
  });

  it("returns null when nothing is saved", () => {
    expect(matrix.restoreSession()).toBeNull();
  });

  it("logout invalidates the token server-side and forgets the session locally", async () => {
    const c = fakeClient();
    vi.mocked(createClient).mockReturnValue(c as unknown as MatrixClient);
    await matrix.login("http://s:8008", "jdoe", "pw");

    await matrix.logout();

    expect(c.logout).toHaveBeenCalled();
    expect(localStorage.getItem("mako.session")).toBeNull();
    expect(matrix.currentSession()).toBeNull();
  });
});
