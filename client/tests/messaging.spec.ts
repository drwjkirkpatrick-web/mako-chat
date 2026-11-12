import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { MatrixClient, Room } from "matrix-js-sdk";

// The whole SDK is mocked: these tests check OUR translation layer, never
// the SDK's. (SDK drift is caught by `npm run typecheck` against real types.)
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
    sendMessage: vi.fn().mockResolvedValue({}),
    uploadContent: vi.fn(async (_file: File, opts?: {
      progressHandler?: (p: { loaded: number; total: number }) => void;
    }) => {
      opts?.progressHandler?.({ loaded: 500, total: 1000 });
      return { content_uri: "mxc://mako/abc" };
    }),
    mxcUrlToHttp: vi.fn(
      (url: string, w?: number) => `http://s/media/${w ? "thumb" : "full"}/${url}`,
    ),
    createRoom: vi.fn().mockResolvedValue({ room_id: "!new" }),
    getAccountDataFromServer: vi.fn().mockResolvedValue(null),
    setAccountData: vi.fn().mockResolvedValue({}),
    setPresence: vi.fn().mockResolvedValue(undefined),
    getProfileInfo: vi.fn().mockResolvedValue({
      displayname: "Walker",
      avatar_url: "mxc://mako/av1",
    }),
    setDisplayName: vi.fn().mockResolvedValue({}),
    setAvatarUrl: vi.fn().mockResolvedValue({}),
    sendTyping: vi.fn().mockResolvedValue({}),
    sendReadReceipt: vi.fn().mockResolvedValue({}),
    getUser: vi.fn(() => null),
  });
  return fake as unknown as MatrixClient;
}

/** A fake room with a few timeline events. */
function makeFakeRoom(roomId: string, opts: {
  name?: string;
  joined?: string[];
  messages?: Array<{
    sender: string;
    body: string;
    ts: number;
    msgtype?: string;
    url?: string;
    info?: { mimetype?: string; size?: number };
  }>;
  membership?: string;
  typing?: string[];
  avatars?: Record<string, string>;
  receipts?: Record<string, { eventId: string; data: { ts: number } }>;
} = {}): Room {
  const joined = opts.joined ?? [ME];
  const events = (opts.messages ?? []).map((m, i) => ({
    getType: () => "m.room.message",
    getSender: () => m.sender,
    getContent: () => ({
      msgtype: m.msgtype ?? "m.text",
      body: m.body,
      url: m.url,
      info: m.info,
    }),
    getId: () => "$ev" + i,
    localTimestamp: m.ts,
  }));
  const room = {
    roomId,
    name: opts.name ?? "Some Room",
    getMyMembership: () => opts.membership ?? "join",
    getJoinedMembers: () =>
      joined.map((id) => ({
        userId: id,
        name: id.replace(/^@/, "").split(":")[0],
        typing: (opts.typing ?? []).includes(id),
        getMxcAvatarUrl: () => (opts.avatars ?? {})[id] ?? null,
      })),
    getMember: (id: string) => ({ userId: id, name: id.replace(/^@/, "").split(":")[0] }),
    getLiveTimeline: () => ({ getEvents: () => events }),
    getReadReceiptForUserId: (uid: string) => opts.receipts?.[uid] ?? null,
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

describe("presence (Batch 4)", () => {
  it("announces online when the loop starts and offline when it stops", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);
    expect(fake["setPresence"]).toHaveBeenCalledWith({ presence: "online" });

    matrix.stopSync();
    expect(fake["setPresence"]).toHaveBeenCalledWith({ presence: "offline" });
  });

  it("exposes the other member's presence and reacts to presence events", async () => {
    const fake = makeFakeClient();
    (fake.getUser as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => (id === "@jdoe:mako" ? { userId: id, presence: "online" } : null),
    );
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);

    const rooms = matrix.listRooms();
    expect(rooms[0].otherPresence).toBe("online");
    expect(matrix.getPresenceOf("@nobody:mako")).toBe("unknown"); // no data

    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);
    fire(fake, "User.presence", undefined, { userId: "@jdoe:mako" });
    await vi.waitFor(() => expect(cb.onRoomsChanged).toHaveBeenCalled());
  });
});

describe("typing (Batch 4)", () => {
  it("shows typing members in the room preview and relays typing events", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"], typing: ["@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);

    const rooms = matrix.listRooms();
    expect(rooms[0].typingNames).toEqual(["jdoe"]);
    expect(rooms[0].preview).toBe("jdoe is typing…");

    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);
    fire(fake, "RoomMember.typing", undefined, { roomId: "!dm", userId: "@jdoe:mako", typing: true });
    expect(cb.onRoomUpdated).toHaveBeenCalledWith("!dm");
  });

  it("never lists me as typing", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"], typing: [ME] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    expect(matrix.listRooms()[0].typingNames).toEqual([]);
  });

  it("sends typing with a 10 s server timeout", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    await matrix.sendTyping("!dm", true);
    expect(fake["sendTyping"]).toHaveBeenCalledWith("!dm", true, 10000);
  });
});

describe("read receipts (Batch 4)", () => {
  it("marks a room read at its newest event, publicly", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", {
      joined: [ME, "@jdoe:mako"],
      messages: [{ sender: "@jdoe:mako", body: "latest", ts: 5 }],
    });
    (fake.getRoom as ReturnType<typeof vi.fn>).mockReturnValue(room);
    await loginWithFake(fake);

    await matrix.markRoomRead("!dm");
    const events = room.getLiveTimeline().getEvents();
    expect(fake["sendReadReceipt"]).toHaveBeenCalledWith(events[events.length - 1], "m.read", true);
  });

  it("collects other members' receipts, never mine", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", {
      joined: [ME, "@jdoe:mako"],
      receipts: { "@jdoe:mako": { eventId: "$ev1", data: { ts: 55 } } },
    });
    (fake.getRoom as ReturnType<typeof vi.fn>).mockReturnValue(room);
    await loginWithFake(fake);

    const receipts = matrix.getRoomReceipts("!dm");
    expect(receipts).toEqual([{ userId: "@jdoe:mako", eventId: "$ev1", ts: 55 }]);
  });

  it("relays receipt events to the room they belong to", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    const cb = { onStateChange: vi.fn(), onRoomsChanged: vi.fn(), onRoomUpdated: vi.fn() };
    await matrix.startSync(cb);

    fire(fake, "Room.receipt", { getType: () => "m.receipt" }, room);
    expect(cb.onRoomUpdated).toHaveBeenCalledWith("!dm");
  });
});

describe("file sharing (Batch 5)", () => {
  it("uploads, reports progress, and sends an image message", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const progress = vi.fn();
    const file = new File(["x"], "photo.png", { type: "image/png" });

    await matrix.sendFile("!r1", file, progress);

    expect(fake["uploadContent"]).toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(50); // 500 of 1000 bytes
    expect(fake["sendMessage"]).toHaveBeenCalledWith("!r1", {
      msgtype: "m.image",
      body: "photo.png",
      url: "mxc://mako/abc",
      info: { mimetype: "image/png", size: file.size },
    });
  });

  it("sends non-images as downloadable m.file messages", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const file = new File(["%PDF"], "doc.pdf", { type: "application/pdf" });

    await matrix.sendFile("!r1", file);

    expect(fake["sendMessage"]).toHaveBeenCalledWith("!r1", {
      msgtype: "m.file",
      body: "doc.pdf",
      url: "mxc://mako/abc",
      info: { mimetype: "application/pdf", size: file.size },
    });
  });

  it("maps image/file timeline events into kinds with media metadata", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!r1", {
      joined: [ME, "@jdoe:mako"],
      messages: [
        {
          sender: "@jdoe:mako", body: "look.png", ts: 1, msgtype: "m.image",
          url: "mxc://mako/i1", info: { mimetype: "image/png", size: 100 },
        },
        {
          sender: "@jdoe:mako", body: "doc.pdf", ts: 2, msgtype: "m.file",
          url: "mxc://mako/f1", info: { mimetype: "application/pdf", size: 2048 },
        },
        { sender: "@jdoe:mako", body: "plain", ts: 3 },
      ],
    });
    (fake.getRoom as ReturnType<typeof vi.fn>).mockReturnValue(room);
    await loginWithFake(fake);

    const msgs = matrix.getMessages("!r1");
    expect(msgs[0].kind).toBe("image");
    expect(msgs[0].mxcUrl).toBe("mxc://mako/i1");
    expect(msgs[0].mimetype).toBe("image/png");
    expect(msgs[1].kind).toBe("file");
    expect(msgs[1].size).toBe(2048);
    expect(msgs[2].kind).toBe("text");
  });

  it("resolves mxc URLs to http (thumbnails and full size)", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    expect(matrix.mxcToHttp("mxc://mako/abc")).toBe("http://s/media/full/mxc://mako/abc");
    expect(matrix.mxcToHttp("mxc://mako/abc", 480, 480)).toBe(
      "http://s/media/thumb/mxc://mako/abc",
    );
  });

  it("returns null for mxc URLs when not signed in", async () => {
    await matrix.logout();
    expect(matrix.mxcToHttp("mxc://mako/abc")).toBeNull();
  });
});

describe("my profile (Batch 6)", () => {
  it("loads the profile fresh from the server", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    expect(await matrix.getMyProfile()).toEqual({
      displayName: "Walker",
      avatarMxc: "mxc://mako/av1",
    });
  });

  it("sets a display name (trimmed; rejects empty)", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    await matrix.setMyDisplayName("  Walker K.  ");
    expect(fake["setDisplayName"]).toHaveBeenCalledWith("Walker K.");
    await expect(matrix.setMyDisplayName("   ")).rejects.toBeTruthy();
  });

  it("uploads an avatar, then points the profile at it (images only)", async () => {
    const fake = makeFakeClient();
    await loginWithFake(fake);
    const file = new File(["x"], "me.png", { type: "image/png" });
    await matrix.setMyAvatar(file);
    expect(fake["uploadContent"]).toHaveBeenCalled();
    expect(fake["setAvatarUrl"]).toHaveBeenCalledWith("mxc://mako/abc");

    const pdf = new File(["x"], "me.pdf", { type: "application/pdf" });
    await expect(matrix.setMyAvatar(pdf)).rejects.toBeTruthy();
  });
});

describe("incoming messages (Batch 6)", () => {
  it("hands other people's messages to the app for notifications", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    const cb = {
      onStateChange: vi.fn(),
      onRoomsChanged: vi.fn(),
      onRoomUpdated: vi.fn(),
      onIncomingMessage: vi.fn(),
    };
    await matrix.startSync(cb);

    fire(fake, "Room.timeline", {
      getType: () => "m.room.message",
      getSender: () => "@jdoe:mako",
      getContent: () => ({ msgtype: "m.text", body: "hi there" }),
      getId: () => "$n1",
      localTimestamp: 99,
    }, room);

    expect(cb.onIncomingMessage).toHaveBeenCalledWith("!dm", "jdoe", "jdoe", "hi there");
  });

  it("never notifies about my own messages", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    const cb = {
      onStateChange: vi.fn(),
      onRoomsChanged: vi.fn(),
      onRoomUpdated: vi.fn(),
      onIncomingMessage: vi.fn(),
    };
    await matrix.startSync(cb);

    fire(fake, "Room.timeline", {
      getType: () => "m.room.message",
      getSender: () => ME,
      getContent: () => ({ msgtype: "m.text", body: "my own echo" }),
      getId: () => "$n2",
      localTimestamp: 100,
    }, room);

    expect(cb.onIncomingMessage).not.toHaveBeenCalled();
  });
});

describe("DM avatars (Batch 6)", () => {
  it("exposes the other member's avatar on DM rooms", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", {
      joined: [ME, "@jdoe:mako"],
      avatars: { "@jdoe:mako": "mxc://mako/jd" },
    });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    expect(matrix.listRooms()[0].otherAvatarMxc).toBe("mxc://mako/jd");
  });

  it("stays undefined when the other member has no picture", async () => {
    const fake = makeFakeClient();
    const room = makeFakeRoom("!dm", { joined: [ME, "@jdoe:mako"] });
    (fake.getRooms as ReturnType<typeof vi.fn>).mockReturnValue([room]);
    await loginWithFake(fake);
    expect(matrix.listRooms()[0].otherAvatarMxc).toBeUndefined();
  });
});
