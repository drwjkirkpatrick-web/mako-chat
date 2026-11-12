import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatShell } from "../src/components/ChatShell";
import type { MakoRoom, MakoSession } from "../src/matrix/client";

// The SHELL is tested against a mocked wrapper — its real behaviour is
// covered in messaging.spec.ts. One seam, one mock level.
vi.mock("../src/matrix/client", () => ({
  startSync: vi.fn(),
  stopSync: vi.fn(),
  listRooms: vi.fn(),
  getMessages: vi.fn(),
  getRoomReceipts: vi.fn(),
  sendText: vi.fn(),
  sendTyping: vi.fn(),
  sendFile: vi.fn(),
  markRoomRead: vi.fn(),
  startDirectMessage: vi.fn(),
  logout: vi.fn(),
}));

import {
  getMessages,
  getRoomReceipts,
  listRooms,
  markRoomRead,
  sendFile,
  sendText,
  startDirectMessage,
  startSync,
  stopSync,
} from "../src/matrix/client";

const session: MakoSession = {
  baseUrl: "http://mako-server:8008",
  userId: "@me:mako",
  accessToken: "t",
  deviceId: "d",
};

const rooms: MakoRoom[] = [
  {
    roomId: "!r1", name: "Jdoe", isDirect: true, membersCount: 2,
    lastActivityTs: 200, preview: "jdoe: hello",
    otherPresence: "online", typingNames: [],
  },
  {
    roomId: "!r2", name: "Announcements", isDirect: false, membersCount: 9,
    lastActivityTs: 100, preview: "admin: welcome",
    otherPresence: "unknown", typingNames: [],
  },
];

function wireSync() {
  vi.mocked(startSync).mockImplementation(async (cb) => {
    cb.onStateChange("live");
    cb.onRoomsChanged();
  });
  vi.mocked(listRooms).mockReturnValue(rooms);
}

beforeEach(() => {
  vi.mocked(stopSync).mockReset();
  vi.mocked(getMessages).mockReset();
  vi.mocked(getRoomReceipts).mockReset().mockReturnValue([]);
  vi.mocked(sendText).mockReset();
  vi.mocked(sendFile).mockReset();
  vi.mocked(startDirectMessage).mockReset();
  vi.mocked(startSync).mockReset();
  wireSync();
});
afterEach(cleanup);

describe("ChatShell", () => {
  it("shows the room list and the live status once sync is up", async () => {
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Jdoe")).toBeTruthy());
    expect(screen.getByText("Announcements")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();
  });

  it("shows a hint when there are no conversations", async () => {
    vi.mocked(listRooms).mockReturnValue([]);
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No conversations yet/i)).toBeTruthy());
  });

  it("opens a room: its messages appear and typing sends through the wrapper", async () => {
    vi.mocked(getMessages).mockReturnValue([
      { eventId: "$1", senderId: "@jdoe:mako", senderName: "jdoe", body: "hey", ts: 1, isMine: false, kind: "text" },
      { eventId: "$2", senderId: session.userId, senderName: "me", body: "hi", ts: 2, isMine: true, kind: "text" },
    ]);
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => screen.getByText("Jdoe"));

    fireEvent.click(screen.getByText("Jdoe"));
    expect(getMessages).toHaveBeenCalledWith("!r1");
    await waitFor(() => expect(screen.getByText("hey")).toBeTruthy());

    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "sending this" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(sendText).toHaveBeenCalledWith("!r1", "sending this"));
  });

  it("starts a new chat from the sidebar box and opens it", async () => {
    vi.mocked(getMessages).mockReturnValue([]);
    vi.mocked(startDirectMessage).mockResolvedValue("!fresh");
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => screen.getByText("Jdoe"));

    const input = screen.getByLabelText(/Start a new chat/i);
    fireEvent.change(input, { target: { value: "jdoe" } }); // bare localpart
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => expect(startDirectMessage).toHaveBeenCalledWith("@jdoe:mako"));
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith("!fresh"));
  });

  it("signs out through the wrapper", async () => {
    const { logout } = await import("../src/matrix/client");
    const onSignedOut = vi.fn();
    render(<ChatShell session={session} onSignedOut={onSignedOut} />);
    await waitFor(() => screen.getByText("Sign out"));
    fireEvent.click(screen.getByText("Sign out"));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(logout).toHaveBeenCalled();
  });
});

describe("ChatShell: Batch 4 signals", () => {
  it("shows a typing preview in the room list when someone is typing", async () => {
    vi.mocked(listRooms).mockReturnValue([
      {
        roomId: "!r1", name: "Jdoe", isDirect: true, membersCount: 2,
        lastActivityTs: 200, preview: "jdoe is typing…",
        otherPresence: "online", typingNames: ["jdoe"],
      },
    ]);
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("jdoe is typing…")).toBeTruthy());
  });

  it("renders the typing line and Seen state in the conversation", async () => {
    vi.mocked(getMessages).mockReturnValue([
      { eventId: "$1", senderId: "@jdoe:mako", senderName: "jdoe", body: "hey", ts: 1, isMine: false, kind: "text" },
      { eventId: "$2", senderId: session.userId, senderName: "me", body: "hi", ts: 2, isMine: true, kind: "text" },
    ]);
    vi.mocked(getRoomReceipts).mockReturnValue([
      { userId: "@jdoe:mako", eventId: "$2", ts: 3 },
    ]);
    vi.mocked(listRooms).mockReturnValue([
      {
        roomId: "!r1", name: "Jdoe", isDirect: true, membersCount: 2,
        lastActivityTs: 200, preview: "jdoe is typing…",
        otherPresence: "online", typingNames: ["jdoe"],
      },
    ]);
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => screen.getByText("Jdoe"));
    fireEvent.click(screen.getByText("Jdoe"));
    // NOTE: "jdoe is typing…" now exists in BOTH the sidebar preview and
    // the conversation's typing line — query the element, not the text.
    await waitFor(() =>
      expect(document.querySelector(".typing-line")?.textContent).toContain("jdoe is typing…"),
    );
    await waitFor(() => expect(screen.getByText("Seen")).toBeTruthy());
    expect(markRoomRead).toHaveBeenCalled();
  });
});


describe("ChatShell: file sharing (Batch 5)", () => {
  it("attaches a file in the open room through sendFile with progress", async () => {
    vi.mocked(getMessages).mockReturnValue([]);
    render(<ChatShell session={session} onSignedOut={vi.fn()} />);
    await waitFor(() => screen.getByText("Jdoe"));
    fireEvent.click(screen.getByText("Jdoe"));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(sendFile).toHaveBeenCalledWith("!r1", file, expect.any(Function)),
    );
  });
})
