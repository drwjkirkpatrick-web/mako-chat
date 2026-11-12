import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as admin from "../matrix/admin";
import type { AdminUser } from "../matrix/admin";
import { humanSize } from "../format";
import { BRAND } from "../brand";

function friendly(err: unknown): string {
  const e = err as { message?: string };
  return e.message ? String(e.message) : "Something went wrong. Please try again.";
}

function shortDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString();
}

/**
 * The admin dashboard (Batch 7 — PLAN D3): one overlay, three tabs.
 * Every action goes through the admin API layer; the panel owns no
 * fetching of its own beyond that layer's functions.
 */
export function AdminPanel({ myUserId, onClose }: { myUserId: string; onClose: () => void }) {
  const [tab, setTab] = useState<"users" | "rooms" | "storage">("users");
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="admin-card"
        role="dialog"
        aria-label="Admin dashboard"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="admin-header">
          <h3>
            {BRAND.emoji} Admin dashboard
          </h3>
          <button className="btn-ghost" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <nav className="admin-tabs" aria-label="Dashboard sections">
          <button
            type="button"
            className={tab === "users" ? "selected" : ""}
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            type="button"
            className={tab === "rooms" ? "selected" : ""}
            onClick={() => setTab("rooms")}
          >
            Rooms
          </button>
          <button
            type="button"
            className={tab === "storage" ? "selected" : ""}
            onClick={() => setTab("storage")}
          >
            Storage
          </button>
        </nav>

        <div className="admin-body">
          {tab === "users" && <UsersTab myUserId={myUserId} />}
          {tab === "rooms" && <RoomsTab />}
          {tab === "storage" && <StorageTab />}
        </div>
      </div>
    </div>
  );
}

// ── Users tab ──────────────────────────────────────────────────────────────

function UsersTab({ myUserId }: { myUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ localpart: "", displayName: "", password: "", isAdmin: false });

  // Two-step confirmations / inline password reset.
  const [pendingSuspend, setPendingSuspend] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await admin.listUsers(search.trim() || undefined));
    } catch (err) {
      setError(friendly(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      await admin.createUser(form.localpart, {
        displayName: form.displayName || undefined,
        password: form.password,
        isAdmin: form.isAdmin,
      });
      setForm({ localpart: "", displayName: "", password: "", isAdmin: false });
      setShowCreate(false);
    }, "Account created.");
  }

  return (
    <div className="admin-users">
      <div className="admin-toolbar">
        <input
          aria-label="Search users"
          placeholder="Search by username or display name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="btn"
          type="button"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Close form" : "+ New account"}
        </button>
      </div>

      {showCreate && (
        <form className="create-user" onSubmit={submitCreate}>
          <div className="field">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              placeholder="e.g. jdoe (becomes @jdoe:…)"
              value={form.localpart}
              onChange={(e) => setForm({ ...form, localpart: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-displayname">Display name</label>
            <input
              id="new-displayname"
              placeholder="Optional — shown to others"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">Initial password</label>
            <input
              id="new-password"
              type="password"
              placeholder="At least 8 characters — give this to the member"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
            />
            Administrator (can open this dashboard)
          </label>
          <div className="profile-actions">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      )}

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted-hint">Loading accounts…</p>}

      {!loading && users.length === 0 && (
        <p className="muted-hint">No accounts match.</p>
      )}

      {users.map((u) => {
        const mine = u.userId === myUserId;
        const confirming = pendingSuspend === u.userId;
        return (
          <div className={"admin-row" + (u.isSuspended ? " suspended" : "")} key={u.userId}>
            <div className="admin-user-main">
              <span className="admin-uid">{u.userId}</span>
              {u.displayName && <span className="admin-dname">{u.displayName}</span>}
              <span className="admin-badges">
                {u.isAdmin && <span className="badge badge-admin">admin</span>}
                {u.isSuspended && <span className="badge badge-suspended">suspended</span>}
                {mine && <span className="badge">you</span>}
              </span>
              <span className="admin-created">since {shortDate(u.createdAtMs)}</span>
            </div>
            <div className="admin-row-actions">
              {!mine && (
                <>
                  <button
                    className="btn-ghost btn-small"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!confirming) {
                        setPendingSuspend(u.userId);
                        return;
                      }
                      setPendingSuspend(null);
                      void act(
                        () => admin.setUserSuspended(u.userId, !u.isSuspended),
                        u.isSuspended ? "Account reactivated." : "Account suspended.",
                      );
                    }}
                  >
                    {confirming ? "Confirm?" : u.isSuspended ? "Reactivate" : "Suspend"}
                  </button>
                  <button
                    className="btn-ghost btn-small"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        () => admin.setUserAdmin(u.userId, !u.isAdmin),
                        u.isAdmin ? "Admin rights removed." : "Admin rights granted.",
                      );
                    }}
                  >
                    {u.isAdmin ? "Remove admin" : "Make admin"}
                  </button>
                  {resetFor === u.userId ? (
                    <span className="inline-form">
                      <input
                        type="password"
                        aria-label={"New password for " + u.userId}
                        placeholder="New password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <button
                        className="btn-ghost btn-small"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void act(() => admin.resetUserPassword(u.userId, newPassword), "Password reset.");
                          setResetFor(null);
                          setNewPassword("");
                        }}
                      >
                        Set
                      </button>
                      <button
                        className="btn-ghost btn-small"
                        type="button"
                        onClick={() => setResetFor(null)}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-ghost btn-small"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setResetFor(u.userId);
                        setNewPassword("");
                      }}
                    >
                      Reset password
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Rooms tab ───────────────────────────────────────────────────────────────

function RoomsTab() {
  const [rooms, setRooms] = useState<admin.AdminRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin
      .listRooms()
      .then(setRooms)
      .catch((err) => setError(friendly(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-rooms">
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted-hint">Loading rooms…</p>}
      {!loading && rooms.length === 0 && <p className="muted-hint">No rooms.</p>}
      {rooms.map((room) => (
        <div className="admin-row" key={room.roomId}>
          <div className="admin-user-main">
            <span className="admin-uid">{room.name ?? room.roomId}</span>
            <span className="admin-created">{room.members} member{room.members === 1 ? "" : "s"}</span>
          </div>
          <div className="admin-row-actions">
            <span className="admin-room-id">{room.roomId}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Storage tab ─────────────────────────────────────────────────────────────

function StorageTab() {
  const [stats, setStats] = useState<admin.AdminStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin
      .getStorageStats()
      .then(setStats)
      .catch((err) => setError(friendly(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-storage">
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted-hint">Loading storage statistics…</p>}

      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.mediaFiles}</div>
              <div className="stat-label">shared files</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{humanSize(stats.mediaBytes)}</div>
              <div className="stat-label">media stored</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.serverVersion}</div>
              <div className="stat-label">Synapse version</div>
            </div>
          </div>

          <h4>Top media users</h4>
          {stats.byUser.length === 0 ? (
            <p className="muted-hint">No media stored yet.</p>
          ) : (
            stats.byUser.map((u) => (
              <div className="admin-row" key={u.userId}>
                <div className="admin-user-main">
                  <span className="admin-uid">{u.displayName ?? u.userId}</span>
                </div>
                <div className="admin-row-actions">
                  <span className="admin-created">
                    {u.count} file{u.count === 1 ? "" : "s"} · {humanSize(u.bytes)}
                  </span>
                </div>
              </div>
            ))
          )}

          <h4>Security & operations</h4>
          <div className="security-card">
            <ul>
              <li>Self-registration is disabled — accounts are created here (spec: administrator-controlled).</li>
              <li>Suspension is reversible; nothing is erased. The destructive deactivate/erase API is intentionally not exposed.</li>
              <li>End-to-end encryption is off in v1; traffic is transport-secured (TLS via Tailscale).</li>
              <li>Federation is off — this server is a closed institutional island.</li>
              <li>Backups run nightly on the server — see <code>server/deploy.md</code> §9.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
