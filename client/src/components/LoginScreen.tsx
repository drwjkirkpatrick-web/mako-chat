import { useState, type FormEvent } from "react";
import { BRAND } from "../brand";
import * as matrix from "../matrix/client";
import type { MakoSession } from "../matrix/client";

// The first thing a member ever sees: three fields, one button, honest
// errors. NOTE: this component knows NOTHING about Matrix — it talks to
// the wrapper (src/matrix/client.ts) and nothing else.

interface LoginScreenProps {
  onLogin: (session: MakoSession) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [server, setServer] = useState(matrix.lastServerUrl());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    // NOTE: preventDefault — this is a real <form>; without this the
    // browser reloads the page before our async login can run.
    event.preventDefault();
    setError(null);
    const name = username.trim();
    if (!server.trim() || !name || !password) {
      setError("Server, username and password are all required.");
      return;
    }
    setBusy(true);
    try {
      const session = await matrix.login(server, name, password);
      onLogin(session);
    } catch (err) {
      // WHY translate: raw SDK errors are for developers; members get a
      // plain sentence that tells them what to do next.
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="brand-header">
          <span className="brand-emoji">{BRAND.emoji}</span>
          <div className="brand-name">{BRAND.name}</div>
          <div className="brand-tagline">{BRAND.tagline}</div>
        </div>

        <div className="field">
          <label htmlFor="server">Server</label>
          <input
            id="server"
            name="server"
            autoComplete="url"
            placeholder="http://mako-server:8008"
            value={server}
            onChange={(e) => setServer(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            placeholder="e.g. jdoe"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/**
 * Turn any login failure into one plain sentence. Exported because the
 * unit tests exercise it directly (tests/login-screen.spec.tsx).
 */
export function friendlyError(err: unknown): string {
  const e = err as { httpStatus?: number; errcode?: string; message?: string };
  if (e?.errcode === "M_FORBIDDEN" || e?.httpStatus === 403) {
    return "Username or password is not right. Check with your administrator.";
  }
  if (e?.httpStatus === 404) {
    return "That address does not answer as a MAKO CHAT server.";
  }
  const msg = (e?.message ?? "").toLowerCase();
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("econnrefused")) {
    return "Could not reach the server. Check the address and your connection.";
  }
  return e?.message ? String(e.message) : "Login failed. Please try again.";
}
