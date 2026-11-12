import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MakoMessage, MakoRoom } from "../matrix/client";

function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The main pane: one conversation's messages and the box to type in.
 * Deliberately dumb — all data arrives via props, all actions leave via
 * callbacks. That keeps it trivial to test.
 */
export function Conversation({
  room,
  messages,
  myUserId,
  onSend,
}: {
  room: MakoRoom;
  messages: MakoMessage[];
  myUserId: string;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // WHY auto-scroll: without this the newest message hides below the fold.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submitDraft() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    onSend(body); // the local echo makes it appear instantly
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline — the convention members
    // already know from every other chat app.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  return (
    <div className="conversation">
      <header className="conv-header">
        <span className="conv-title">{room.name}</span>
        <span className="conv-sub">
          {room.isDirect ? "Direct message" : `${room.membersCount} members`}
        </span>
      </header>

      <div className="msg-list" ref={listRef}>
        {messages.length === 0 && <p className="muted-hint">No messages yet — say hello 👋</p>}
        {messages.map((m) => (
          <div key={m.eventId} className={"msg-row " + (m.senderId === myUserId ? "mine" : "theirs")}>
            <div className="msg-bubble">
              {m.senderId !== myUserId && <div className="msg-sender">{m.senderName}</div>}
              <div className="msg-body">{m.body}</div>
              <div className="msg-time">{shortTime(m.ts)}</div>
            </div>
          </div>
        ))}
      </div>

      <footer className="composer">
        <textarea
          aria-label="Message"
          rows={2}
          placeholder={`Message ${room.name}… (Enter to send, Shift+Enter for a new line)`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn" type="button" onClick={submitDraft} disabled={!draft.trim()}>
          Send
        </button>
      </footer>
    </div>
  );
}
