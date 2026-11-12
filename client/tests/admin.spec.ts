import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The admin layer speaks raw fetch against the Synapse Admin API. Only the
// credential accessor comes from the wrapper — mock that, stub fetch.
vi.mock("../src/matrix/client", () => ({
  adminCredentials: vi.fn(() => ({
    baseUrl: "http://s:8008",
    accessToken: "tok",
    userId: "@walker:mako",
  })),
}));

import * as admin from "../src/matrix/admin";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function okResponse(body: unknown, status = 200) {
  return {
    ok: status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("amIAdmin", () => {
  it("returns the admin flag for the signed-in user", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ name: "@walker:mako", admin: true }));
    expect(await admin.amIAdmin()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/_synapse/admin/v2/users/%40walker%3Amako");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("returns false for regular members", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ name: "@walker:mako", admin: false }));
    expect(await admin.amIAdmin()).toBe(false);
  });
});

describe("listUsers", () => {
  it("paginates until next_token stops, mapping raw rows", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          users: [
            {
              name: "@walker:mako", admin: true, deactivated: false,
              displayname: "Walker", is_guest: false, creation_ts: 1000, last_seen_ts: 5000,
            },
          ],
          next_token: "1",
          total: 2,
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          users: [
            { name: "@suspended:mako", admin: false, deactivated: true, displayname: null, is_guest: false },
          ],
          total: 2,
        }),
      );

    const users = await admin.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0]).toMatchObject({
      userId: "@walker:mako", displayName: "Walker", isAdmin: true, isSuspended: false,
    });
    expect(users[1]).toMatchObject({ userId: "@suspended:mako", isSuspended: true });
    expect(users[1].displayName).toBeUndefined();
    // Suspended accounts must be INCLUDED in the listing.
    expect(fetchMock.mock.calls[0][0]).toContain("deactivated=true");
    expect(fetchMock.mock.calls[0][0]).toContain("guests=false");
    expect(fetchMock.mock.calls[1][0]).toContain("from=1");
  });

  it("passes the search term through the name parameter", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ users: [], total: 0 }));
    await admin.listUsers("jd");
    expect(fetchMock.mock.calls[0][0]).toContain("name=jd");
  });
});

describe("createUser", () => {
  it("PUTs the new account with password, display name and admin flag", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ name: "@jdoe:mako" }, 201));
    await admin.createUser("jdoe", { displayName: "Jdoe", password: "longenough", isAdmin: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/_synapse/admin/v2/users/%40jdoe%3Amako");
    expect(JSON.parse(init.body as string)).toEqual({
      password: "longenough",
      displayname: "Jdoe",
      admin: false,
    });
  });

  it("rejects invalid localparts before touching the server", async () => {
    await expect(admin.createUser("bad user!", { password: "longenough" })).rejects.toBeTruthy();
    await expect(admin.createUser("", { password: "longenough" })).rejects.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects short passwords (mirrors the server policy)", async () => {
    await expect(admin.createUser("jdoe", { password: "short" })).rejects.toBeTruthy();
  });
});

describe("setUserSuspended / setUserAdmin / resetUserPassword", () => {
  it("suspends reversibly via the deactivated flag", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    await admin.setUserSuspended("@jdoe:mako", true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/_synapse/admin/v2/users/%40jdoe%3Amako");
    expect(JSON.parse(init.body as string)).toEqual({ deactivated: true });
  });

  it("grants admin rights", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    await admin.setUserAdmin("@jdoe:mako", true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ admin: true });
  });

  it("resets passwords via the v1 reset_password endpoint, logging devices out", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    await admin.resetUserPassword("@jdoe:mako", "brandnewpass");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain("/_synapse/admin/v1/reset_password/%40jdoe%3Amako");
    expect(JSON.parse(init.body as string)).toEqual({
      new_password: "brandnewpass",
      logout_devices: true,
    });
  });
});

describe("listRooms / getStorageStats", () => {
  it("maps the room overview, biggest first (server-side ordering)", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        rooms: [
          { room_id: "!big", name: "Announcements", num_joined_members: 9 },
          { room_id: "!dm", name: null, num_joined_members: 2 },
        ],
      }),
    );
    const rooms = await admin.listRooms();
    expect(rooms).toEqual([
      { roomId: "!big", name: "Announcements", members: 9 },
      { roomId: "!dm", name: undefined, members: 2 },
    ]);
  });

  it("aggregates media stats and reports the server version", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("statistics/users/media")) {
        return okResponse({
          users: [
            { user_id: "@a:mako", displayname: "A", media_count: 1, media_length: 100 },
            { user_id: "@b:mako", displayname: "B", media_count: 3, media_length: 2048 },
          ],
          total: 2,
        });
      }
      return okResponse({ server_version: "1.164.2" });
    });

    const stats = await admin.getStorageStats();
    expect(stats.mediaFiles).toBe(4);
    expect(stats.mediaBytes).toBe(2148);
    expect(stats.serverVersion).toBe("1.164.2");
    // top user first, capped at 10
    expect(stats.byUser[0].userId).toBe("@b:mako");
  });

  it("turns server errors into readable messages", async () => {
    fetchMock.mockResolvedValue(okResponse({ error: "You are not a server admin" }, 403));
    await expect(admin.listUsers()).rejects.toThrow("You are not a server admin");
  });
});
