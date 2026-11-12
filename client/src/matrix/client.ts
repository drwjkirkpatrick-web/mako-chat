// ⭐ THE Matrix boundary — the ONLY file allowed to import matrix-js-sdk.
//
// WHY (PLAN D9): the SDK's API changes between releases. Every other file
// talks to the functions below using OUR types, so an SDK upgrade is a change
// to this one file — never a hunt through the whole app.
//
// Teaching map:
//   login()          — trade username+password for a session
//   restoreSession() — resume a saved session at app start
//   logout()         — end the session (server + local)
//   normalizeBaseUrl — tidy what the user typed into a real URL

import {
  ClientEvent,
  EventType,
  Preset,
  RoomEvent,
  SyncState,
  createClient,
  type SyncStateData,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";

export interface MakoSession {
  /** Server address, normalized (http://…, no trailing slash). */
  baseUrl: string;
  /** Full Matrix user ID, e.g. "@jdoe:mako". */
  userId: string;
  /** Secret the server issued at login — treat it like a password. */
  accessToken: string;
  /** Which device this install is (the server-side session handle). */
  deviceId: string;
}

const SESSION_KEY = "mako.session";
const SERVER_KEY = "mako.serverUrl";
const DEVICE_NAME = "MAKO CHAT desktop";

// The one live SDK client (null = logged out). Private on purpose: the app
// reaches Matrix ONLY through the functions below.
let client: MatrixClient | null = null;
let session: MakoSession | null = null;

/** Remember which server the user logged into, for next launch's default. */
export function rememberServerUrl(url: string): void {
  localStorage.setItem(SERVER_KEY, url);
}

export function lastServerUrl(): string {
  return localStorage.getItem(SERVER_KEY) ?? "http://mako-server:8008";
}

/**
 * Tidy what the user typed: allow "mako-server:8008" as shorthand for
 * "http://mako-server:8008"; ignore trailing slashes and stray whitespace.
 * Pure function — the unit tests cover it with no mocking at all.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (url.length === 0) return url;
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  return url.replace(/\/+$/, "");
}

/**
 * Log in against the institution's server.
 * NOTE: a FRESH client per attempt — a failed login never leaves a
 * half-initialized client behind.
 */
export async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<MakoSession> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized || !username || !password) {
    throw new Error("Server, username and password are all required.");
  }
  const matrix = createClient({ baseUrl: normalized });
  try {
    return await doLogin(matrix, normalized, username, password);
  } catch (err) {
    // HYGIENE: a failed login leaves nothing behind — no half-built client,
    // no stale session. The next attempt starts from a clean slate.
    client = null;
    session = null;
    throw err;
  }
}

/** The handshake itself, split out so login()'s error handling stays readable. */
async function doLogin(
  matrix: MatrixClient,
  normalized: string,
  username: string,
  password: string,
): Promise<MakoSession> {
  {
  // The generic login() sends the exact body the Matrix spec defines —
  // including initial_device_display_name, so the server's device list
  // shows "MAKO CHAT desktop". On success it arms this client with the
  // returned access token.
  // NOTE (SDK 45): loginWithPassword(user, password) exists but cannot set
  // the device display name — the generic form is the full-featured one.
  const response = await matrix.login("m.login.password", {
    identifier: { type: "m.id.user", user: username },
    password,
    initial_device_display_name: DEVICE_NAME,
  });

  const whoami: MakoSession = {
    baseUrl: normalized,
    // NOTE (SDK 45): login() never assigns the client's deviceId (only the
    // constructor does), so read it from the login response — the source
    // of truth, and a required field per the spec.
    userId: response.user_id,
    accessToken: response.access_token,
    deviceId: response.device_id,
  };
  if (!whoami.userId || !whoami.accessToken || !whoami.deviceId) {
    throw new Error("The server did not return a complete session.");
  }
  client = matrix;
  session = whoami;
  rememberServerUrl(normalized);
  localStorage.setItem(SESSION_KEY, JSON.stringify(whoami));
  return whoami;
  }
}

/**
 * Resume a previous session at app start (null if none saved / corrupted).
 * NOTE: no server call happens here — if the token turns out to be dead,
 * the first real request (Batch 3's sync) will say so and we sign out then.
 */
export function restoreSession(): MakoSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as MakoSession;
    if (!saved.baseUrl || !saved.userId || !saved.accessToken) return null;
    client = createClient({
      baseUrl: saved.baseUrl,
      accessToken: saved.accessToken,
      userId: saved.userId,
      deviceId: saved.deviceId,
    });
    session = saved;
    return saved;
  } catch {
    return null; // unreadable storage = treat as logged out
  }
}

/** End the session: kill the token server-side, then forget it locally. */
export async function logout(): Promise<void> {
  try {
    stopSync(); // a session ends with its sync loop
    await client?.logout(); // server-side: the token stops working
  } finally {
    localStorage.removeItem(SESSION_KEY); // local: forget regardless
    client = null;
    session = null;
  }
}

/** Who is logged in right now (pure local lookup, no server call). */
export function currentSession(): MakoSession | null {
  return session;
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGING (Batch 3): the sync loop, rooms, messages.
//
// The sync loop is the heart of the app: one long-lived request to the
// server that streams every new event. The SDK manages the polling and
// retries; we translate its events into the four signals the UI needs.
// ═════════════════════════════════════════════════════════════════════════

/** The app's simplified connection states (SDK states map onto these). */
export type MakoSyncState =
  | "connecting" // starting up — no verdict yet
  | "live" // connected and receiving events
  | "offline" // connection trouble; the SDK keeps retrying on its own
  | "fatal"; // the SESSION is dead (e.g. revoked token) — sign out

/** A conversation, as the UI sees it (never a raw SDK Room). */
export interface MakoRoom {
  roomId: string;
  name: string;
  isDirect: boolean;
  membersCount: number;
  lastActivityTs: number; // ms epoch; 0 = no messages yet
  preview: string;
}

/** One chat message, as the UI sees it. */
export interface MakoMessage {
  eventId: string;
  senderId: string;
  senderName: string;
  body: string;
  ts: number;
  isMine: boolean;
}

/** Everything the UI wants to know about while syncing. */
export interface MakoSyncCallbacks {
  onStateChange(state: MakoSyncState): void;
  onRoomsChanged(): void;
  onRoomUpdated(roomId: string): void;
}

// Module state for the sync section (private, like `client` above).
let syncRunning = false;
let syncCallbacks: MakoSyncCallbacks | null = null;
let dmRoomIds: Set<string> = new Set();

/**
 * Start the sync loop. Call once after login/restore, exactly once.
 * NOTE: on the FIRST successful sync the SDK fires SyncState.Prepared —
 * we use that moment to fetch the DM list and refresh the room list.
 */
export async function startSync(cb: MakoSyncCallbacks): Promise<void> {
  if (!client) throw new Error("Cannot sync before logging in.");
  if (syncRunning) return; // one loop, ever
  syncRunning = true;
  syncCallbacks = cb;

  client.on(ClientEvent.Sync, onSyncState);
  client.on(ClientEvent.Room, onNewRoom);
  client.on(RoomEvent.Timeline, onTimelineEvent);
  client.on(RoomEvent.Name, onNewRoomName);
  client.on(ClientEvent.AccountData, onAccountData);

  // initialSyncLimit: how much recent history the server sends on the
  // FIRST sync. 30 rooms' worth is plenty for institutional chat.
  await client.startClient({ initialSyncLimit: 30 });
  cb.onStateChange("connecting");
}

/**
 * The SDK's sync verdicts, translated. (Values verified against the
 * installed SDK 45 types — SyncState is a string enum.)
 */
async function onSyncState(
  state: SyncState,
  _prev: SyncState | null,
  data?: SyncStateData,
): Promise<void> {
  if (state === SyncState.Prepared) {
    await refreshDmMap();
    syncCallbacks?.onRoomsChanged();
    syncCallbacks?.onStateChange("live");
  } else if (state === SyncState.Syncing) {
    syncCallbacks?.onStateChange("live");
  } else if (state === SyncState.Error) {
    // WHY the peek: sync errors are usually transient (network), but a dead
    // token is permanent — the UI must sign out instead of retrying forever.
    const errcode = (data?.error as { errcode?: string } | undefined)?.errcode;
    if (errcode === "M_UNKNOWN_TOKEN" || errcode === "M_MISSING_TOKEN") {
      const cb = syncCallbacks; // stopSync() clears syncCallbacks — grab it first
      stopSync();
      cb?.onStateChange("fatal");
      return;
    }
    syncCallbacks?.onStateChange("offline");
  } else {
    // Catchup / Reconnecting / Stopped
    syncCallbacks?.onStateChange("offline");
  }
}

function onNewRoom(_room: Room): void {
  syncCallbacks?.onRoomsChanged();
}

function onNewRoomName(_room: Room): void {
  syncCallbacks?.onRoomsChanged();
}

/**
 * Any timeline event (messages, but also memberships, redactions…).
 * We tell the UI "this room changed", and let the room list re-read.
 */
function onTimelineEvent(event: MatrixEvent, room: Room | undefined): void {
  if (!room) return;
  if (event.getType() === "m.room.message") {
    syncCallbacks?.onRoomUpdated(room.roomId);
  }
  syncCallbacks?.onRoomsChanged(); // preview + ordering may have moved
}

/** Account data changed — we only care about the DM map (m.direct). */
function onAccountData(event: MatrixEvent): void {
  if (event.getType() === "m.direct") void refreshDmMap();
}

async function refreshDmMap(): Promise<void> {
  const map = await client?.getAccountDataFromServer(EventType.Direct);
  const next = new Set<string>();
  if (map) {
    for (const roomIds of Object.values(map)) {
      for (const id of roomIds) next.add(id);
    }
  }
  dmRoomIds = next;
}

/** Stop the loop and detach every listener. Safe to call twice.
 * NOTE: a no-op when the loop never started — logging out before ever
 * syncing (or after already stopping) must not touch the client.
 */
export function stopSync(): void {
  if (!client || !syncRunning) return;
  client.stopClient();
  client.off(ClientEvent.Sync, onSyncState);
  client.off(ClientEvent.Room, onNewRoom);
  client.off(RoomEvent.Timeline, onTimelineEvent);
  client.off(RoomEvent.Name, onNewRoomName);
  client.off(ClientEvent.AccountData, onAccountData);
  syncRunning = false;
  syncCallbacks = null;
}

/** All joined conversations, most recently active first. */
export function listRooms(): MakoRoom[] {
  if (!client || !session) return [];
  const rooms = client.getRooms().filter((r) => r.getMyMembership() === "join");
  const mapped = rooms.map(toMakoRoom);
  mapped.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
  return mapped;
}

function isBadRoomName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "" || n === "unnamed room" || n === "empty room";
}

function toMakoRoom(room: Room): MakoRoom {
  const joined = room.getJoinedMembers();
  // WHY the fallback in the DM test: the creator marks m.direct, but the
  // OTHER side of a fresh DM has no account data yet — Element uses the
  // same "two people" heuristic. Two-member rooms = DMs in our world.
  const isDirect = dmRoomIds.has(room.roomId) || joined.length === 2;
  const msgs = timelineMessages(room);
  const last = msgs[msgs.length - 1];
  return {
    roomId: room.roomId,
    name: displayNameFor(room, isDirect),
    isDirect,
    membersCount: joined.length,
    lastActivityTs: last ? last.ts : 0,
    preview: last ? `${last.senderName}: ${last.body}`.slice(0, 60) : "No messages yet",
  };
}

/** People expect a DM to be NAMED after the other person — make it so. */
function displayNameFor(room: Room, isDirect: boolean): string {
  if (isDirect) {
    const others = room
      .getJoinedMembers()
      .filter((m) => m.userId !== session?.userId);
    if (others.length > 0 && others[0].name) return others[0].name;
  }
  if (isBadRoomName(room.name)) return room.roomId;
  return room.name;
}

/** Translate a room's live timeline into MakoMessages (chat texts only). */
function timelineMessages(room: Room): MakoMessage[] {
  const out: MakoMessage[] = [];
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== "m.room.message") continue; // skip joins, redactions…
    const content = ev.getContent() as { msgtype?: string; body?: string };
    if (!content.body) continue;
    const senderId = ev.getSender() ?? "";
    out.push({
      eventId: ev.getId() ?? `${ev.localTimestamp}`,
      senderId,
      senderName: room.getMember(senderId)?.name ?? senderId,
      body: content.body,
      ts: ev.localTimestamp,
      isMine: senderId === session?.userId,
    });
  }
  return out;
}

/** The chat window for one room (newest last, capped for sanity). */
export function getMessages(roomId: string, limit = 200): MakoMessage[] {
  const room = client?.getRoom(roomId);
  if (!room) return [];
  return timelineMessages(room).slice(-limit);
}

/** Send a chat message. The SDK's local echo makes it appear instantly. */
export async function sendText(roomId: string, body: string): Promise<void> {
  if (!client) throw new Error("Not signed in.");
  const text = body.trim();
  if (!text) return;
  await client.sendTextMessage(roomId, text);
}

/**
 * Start a one-to-one conversation (spec: "Private one-to-one conversations").
 * Creates a small private room, invites the other member, and flags it as a
 * DM in account data (that flag drives the DM badge and naming everywhere).
 */
export async function startDirectMessage(otherUserId: string): Promise<string> {
  if (!client) throw new Error("Not signed in.");
  // trusted_private_chat preset: private room, invitees may speak.
  const { room_id } = await client.createRoom({
    preset: Preset.TrustedPrivateChat,
    invite: [otherUserId],
    is_direct: true,
  });
  const dm = (await client.getAccountDataFromServer(EventType.Direct)) ?? {};
  const existing = dm[otherUserId] ?? [];
  dm[otherUserId] = [...existing, room_id];
  await client.setAccountData(EventType.Direct, dm);
  return room_id;
}
