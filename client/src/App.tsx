import { useEffect, useState } from "react";
import { BRAND } from "./brand";
import { LoginScreen } from "./components/LoginScreen";
import { logout, restoreSession, type MakoSession } from "./matrix/client";

// The whole app is one state machine at the top: a session, or no session.
// Batches 3+ grow the "signed in" branch into the real messaging UI.
export default function App() {
  const [session, setSession] = useState<MakoSession | null>(null);
  const [booted, setBooted] = useState(false);

  // NOTE: restoreSession() runs once at startup — it reads saved credentials
  // (if any) and comes back logged-in without the user typing anything again.
  // WHY a flag: React 18+ double-invokes effects in dev (StrictMode); the
  // flag just means "first paint decided", not "ran twice".
  useEffect(() => {
    setSession(restoreSession());
    setBooted(true);
  }, []);

  if (!booted) return null;

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="brand-mini">
          {BRAND.emoji} {BRAND.name}
        </span>
        <span className="whoami">{session.userId}</span>
        <button
          className="btn-ghost"
          onClick={async () => {
            await logout();
            setSession(null);
          }}
        >
          Sign out
        </button>
      </header>
      <main className="placeholder">
        <h2>Foundation complete 🦈</h2>
        <p>
          Signed in as <code>{session.userId}</code> at{" "}
          <code>{session.baseUrl}</code>. Conversations arrive in Batch 3.
        </p>
      </main>
    </div>
  );
}
