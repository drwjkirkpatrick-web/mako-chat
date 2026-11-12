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
  ReceiptType,
  RoomEvent,
  RoomMemberEvent,
  SyncState,
  UserEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type SyncStateData,
  type User,
} from "matrix-js-sdk";

// NOTE: the SDK's RoomMessageEventContent is not root-exported, and its
// sendMessage has overloads that make `Parameters<>` extraction fragile.
// Our content literal matches the Matrix spec exactly (msgtype/body/url/
// info), and the unit tests pin that shape — so we satisfy the parameter
// with a single deliberate cast at the call site below.

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
  /** The OTHER member's presence — DMs only; "unknown" for groups. */
  otherPresence: MakoPresence;
  /** The OTHER member's avatar (mxc) when we have one — DMs only. */
  otherAvatarMxc?: string;
  /** Display names of members typing right now (never includes me). */
  typingNames: string[];
}

/** My own profile: the name and picture other members see. */
export interface MakoProfile {
  displayName: string;
  avatarMxc?: string;
}

/** A member's presence, simplified. "unknown" = we have no data yet. */
export type MakoPresence = "online" | "offline" | "unavailable" | "unknown";

/** Where another member's read receipt points (they read up to this event). */
export interface MakoReceipt {
  userId: string;
  eventId: string;
  ts: number;
}

/**
 * One chat message, as the UI sees it. `kind` tells the renderer which
 * shape to draw: plain text, an inline image, or a downloadable file.
 * For image/file messages, `body` is the FILE NAME.
 */
export interface MakoMessage {
  eventId: string;
  senderId: string;
  senderName: string;
  body: string;
  ts: number;
  isMine: boolean;
  kind: "text" | "image" | "file";
  /** mxc:// URL — present for image/file messages. */
  mxcUrl?: string;
  mimetype?: string;
  /** File size in bytes, when the server told us. */
  size?: number;
}

/** Everything the UI wants to know about while syncing. */
export interface MakoSyncCallbacks {
  onStateChange(state: MakoSyncState): void;
  onRoomsChanged(): void;
  onRoomUpdated(roomId: string): void;
  /**
   * A message arrived from SOMEONE ELSE (Batch 6). The app decides what to
   * do with it — MAKO shows a desktop notification for rooms the user is
   * not currently looking at.
   */
  onIncomingMessage?(roomId: string, roomName: string, senderName: string, body: string): void;
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
  client.on(RoomEvent.Receipt, onReceipt);
  client.on(RoomMemberEvent.Typing, onMemberTyping);
  client.on(UserEvent.Presence, onUserPresence);

  // initialSyncLimit: how much recent history the server sends on the
  // FIRST sync. 30 rooms' worth is plenty for institutional chat.
  await client.startClient({ initialSyncLimit: 30 });
  // Tell the world we're here (Batch 4: presence). Fire-and-forget —
  // presence is a courtesy, never a gate; failure must not block syncing.
  void client.setPresence({ presence: "online" }).catch(() => {});
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
    // Batch 6: hand incoming messages from OTHERS to the app (for desktop
    // notifications). Our own messages never notify.
    const senderId = event.getSender();
    const content = event.getContent() as { body?: string };
    if (senderId && senderId !== session?.userId && content.body) {
      const senderName = room.getMember(senderId)?.name ?? senderId;
      const isDirect = dmRoomIds.has(room.roomId) || room.getJoinedMembers().length === 2;
      syncCallbacks?.onIncomingMessage?.(
        room.roomId,
        displayNameFor(room, isDirect),
        senderName,
        content.body,
      );
    }
  }
  syncCallbacks?.onRoomsChanged(); // preview + ordering may have moved
}

/** Account data changed — we only care about the DM map (m.direct). */
function onAccountData(event: MatrixEvent): void {
  if (event.getType() === "m.direct") void refreshDmMap();
}

/** Read receipts moved — someone caught up on this room (Batch 4). */
function onReceipt(_event: MatrixEvent, room: Room): void {
  syncCallbacks?.onRoomUpdated(room.roomId);
}

/** A member started or stopped typing in a room (Batch 4). */
function onMemberTyping(_event: MatrixEvent, member: RoomMember): void {
  syncCallbacks?.onRoomUpdated(member.roomId);
}

/** Someone's presence (online/offline) changed (Batch 4). */
function onUserPresence(_event: MatrixEvent | undefined, _user: User): void {
  syncCallbacks?.onRoomsChanged(); // refresh the presence dots
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
  // Courtesy (Batch 4): tell the world we're gone BEFORE pulling the plug.
  // If the connection is already dead this throws into the void — fine.
  try {
    void client.setPresence({ presence: "offline" }).catch(() => {});
  } catch {
    /* pre-Batch-4 test fakes may not implement setPresence — harmless */
  }
  client.stopClient();
  client.off(ClientEvent.Sync, onSyncState);
  client.off(ClientEvent.Room, onNewRoom);
  client.off(RoomEvent.Timeline, onTimelineEvent);
  client.off(RoomEvent.Name, onNewRoomName);
  client.off(ClientEvent.AccountData, onAccountData);
  client.off(RoomEvent.Receipt, onReceipt);
  client.off(RoomMemberEvent.Typing, onMemberTyping);
  client.off(UserEvent.Presence, onUserPresence);
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
  const others = joined.filter((m) => m.userId !== session?.userId);
  // WHY the fallback in the DM test: the creator marks m.direct, but the
  // OTHER side of a fresh DM has no account data yet — Element uses the
  // same "two people" heuristic. Two-member rooms = DMs in our world.
  const isDirect = dmRoomIds.has(room.roomId) || joined.length === 2;
  const msgs = timelineMessages(room);
  const last = msgs[msgs.length - 1];
  const typingNames = joined
    .filter((m) => m.typing && m.userId !== session?.userId)
    .map((m) => m.name);
  return {
    roomId: room.roomId,
    name: displayNameFor(room, isDirect),
    isDirect,
    membersCount: joined.length,
    // DMs show the OTHER person's presence dot; groups have no single dot.
    otherPresence:
      isDirect && others.length > 0 ? getPresenceOf(others[0].userId) : "unknown",
    otherAvatarMxc: isDirect ? (others[0]?.getMxcAvatarUrl() ?? undefined) : undefined,
    typingNames,
    lastActivityTs: last ? last.ts : 0,
    preview: typingNames.length > 0
      ? typingPreview(typingNames)
      : last
        ? `${last.senderName}: ${last.body}`.slice(0, 60)
        : "No messages yet",
  };
}

/** "jdoe is typing…" / "jdoe, ana are typing…" for the room preview. */
function typingPreview(names: string[]): string {
  return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} typing…`;
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
    const content = ev.getContent() as {
      msgtype?: string;
      body?: string;
      url?: string;
      info?: { mimetype?: string; size?: number };
    };
    if (!content.body) continue;
    const senderId = ev.getSender() ?? "";
    // A message with an mxc:// URL carries media. Images render inline;
    // everything else renders as a downloadable card.
    const hasMedia = typeof content.url === "string" && content.url.startsWith("mxc://");
    const kind: MakoMessage["kind"] =
      hasMedia && content.msgtype === "m.image" ? "image" : hasMedia ? "file" : "text";
    out.push({
      eventId: ev.getId() ?? `${ev.localTimestamp}`,
      senderId,
      senderName: room.getMember(senderId)?.name ?? senderId,
      body: content.body,
      ts: ev.localTimestamp,
      isMine: senderId === session?.userId,
      kind,
      mxcUrl: hasMedia ? content.url : undefined,
      mimetype: content.info?.mimetype,
      size: content.info?.size,
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

// ═══════════════════════════════════════════════════════════════════════════
// PRESENCE / TYPING / READ RECEIPTS (Batch 4).
// All three are "lightweight social signals" — small, fire-and-forget
// server updates with no delivery guarantees. The UI treats them as
// hints, never as facts.
// ═════════════════════════════════════════════════════════════════════════

/** Someone's presence from the local cache — no server call, no waiting. */
export function getPresenceOf(userId: string): MakoPresence {
  const p = client?.getUser(userId)?.presence;
  if (p === "online" || p === "unavailable" || p === "offline") return p;
  return "unknown"; // no data yet, or the SDK gave us something unexpected
}

/** Announce MY presence (used automatically by the sync loop). */
export async function setMyPresence(presence: "online" | "offline"): Promise<void> {
  if (!client) return;
  await client.setPresence({ presence });
}

/**
 * Tell the room I am / am no longer typing. The 10-second timeout means
 * the server forgets on its own if we never send the "stopped" signal
 * (crash, window closed) — no stuck "typing…" ghosts.
 */
export async function sendTyping(roomId: string, isTyping: boolean): Promise<void> {
  if (!client) return;
  await client.sendTyping(roomId, isTyping, 10_000);
}

/**
 * Mark everything in the room as read: sends a public read receipt at the
 * room's newest event. Public (m.read, not the private variant) so the
 * people we chat with can show "Seen".
 */
export async function markRoomRead(roomId: string): Promise<void> {
  const room = client?.getRoom(roomId);
  if (!room) return;
  const events = room.getLiveTimeline().getEvents();
  const last = events[events.length - 1];
  if (!last) return;
  await client?.sendReadReceipt(last, ReceiptType.Read, true);
}

/**
 * Where each other member's read receipt points, right now — the data
 * behind "Seen". My own receipt is deliberately left out.
 */
export function getRoomReceipts(roomId: string): MakoReceipt[] {
  const room = client?.getRoom(roomId);
  if (!room || !session) return [];
  const out: MakoReceipt[] = [];
  for (const member of room.getJoinedMembers()) {
    if (member.userId === session.userId) continue;
    const receipt = room.getReadReceiptForUserId(member.userId, false, ReceiptType.Read);
    if (receipt) out.push({ userId: member.userId, eventId: receipt.eventId, ts: receipt.data.ts });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE SHARING (Batch 5): upload → send → render → download.
// Two-step model, same as every Matrix client:
//   1. the BYTES go to the server's media repository (returns mxc://…)
//   2. the room receives a small message pointing at those bytes
// ═════════════════════════════════════════════════════════════════════════

/**
 * Share a file with a room. Images (image/*) are sent as m.image so they
 * render inline; everything else becomes a downloadable m.file card.
 * `onProgress` receives 0–100 as the upload streams.
 */
export async function sendFile(
  roomId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!client) throw new Error("Not signed in.");
  // Step 1: park the bytes in the media repository.
  const { content_uri } = await client.uploadContent(file, {
    name: file.name,
    type: file.type,
    progressHandler: onProgress
      ? (p) => onProgress(p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0)
      : undefined,
  });
  // Step 2: tell the room where the bytes live.
  const isImage = file.type.startsWith("image/");
  const content = {
    msgtype: isImage ? "m.image" : "m.file",
    body: file.name,
    url: content_uri,
    info: { mimetype: file.type, size: file.size },
  };
  await client.sendMessage(roomId, content as never);
}

/**
 * Turn an mxc:// media URL into the http URL the UI can load.
 * Width/height (for image thumbnails) ask the server to SCALE a copy —
 * omitting them returns the full-size original (used for downloads).
 * NOTE: null when not signed in or the URL is malformed.
 */
export function mxcToHttp(mxcUrl: string, width?: number, height?: number): string | null {
  if (!client) return null;
  const url = client.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    width !== undefined ? "scale" : undefined,
  );
  return url ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MY PROFILE (Batch 6): the name and picture other members see.
// The server is the source of truth; the local cache can lag after edits.
// ═════════════════════════════════════════════════════════════════════════

/** Fetch my profile fresh from the server. */
export async function getMyProfile(): Promise<MakoProfile> {
  if (!client || !session) throw new Error("Not signed in.");
  const info = await client.getProfileInfo(session.userId);
  return { displayName: info.displayname ?? "", avatarMxc: info.avatar_url };
}

/** Change the display name other members see. */
export async function setMyDisplayName(name: string): Promise<void> {
  if (!client) throw new Error("Not signed in.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Display name cannot be empty.");
  await client.setDisplayName(trimmed);
}

/**
 * Replace my profile picture: upload the image bytes to the media
 * repository, then point my profile at the new mxc:// URL.
 */
export async function setMyAvatar(file: File, onProgress?: (pct: number) => void): Promise<void> {
  if (!client) throw new Error("Not signed in.");
  if (!file.type.startsWith("image/")) {
    throw new Error("Profile pictures must be images.");
  }
  const { content_uri } = await client.uploadContent(file, {
    name: file.name,
    type: file.type,
    progressHandler: onProgress
      ? (p) => onProgress(p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0)
      : undefined,
  });
  await client.setAvatarUrl(content_uri);
}
