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

import { createClient, type MatrixClient } from "matrix-js-sdk";

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
