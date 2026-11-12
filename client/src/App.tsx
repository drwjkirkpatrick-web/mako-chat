import { useEffect, useState } from "react";
import { ChatShell } from "./components/ChatShell";
import { LoginScreen } from "./components/LoginScreen";
import { restoreSession, type MakoSession } from "./matrix/client";

// The whole app is one state machine at the top:
//   no session -> LoginScreen      session -> ChatShell
// plus a small "why did I end up signed out" notice the shell can set
// (e.g. the server revoked an old session).
export default function App() {
  const [session, setSession] = useState<MakoSession | null>(null);
  const [booted, setBooted] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);

  // restoreSession() runs once at startup: it reads saved credentials (if
  // any) and comes back logged-in without asking the user to type again.
  // NOTE: the flag exists because React double-invokes effects in dev
  // (StrictMode) — the flag means "first render decided", not "ran once".
  useEffect(() => {
    setSession(restoreSession());
    setBooted(true);
  }, []);

  if (!booted) return null;

  if (!session) {
    return (
      <LoginScreen
        onLogin={(s) => {
          setSession(s);
          setSignedOutNotice(null);
        }}
        initialNotice={signedOutNotice}
      />
    );
  }

  return (
    <ChatShell
      session={session}
      onSignedOut={(reason) => {
        // If the shell passes a reason, show it on the login screen.
        setSignedOutNotice(reason ?? null);
        setSession(null);
      }}
    />
  );
}
