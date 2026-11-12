import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { MakoMessage, MakoReceipt, MakoRoom } from "../matrix/client";

function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The main pane: one conversation's messages, its typing line, "Seen",
 * and the box to type in. Deliberately dumb — data arrives via props,
 * actions leave via callbacks, which keeps it trivial to test.
 *
 * Three social signals live here (Batch 4):
 *  - "jdoe is typing…"  — from room.typingNames
 *  - "Seen"            — when someone's read receipt reaches my last message
 *  - typing OUT        — throttled: we re-announce at most every 3 s
 */
export function Conversation({
  room,
  messages,
  receipts,
  myUserId,
  onSend,
  onTyping,
  onRead,
}: {
  room: MakoRoom;
  messages: MakoMessage[];
  receipts: MakoReceipt[];
  myUserId: string;
  onSend: (body: string) => void;
  onTyping: (isTyping: boolean) => void;
  onRead: () => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  // --- typing OUT: throttled ---
  // Matrix etiquette: don't announce typing on every keystroke. The
  // server expires the flag after 10 s, so re-announcing every 3 s while
  // typing keeps it alive without spamming the room.
  const typingActive = useRef(false);
  const lastTypingSent = useRef(0);

  function updateTyping(hasText: boolean) {
    if (!hasText) {
      if (typingActive.current) {
        typingActive.current = false;
        onTyping(false);
      }
      return;
    }
    const now = Date.now();
    if (!typingActive.current || now - lastTypingSent.current > 3000) {
      typingActive.current = true;
      lastTypingSent.current = now;
      onTyping(true);
    }
  }

  // If the pane unmounts while "typing", cancel the flag.
  useEffect(() => {
    return () => {
      if (typingActive.current) onTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount cleanup only
  }, []);

  // --- auto-scroll + auto-read ---
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (messages.length > 0) onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on message count
  }, [messages.length]);

  // --- "Seen": has anyone's receipt reached my last message? ---
  // NOTE the index comparison: if they read a message AFTER mine, mine
  // was necessarily seen too — receipts only move forward.
  const receiptEventIds = new Set(receipts.map((rc) => rc.eventId));
  let lastMineIndex = -1;
  let lastSeenIndex = -1;
  messages.forEach((m, i) => {
    if (m.senderId === myUserId) lastMineIndex = i;
    if (receiptEventIds.has(m.eventId)) lastSeenIndex = i;
  });
  const seen = lastMineIndex >= 0 && lastSeenIndex >= lastMineIndex;

  function submitDraft() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    updateTyping(false); // sending the message ends the typing signal
    onSend(body); // the local echo makes it appear instantly
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline — the convention members
    // already know from every other chat app.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    updateTyping(value.trim().length > 0);
  }

  const typingText =
    room.typingNames.length === 0
      ? null
      : `${room.typingNames.join(", ")} ${room.typingNames.length === 1 ? "is" : "are"} typing…`;

  return (
    <div className="conversation">
      <header className="conv-header">
        <span className="conv-title">{room.name}</span>
        <span className="conv-sub">
          {room.isDirect ? "Direct message" : `${room.membersCount} members`}
        </span>
      </header>

      {typingText && <div className="typing-line">{typingText}</div>}

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
        {seen && <div className="msg-seen">Seen</div>}
      </div>

      <footer className="composer">
        <textarea
          aria-label="Message"
          rows={2}
          placeholder={`Message ${room.name}… (Enter to send, Shift+Enter for a new line)`}
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="btn" type="button" onClick={submitDraft} disabled={!draft.trim()}>
          Send
        </button>
      </footer>
    </div>
  );
}
