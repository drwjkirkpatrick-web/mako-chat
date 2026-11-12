import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { MatrixClient, Room } from "matrix-js-sdk";

// The whole SDK is mocked: these tests check OUR translation layer, never
// the SDK's. (SDK drift is caught by `npm run typecheck` against real types.)
vi.mock("matrix-js-sdk", () => ({
  createClient: vi.fn(),
  ClientEvent: { Sync: "sync", Room: "Room", AccountData: "accountData" },
  RoomEvent: { Timeline: "Room.timeline", Name: "Room.name", MyMembership: "Room.myMembership" },
  Preset: { TrustedPrivateChat: "trusted_private_chat" },
  EventType: { Direct: "m.direct" },
  SyncState: {
    Error: "ERROR", Prepared: "PREPARED", Syncing: "SYNCING",
    Stopped: "STOPPED", Catchup: "CATCHUP", Reconnecting: "RECONNECTING",
  },
}));

import { createClient } from "matrix-js-sdk";
import * as matrix from "../src/matrix/client";

const ME = "@me:mako";

// The SDK type narrows `emit` to its typed event names; the fake is really
// a plain EventEmitter underneath, so drive it through that side. (Only the
// WRAPPER has to satisfy the SDK's types — tests fire raw strings.)
function fire(fake: MatrixClient, event: string, ...args: unknown[]): void {
  (fake as unknown as EventEmitter).emit(event, ...args);
}
function listenerCount(fake: MatrixClient, event: string): number {
  return (fake as unknown as EventEmitter).listenerCount(event);
}

/** A fake SDK client: an emitter plus the handful of methods we touch. */
function makeFakeClient(): MatrixClient {
  const fake = new EventEmitter() as unknown as Record<string, unknown>;
  Object.assign(fake, {
    login: vi.fn().mockResolvedValue({ user_id: ME, access_token: "tok", device_id: "DEV" }),
    logout: vi.fn().mockResolvedValue({}),
    startClient: vi.fn().mockResolvedValue(undefined),
    stopClient: vi.fn(),
    getRooms: vi.fn(() => [] as Room[]),
    getRoom: vi.fn(() => null),
    sendTextMessage: vi.fn().mockResolvedValue({}),
    createRoom: vi.fn().mockResolvedValue({ room_id: "!new" }),
    getAccountDataFromServer: vi.fn().mockResolvedValue(null),
    setAccountData: vi.fn().mockResolvedValue({}),
  });
  return fake as unknown as MatrixClient;
}

/** A fake room with a few timeline events. */
function makeFakeRoom(roomId: string, opts: {
  name?: string;
  joined?: string[];
  messages?: Array<{ sender: string; body: string; ts: number }>;
  membership?: string;
} = {}): Room {
  const joined = opts.joined ?? [ME];
  const events = (opts.messages ?? []).map((m, i) => ({
    getType: () => "m.room.message",
    getSender: () => m.sender,
    getContent: () => ({ msgtype: "m.text", body: m.body }),
    getId: () => "$ev" + i,
    localTimestamp: m.ts,
  }));
  const room = {
    roomId,
    name: opts.name ?? "Some Room",
    getMyMembership: () => opts.membership ?? "join",
    getJoinedMembers: () =>
      joined.map((id) => ({ userId: id, name: id.replace(/^@/, "").split(":")[0] })),
    getMember: (id: string) => ({ userId: id, name: id.replace(/^@/, "").split(":")[0] }),
    getLiveTimeline: () => ({ getEvents: () => events }),
  };
  return room as unknown as Room;
}

/** Log in (mocked) and return the fake client for event-driving. */
async function loginWithFake(fake: MatrixClient) {
  vi.mocked(createClient).mockReturnValue(fake);
  await matrix.login("http://s:8008", "me", "pw");
}

beforeEach(async () => {
  vi.mocked(createClient).mockReset();
  localStorage.clear();
  await matrix.logout(); // reset the wrapper's module state
});

describe("startSync / sync states", () => {
  it("starts the SDK client and goes live on PREPARED", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };

    await matrix.startSync(cb);
    expect(fake["startClient"]).toHaveBeenCalledWith({ initialSyncLimit: 30 });

    fire(fake, "sync", "PREPARED");
    await vi.waitFor(() => expect(cb.onStateChange).toHaveBeenCalledWith("live"));
    expect(cb.onRoomsChanged).toHaveBeenCalled();
  });

  it("reports offline on transient errors but fatal on a dead token", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);

    fire(fake, "sync", "ERROR", null, { error: { errcode: "M_CONNECTION_FAILED" } });
    await vi.waitFor(() => expect(cb.onStateChange).toHaveBeenCalledWith("offline"));

    fire(fake, "sync", "ERROR", null, { error: { errcode: "M_UNKNOWN_TOKEN" } });
    await vi.waitFor(() => expect(cb.onStateChange).toHaveBeenCalledWith("fatal"));
    // fatal stops the loop: the client must be stopped.
    expect(fake["stopClient"]).toHaveBeenCalled();
  });

  it("relays timeline events to the room they belong to", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!r1", { messages: [{ sender: ME, body: "hi", ts: 1 }] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);

    fire(fake, "Room.timeline", {
      getType: () => "m.room.message",
      getSender: () => "@other:mako",
      getContent: () => ({ msgtype: "m.text", body: "new!" }),
      getId: () => "$x",
      localTimestamp: 99,
    }, room);

    expect(cb.onRoomUpdated).toHaveBeenCalledWith("!r1");
    expect(cb.onRoomsChanged).toHaveBeenCalled();
  });
});

describe("listRooms", () => {
  it("lists joined rooms, newest activity first, with previews", async () => {
    const fake = makeFakeClient();
    const older = makeFakeRoom("!old", {
      name: "Announcements",
      joined: [ME, "@a:mako", "@b:mako"],
      messages: [{ sender: "@a:mako", body: "first", ts: 100 }],
    });
    const newer = makeFakeRoom("!new", {
      name: "",
      joined: [ME, "@jdoe:mako"], // two members -> DM
      messages: [{ sender: "@jdoe:mako", body: "hello there", ts: 200 }],
    });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([older, newer]);
    await loginWithFake(fake);

    const rooms = matrix.listRooms();
    expect(rooms.map((x) => x.roomId)).toEqual(["!new", "!old"]);
    expect(rooms[0].isDirect).toBe(true);
    expect(rooms[0].name).toBe("jdoe"); // DM named after the OTHER member
    expect(rooms[0].preview).toContain("hello there");
    expect(rooms[1].isDirect).toBe(false);
    expect(rooms[1].name).toBe("Announcements");
  });

  it("skips rooms we have left", async () => {
    const fake = makeFakeClient();
    const left = makeFakeRoom("!left", { membership: "leave" });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([left]);
    await loginWithFake(fake);
    expect(matrix.listRooms()).toEqual([]);
  });

  it("honours the m.direct account-data map for DM flags", async () => {
    const fake = makeFakeClient();
    const groupish = makeFakeRoom("!group", { joined: [ME, "@a:mako", "@b:mako", "@c:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([groupish]);
    (fake.getAccountDataFromServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      "@a:mako": ["!group"],
    });
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);
    fire(fake, "sync", "PREPARED");
    await vi.waitFor(() => expect(cb.onStateChange).toHaveBeenCalledWith("live"));

    expect(matrix.listRooms()[0].isDirect).toBe(true); // flagged via account data
  });
});

describe("getMessages / sendText", () => {
  it("returns chat texts with names and mine/theirs flags", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!r1", {
      joined: [ME, "@jdoe:mako"],
      messages: [
        { sender: "@jdoe:mako", body: "hey", ts: 10 },
        { sender: ME, body: "hi", ts: 20 },
      ],
    });
    (fake.getRoom as ReturnType<typeof vi.fn>).mockReturnValue(room);
    await loginWithFake(fake);

    const msgs = matrix.getMessages("!r1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].senderName).toBe("jdoe");
    expect(msgs[0].isMine).toBe(false);
    expect(msgs[1].isMine).toBe(true);
  });

  it("sends text through the SDK with local echo", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    await matrix.sendText("!r1", "  hello  ");
    expect(fake.sendTextMessage).toHaveBeenCalledWith("!r1", "hello"); // trimmed
  });
});

describe("startDirectMessage", () => {
  it("creates a DM room, invites, and flags it in m.direct", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    (fake.createRoom as ReturnType<typeof vi.fn>).mockResolvedValue({ room_id: "!dm1" });

    const roomId = await matrix.startDirectMessage("@jdoe:mako");

    expect(roomId).toBe("!dm1");
    expect(fake.createRoom).toHaveBeenCalledWith({
      preset: "trusted_private_chat",
      invite: ["@jdoe:mako"],
      is_direct: true,
    });
    expect(fake.setAccountData).toHaveBeenCalledWith("m.direct", { "@jdoe:mako": ["!dm1"] });
  });

  it("appends to an existing m.direct entry without losing old rooms", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    (fake.getAccountDataFromServer as ReturnType<typeof vi.fn>).mockResolvedValue({
      "@jdoe:mako": ["!old"],
    });
    (fake.createRoom as ReturnType<typeof vi.fn>).mockResolvedValue({ room_id: "!new2" });

    await matrix.startDirectMessage("@jdoe:mako");
    expect(fake.setAccountData).toHaveBeenCalledWith("m.direct", {
      "@jdoe:mako": ["!old", "!new2"],
    });
  });
});

describe("stopSync", () => {
  it("stops the client and detaches listeners", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);

    matrix.stopSync();
    expect(fake.stopClient).toHaveBeenCalled();
    expect(listenerCount(fake, "sync")).toBe(0);
    expect(listenerCount(fake, "Room.timeline")).toBe(0);
  });
});
