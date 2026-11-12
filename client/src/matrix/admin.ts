// ⭐ The Synapse ADMIN API layer (Batch 7 — PLAN D3).
//
// The Admin API is Synapse-specific: it is NOT part of the Matrix spec, so
// matrix-js-sdk does not wrap it. We speak plain fetch with the signed-in
// admin's access token. All endpoint shapes verified against the Synapse
// admin API docs (develop branch, v1.16x).
//
// TEACHING MAP:
//   amIAdmin()          — "may this user open the dashboard?"
//   listUsers()         — every account, suspended ones included
//   createUser()        — administrator-controlled account creation
//   setUserSuspended()  — reversible suspension (NOT the destructive erase)
//   resetUserPassword() — set a new password, log out their devices
//   listRooms()         — room overview
//   getStorageStats()   — media usage + server version

import { adminCredentials } from "./client";

// ── our shapes (never raw JSON) ─────────────────────────────────────────────

export interface AdminUser {
  userId: string;
  displayName?: string;
  isAdmin: boolean;
  /** Suspended = Synapse "deactivated" flag. REVERSIBLE — not erased. */
  isSuspended: boolean;
  isGuest: boolean;
  createdAtMs?: number;
  lastSeenMs?: number;
}

export interface AdminRoom {
  roomId: string;
  name?: string;
  members: number;
}

export interface MediaUsage {
  userId: string;
  displayName?: string;
  count: number;
  bytes: number;
}

export interface AdminStorageStats {
  mediaFiles: number;
  mediaBytes: number;
  byUser: MediaUsage[]; // top 10 by bytes
  serverVersion: string;
}

// ── fetch plumbing ──────────────────────────────────────────────────────────

/** One fetch with the admin token, mapping errors to readable messages. */
async function adminFetch(path: string, init?: RequestInit): Promise<unknown> {
  const creds = adminCredentials();
  if (!creds) throw new Error("Not signed in.");
  const res = await fetch(creds.baseUrl + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + creds.accessToken,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = "Server error " + res.status;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }
  return res.status === 204 ? {} : res.json();
}

// ── functions ───────────────────────────────────────────────────────────────

/** May the signed-in user open the admin dashboard? */
export async function amIAdmin(): Promise<boolean> {
  const creds = adminCredentials();
  if (!creds) return false;
  const me = (await adminFetch(
    "/_synapse/admin/v2/users/" + encodeURIComponent(creds.userId),
  )) as { admin?: boolean };
  return me.admin === true;
}

/** Every account, suspended ones included (the dashboard must see them). */
export async function listUsers(search?: string): Promise<AdminUser[]> {
  const out: AdminUser[] = [];
  let from: string | undefined;
  // Paginate, capped at 10 pages (1,000 accounts) — plenty for an
  // institution, and a runaway loop can never happen.
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      limit: "100",
      guests: "false",
      deactivated: "true",
    });
    if (search) params.set("name", search);
    if (from) params.set("from", from);
    const body = (await adminFetch("/_synapse/admin/v2/users?" + params)) as {
      users?: Array<{
        name: string;
        is_guest?: boolean;
        admin?: boolean;
        deactivated?: boolean;
        displayname?: string | null;
        creation_ts?: number;
        last_seen_ts?: number;
      }>;
      next_token?: string;
    };
    for (const row of body.users ?? []) {
      out.push({
        userId: row.name,
        displayName: row.displayname ?? undefined,
        isAdmin: row.admin === true,
        isSuspended: row.deactivated === true,
        isGuest: row.is_guest === true,
        createdAtMs: row.creation_ts,
        lastSeenMs: row.last_seen_ts,
      });
    }
    if (!body.next_token) break;
    from = body.next_token;
  }
  return out;
}

// Matrix localpart rules, made strict on purpose: a typo is caught here
// instead of as a confusing server error.
const LOCALPART = /^[a-zA-Z0-9._=\-]+$/;

/**
 * Create an account (spec: "Administrator-controlled account creation").
 * The first "8 characters" matches the server's password policy
 * (password_config.minimum_length in homeserver.yaml).
 */
export async function createUser(
  localpart: string,
  opts: { displayName?: string; password: string; isAdmin?: boolean },
): Promise<void> {
  const creds = adminCredentials();
  if (!creds) throw new Error("Not signed in.");
  const clean = localpart.trim();
  if (!clean || !LOCALPART.test(clean)) {
    throw new Error("Usernames may only contain letters, digits, dots, underscores, hyphens and =.");
  }
  if (!opts.password || opts.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const server = creds.userId.split(":")[1] ?? "";
  if (!server) throw new Error("Could not determine the server name.");
  await adminFetch(
    "/_synapse/admin/v2/users/" + encodeURIComponent("@" + clean + ":" + server),
    {
      method: "PUT",
      body: JSON.stringify({
        password: opts.password,
        ...(opts.displayName ? { displayname: opts.displayName } : {}),
        admin: opts.isAdmin === true,
      }),
    },
  );
}

/**
 * Suspend or reactivate an account — REVERSIBLE.
 *
 * ⚠ This uses the `deactivated` flag on PUT /v2/users, NOT the destructive
 * POST /deactivate endpoint (which wipes the password and can erase the
 * user's history). Suspend keeps everything intact; the member simply
 * cannot log in until reactivated. Spec: "Account activation, suspension".
 */
export async function setUserSuspended(userId: string, suspended: boolean): Promise<void> {
  await adminFetch("/_synapse/admin/v2/users/" + encodeURIComponent(userId), {
    method: "PUT",
    body: JSON.stringify({ deactivated: suspended }),
  });
}

/** Grant or revoke server-administrator rights. */
export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  await adminFetch("/_synapse/admin/v2/users/" + encodeURIComponent(userId), {
    method: "PUT",
    body: JSON.stringify({ admin: isAdmin }),
  });
}

/** Set a new password for a member; all their devices are logged out. */
export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters.");
  await adminFetch("/_synapse/admin/v1/reset_password/" + encodeURIComponent(userId), {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword, logout_devices: true }),
  });
}

/** Room overview, biggest rooms first (single page, capped at 200). */
export async function listRooms(): Promise<AdminRoom[]> {
  const body = (await adminFetch(
    "/_synapse/admin/v1/rooms?order_by=joined_members&limit=200",
  )) as {
    rooms?: Array<{ room_id: string; name?: string | null; num_joined_members?: number }>;
  };
  return (body.rooms ?? []).map((row) => ({
    roomId: row.room_id,
    name: row.name ?? undefined,
    members: row.num_joined_members ?? 0,
  }));
}

/** Media usage across the server + the running Synapse version. */
export async function getStorageStats(): Promise<AdminStorageStats> {
  const byUser: MediaUsage[] = [];
  let from: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (from) params.set("from", from);
    const body = (await adminFetch(
      "/_synapse/admin/v1/statistics/users/media?" + params,
    )) as {
      users?: Array<{
        user_id: string;
        displayname?: string | null;
        media_count?: number;
        media_length?: number;
      }>;
      next_token?: string;
    };
    for (const row of body.users ?? []) {
      byUser.push({
        userId: row.user_id,
        displayName: row.displayname ?? undefined,
        count: row.media_count ?? 0,
        bytes: row.media_length ?? 0,
      });
    }
    if (!body.next_token) break;
    from = body.next_token;
  }
  const version = (await adminFetch("/_synapse/admin/v1/server_version")) as {
    server_version?: string;
  };
  return {
    mediaFiles: byUser.reduce((n, u) => n + u.count, 0),
    mediaBytes: byUser.reduce((n, u) => n + u.bytes, 0),
    byUser: byUser.sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    serverVersion: version.server_version ?? "unknown",
  };
}
