import { useEffect, useRef, useState } from "react";
import { BRAND } from "../brand";
import {
  getMessages,
  getRoomReceipts,
  listRooms,
  logout,
  markRoomRead,
  sendText,
  sendTyping,
  startDirectMessage,
  startSync,
  stopSync,
  type MakoMessage,
  type MakoReceipt,
  type MakoRoom,
  type MakoSession,
  type MakoSyncState,
} from "../matrix/client";
import { expandUserId } from "../matrix/ids";
import { Conversation } from "./Conversation";
import { RoomList } from "./RoomList";

// Words the status line shows for each connection state.
const STATUS_LABEL: Record<MakoSyncState, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline — retrying…",
  fatal: "Session ended",
};

/**
 * The signed-in app: a sidebar of conversations and the main conversation
 * pane. This component owns the sync wiring — nothing else talks to the
 * wrapper's sync functions.
 */
export function ChatShell({
  session,
  onSignedOut,
}: {
  session: MakoSession;
  onSignedOut: (reason?: string) => void;
}) {
  const [rooms, setRooms] = useState<MakoRoom[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MakoMessage[]>([]);
  const [receipts, setReceipts] = useState<MakoReceipt[]>([]);
  const [status, setStatus] = useState<MakoSyncState>("connecting");
  const [newChatError, setNewChatError] = useState<string | null>(null);

  // WHY a ref NEXT TO the state: the sync callbacks are registered once
  // (empty dependency array below), so anything they read later must come
  // from a ref — a state value captured there would be a stale snapshot
  // from mount time. selectedId state still drives the render.
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    startSync({
      onStateChange: (st) => {
        setStatus(st);
        if (st === "fatal") onSignedOut("Your session ended. Please sign in again.");
      },
      onRoomsChanged: () => setRooms(listRooms()),
      onRoomUpdated: (roomId) => {
        // previews, typing lines, ordering may all have moved
        setRooms(listRooms());
        if (roomId === selectedIdRef.current) {
          setMessages(getMessages(roomId));
          setReceipts(getRoomReceipts(roomId));
        }
      },
    }).catch(() => onSignedOut("Could not start syncing. Please sign in again."));

    // Cleanup runs on unmount (sign-out): the wrapper detaches everything.
    return () => {
      void stopSync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const selectedRoom = rooms.find((r) => r.roomId === selectedId);

  function selectRoom(roomId: string) {
    selectedIdRef.current = roomId;
    setSelectedId(roomId);
    setMessages(getMessages(roomId));
    setReceipts(getRoomReceipts(roomId));
  }

  async function handleSend(body: string) {
    if (!selectedIdRef.current) return;
    await sendText(selectedIdRef.current, body);
    // NOTE: no manual refresh — the SDK's local echo fires a Room.timeline
    // event, which the sync callback above already translates.
  }

  async function handleTyping(isTyping: boolean) {
    if (!selectedIdRef.current) return;
    await sendTyping(selectedIdRef.current, isTyping);
  }

  // Mark the open conversation read whenever its messages change — this
  // is what makes "Seen" appear for the people we're chatting with.
  function handleRead() {
    if (selectedIdRef.current) void markRoomRead(selectedIdRef.current);
  }

  async function handleNewChat(raw: string) {
    setNewChatError(null);
    // Accept "jdoe", "@jdoe", or the full "@jdoe:mako" — expand it first.
    const userId = expandUserId(raw, session.userId);
    if (!userId) {
      setNewChatError("Usernames look like jdoe or @jdoe:mako.");
      return;
    }
    try {
      const roomId = await startDirectMessage(userId);
      selectRoom(roomId); // the room appears in the list on the next sync
    } catch (err) {
      const e = err as { message?: string };
      setNewChatError(e.message ? String(e.message) : "Could not start that chat.");
    }
  }

  async function handleSignOut() {
    await logout(); // stops the sync loop and ends the server session
    onSignedOut();
  }

  return (
    <div className={"chat-shell status-" + status}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <span className="brand-mini">
            {BRAND.emoji} {BRAND.name}
          </span>
          <button className="btn-ghost" onClick={handleSignOut}>
            Sign out
          </button>
        </header>

        <div className={"status status-" + status}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </div>

        <RoomList
          rooms={rooms}
          selectedId={selectedId}
          onSelect={selectRoom}
          onNewChat={handleNewChat}
          newChatError={newChatError}
        />
      </aside>

      <main className="main-pane">
        {selectedRoom ? (
          <Conversation
            room={selectedRoom}
            messages={messages}
            receipts={receipts}
            myUserId={session.userId}
            onSend={handleSend}
            onTyping={handleTyping}
            onRead={handleRead}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-shark" aria-hidden="true">
              {BRAND.emoji}
            </div>
            <p>Pick a conversation, or start one from the sidebar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
