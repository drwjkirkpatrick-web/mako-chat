import { useState, type FormEvent } from "react";
import { mxcToHttp, type MakoRoom } from "../matrix/client";

/**
 * The sidebar list of conversations, newest activity at the top, plus the
 * "start a new chat" box.
 */
export function RoomList({
  rooms,
  selectedId,
  onSelect,
  onNewChat,
  newChatError,
  canStartChats,
}: {
  rooms: MakoRoom[];
  selectedId: string | null;
  onSelect: (roomId: string) => void;
  onNewChat: (input: string) => void;
  newChatError: string | null;
  /** False while disconnected: starting a chat NEEDS the server. */
  canStartChats: boolean;
}) {
  const [newChat, setNewChat] = useState("");

  function submitNewChat(event: FormEvent) {
    event.preventDefault();
    const value = newChat.trim();
    if (!value) return;
    onNewChat(value);
    setNewChat("");
  }

  return (
    <div className="room-list">
      <form className="new-chat" onSubmit={submitNewChat}>
        <input
          aria-label="Start a new chat with a username"
          placeholder="New chat — enter a username"
          value={newChat}
          onChange={(e) => setNewChat(e.target.value)}
          disabled={!canStartChats}
        />
        <button className="btn btn-small" type="submit" disabled={!canStartChats}>
          Start
        </button>
      </form>
      {!canStartChats && (
        <p className="muted-hint">Waiting for the connection before starting new chats…</p>
      )}

      {newChatError && (
        <p className="error" role="alert">
          {newChatError}
        </p>
      )}

      {rooms.length === 0 ? (
        <p className="muted-hint">No conversations yet. Start one above.</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li key={room.roomId}>
              <button
                type="button"
                className={"room-item" + (room.roomId === selectedId ? " selected" : "")}
                onClick={() => onSelect(room.roomId)}
              >
                <span className="room-avatar" aria-hidden="true">
                  {room.isDirect && room.otherAvatarMxc && mxcToHttp(room.otherAvatarMxc, 80, 80) ? (
                    <img
                      className="avatar-img"
                      src={mxcToHttp(room.otherAvatarMxc, 80, 80)!}
                      alt=""
                    />
                  ) : room.isDirect ? (
                    "🦈"
                  ) : (
                    "👥"
                  )}
                  {room.isDirect && (
                    <span className={"presence-dot p-" + room.otherPresence} />
                  )}
                </span>
                <span className="room-text">
                  <span className="room-name">{room.name}</span>
                  <span className="room-preview">{room.preview}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
