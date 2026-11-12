import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { humanSize } from "../format";
import { mxcToHttp, type MakoMessage, type MakoReceipt, type MakoRoom } from "../matrix/client";

function shortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** What the shell tells us while an upload streams (Batch 5). */
export interface UploadInfo {
  name: string;
  pct: number;
}

/**
 * The main pane: one conversation's messages, its social signals (Batch 4),
 * shared files (Batch 5: inline images, file cards, a files drawer, an
 * attach button with upload progress), and the box to type in.
 * Deliberately dumb — data arrives via props, actions leave via callbacks.
 */
export function Conversation({
  room,
  messages,
  receipts,
  myUserId,
  uploading,
  notice,
  onSend,
  onTyping,
  onRead,
  onAttach,
}: {
  room: MakoRoom;
  messages: MakoMessage[];
  receipts: MakoReceipt[];
  myUserId: string;
  uploading: UploadInfo | null;
  notice: string | null;
  onSend: (body: string) => void;
  onTyping: (isTyping: boolean) => void;
  onRead: () => void;
  onAttach: (file: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- typing OUT: throttled ---
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

  useEffect(() => {
    return () => {
      if (typingActive.current) onTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount cleanup only
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (messages.length > 0) onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on message count
  }, [messages.length]);

  // --- "Seen" ---
  const receiptEventIds = new Set(receipts.map((rc) => rc.eventId));
  let lastMineIndex = -1;
  let lastSeenIndex = -1;
  messages.forEach((m, i) => {
    if (m.senderId === myUserId) lastMineIndex = i;
    if (receiptEventIds.has(m.eventId)) lastSeenIndex = i;
  });
  const seen = lastMineIndex >= 0 && lastSeenIndex >= lastMineIndex;

  // --- media URLs: resolve once, up front, so the JSX stays flat ---
  // Thumbnails (scaled copies) for inline images; full-size for downloads.
  const fileMessages = messages.filter((m) => m.kind === "image" || m.kind === "file");
  const fullUrls = new Map<string, string | null>();
  const thumbs = new Map<string, string | null>();
  for (const m of fileMessages) {
    if (!m.mxcUrl) continue;
    if (!fullUrls.has(m.mxcUrl)) fullUrls.set(m.mxcUrl, mxcToHttp(m.mxcUrl));
    if (m.kind === "image" && !thumbs.has(m.mxcUrl)) {
      thumbs.set(m.mxcUrl, mxcToHttp(m.mxcUrl, 480, 480));
    }
  }

  function submitDraft() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    updateTyping(false);
    onSend(body);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    updateTyping(value.trim().length > 0);
  }

  function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // WHY clear the input: picking the SAME file twice in a row must still
    // fire a change event — without this, the second pick is a no-op.
    event.target.value = "";
    if (file) onAttach(file);
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
        <button
          className="btn-ghost btn-small"
          type="button"
          title="Files shared in this room"
          onClick={() => setShowFiles((v) => !v)}
        >
          📁 {fileMessages.length > 0 ? fileMessages.length : ""}
        </button>
      </header>

      {showFiles && (
        <div className="files-drawer" aria-label="Files in this room">
          {fileMessages.length === 0 ? (
            <p className="muted-hint">No files shared yet.</p>
          ) : (
            fileMessages.map((f) => {
              const url = f.mxcUrl ? fullUrls.get(f.mxcUrl) : null;
              return (
                <div className="file-row" key={f.eventId}>
                  <span className="file-icon" aria-hidden="true">
                    {f.kind === "image" ? "🖼️" : "📄"}
                  </span>
                  <span className="file-meta">
                    <span className="file-name">{f.body}</span>
                    <span className="file-size">
                      {humanSize(f.size)} · {shortTime(f.ts)}
                    </span>
                  </span>
                  {url && (
                    <a
                      className="btn-ghost btn-small"
                      href={url}
                      download={f.body}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {notice && (
        <div className="error" role="alert">
          {notice}
        </div>
      )}

      {typingText && <div className="typing-line">{typingText}</div>}

      <div className="msg-list" ref={listRef}>
        {messages.length === 0 && <p className="muted-hint">No messages yet — say hello 👋</p>}
        {messages.map((m) => (
          <div key={m.eventId} className={"msg-row " + (m.senderId === myUserId ? "mine" : "theirs")}>
            <div className="msg-bubble">
              {m.senderId !== myUserId && <div className="msg-sender">{m.senderName}</div>}
              {m.kind === "image" && m.mxcUrl && thumbs.get(m.mxcUrl) ? (
                <a href={fullUrls.get(m.mxcUrl) ?? thumbs.get(m.mxcUrl)!} target="_blank" rel="noopener noreferrer">
                  <img
                    className="msg-image"
                    src={thumbs.get(m.mxcUrl)!}
                    alt={m.body}
                    loading="lazy"
                  />
                </a>
              ) : m.kind === "file" ? (
                <div className="file-card">
                  <span className="file-icon" aria-hidden="true">📄</span>
                  <span className="file-meta">
                    <span className="file-name">{m.body}</span>
                    <span className="file-size">{humanSize(m.size)}</span>
                  </span>
                  {m.mxcUrl && fullUrls.get(m.mxcUrl) && (
                    <a
                      className="btn-ghost btn-small"
                      href={fullUrls.get(m.mxcUrl)!}
                      download={m.body}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download
                    </a>
                  )}
                </div>
              ) : (
                <div className="msg-body">{m.body}</div>
              )}
              <div className="msg-time">{shortTime(m.ts)}</div>
            </div>
          </div>
        ))}
        {seen && <div className="msg-seen">Seen</div>}
      </div>

      {uploading && (
        <div className="upload-line" role="status">
          Uploading {uploading.name}… {uploading.pct}%
          <div className="upload-bar">
            <div className="upload-fill" style={{ width: `${uploading.pct}%` }} />
          </div>
        </div>
      )}

      <footer className="composer">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden-input"
          onChange={handleFilePicked}
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          className="btn-icon"
          type="button"
          title="Attach a file"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
        >
          📎
        </button>
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
