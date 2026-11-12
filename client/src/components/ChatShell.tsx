import { useEffect, useRef, useState } from "react";
import { BRAND } from "../brand";
import { ensureNotificationPermission, showNotification } from "../notify";
import { ProfilePanel, type ProfileUpdates } from "./ProfilePanel";
import {
  getMessages,
  getMyProfile,
  getRoomReceipts,
  listRooms,
  mxcToHttp,
  logout,
  markRoomRead,
  sendFile,
  setMyAvatar,
  setMyDisplayName,
  sendText,
  sendTyping,
  startDirectMessage,
  startSync,
  stopSync,
  type MakoMessage,
  type MakoProfile,
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
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<MakoSyncState>("connecting");
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [profile, setProfile] = useState<MakoProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // WHY a ref NEXT TO the state: the sync callbacks are registered once
  // (empty dependency array below), so anything they read later must come
  // from a ref — a state value captured there would be a stale snapshot
  // from mount time. selectedId state still drives the render.
  const selectedIdRef = useRef<string | null>(null);

  // Batch 6: my profile (chip name/picture) + notification permission.
  // Both fire-and-forget: neither may block the app from starting.
  useEffect(() => {
    void getMyProfile().then(setProfile).catch(() => {});
    void ensureNotificationPermission();
  }, []);

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
      // Batch 6: a message arrived in a room — if the user is not looking
      // at it, pop a desktop notification.
      onIncomingMessage: (roomId, roomName, senderName, body) => {
        if (roomId !== selectedIdRef.current) {
          showNotification(`${BRAND.name} — ${roomName}`, `${senderName}: ${body}`);
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
  const localpart = session.userId.split(":")[0].slice(1) || "?";
  const profileAvatar = profile?.avatarMxc ? mxcToHttp(profile.avatarMxc, 64, 64) : null;

  function selectRoom(roomId: string) {
    selectedIdRef.current = roomId;
    setSelectedId(roomId);
    setMessages(getMessages(roomId));
    setReceipts(getRoomReceipts(roomId));
    setUploadNotice(null);
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

  // Batch 5: the attach button hands us a File; the wrapper uploads it to
  // the media repository, then sends the pointing message into the room.
  async function handleAttach(file: File) {
    const roomId = selectedIdRef.current;
    if (!roomId) return;
    setUploadNotice(null);
    setUploading({ name: file.name, pct: 0 });
    try {
      await sendFile(roomId, file, (pct) => setUploading({ name: file.name, pct }));
    } catch (err) {
      const e = err as { message?: string };
      setUploadNotice(e.message ? String(e.message) : "Upload failed. Please try again.");
    } finally {
      setUploading(null);
    }
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

  // Batch 6: save profile edits, then re-read the profile from the server
  // so the chip and panel show the truth.
  async function handleProfileSave(updates: ProfileUpdates) {
    setProfileBusy(true);
    setProfileError(null);
    try {
      if (updates.displayName && updates.displayName !== profile?.displayName) {
        await setMyDisplayName(updates.displayName);
      }
      if (updates.avatarFile) {
        await setMyAvatar(updates.avatarFile);
      }
      setProfile(await getMyProfile());
      setShowProfile(false);
    } catch (err) {
      const e = err as { message?: string };
      setProfileError(e.message ? String(e.message) : "Could not save. Please try again.");
    } finally {
      setProfileBusy(false);
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

        <button
          className="user-chip"
          type="button"
          title="My profile"
          onClick={() => setShowProfile((v) => !v)}
        >
          <span className="user-avatar" aria-hidden="true">
            {profileAvatar ? (
              <img src={profileAvatar} alt="" />
            ) : (
              (profile?.displayName || localpart)[0]?.toUpperCase() ?? "🦈"
            )}
          </span>
          <span className="user-name">{profile?.displayName || localpart}</span>
        </button>

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
            uploading={uploading}
            notice={uploadNotice}
            onSend={handleSend}
            onTyping={handleTyping}
            onRead={handleRead}
            onAttach={handleAttach}
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

      {showProfile && profile && (
        <ProfilePanel
          profile={profile}
          myUserId={session.userId}
          busy={profileBusy}
          error={profileError}
          onSave={handleProfileSave}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}
