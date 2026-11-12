import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Conversation } from "../src/components/Conversation";
import type { MakoMessage, MakoReceipt, MakoRoom } from "../src/matrix/client";

// Batch 5: the conversation resolves media URLs through the wrapper —
// mock just that one function; the component stays fully real.
vi.mock("../src/matrix/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/matrix/client")>()),
  mxcToHttp: vi.fn((url: string, w?: number) => `http://media/${w ? "thumb/" : "full/"}${url}`),
}));

// The conversation pane is a pure props-in/callbacks-out component — no
// wrappers, no SDK, no mocks beyond fixtures. Everything here is real.

const ME = "@me:mako";
const room: MakoRoom = {
  roomId: "!r1",
  name: "Jdoe",
  isDirect: true,
  membersCount: 2,
  otherPresence: "online",
  typingNames: [],
  lastActivityTs: 0,
  preview: "",
};

const messages: MakoMessage[] = [
  { eventId: "$a", senderId: "@jdoe:mako", senderName: "jdoe", body: "hey", ts: 1, isMine: false, kind: "text" },
  { eventId: "$b", senderId: ME, senderName: "me", body: "hi!", ts: 2, isMine: true, kind: "text" },
];

function renderConv(overrides: Record<string, unknown> = {}) {
  const props = {
    room,
    messages,
    receipts: [] as MakoReceipt[],
    myUserId: ME,
    uploading: null,
    notice: null,
    onSend: vi.fn(),
    onTyping: vi.fn(),
    onRead: vi.fn(),
    onAttach: vi.fn(),
    ...overrides,
  };
  render(<Conversation {...props} />);
  return props;
}

afterEach(cleanup);

describe("Conversation: typing line", () => {
  it("shows who is typing when the room says so", () => {
    renderConv({ room: { ...room, typingNames: ["jdoe"] } });
    expect(screen.getByText("jdoe is typing…")).toBeTruthy();
  });

  it("pluralises for multiple typists", () => {
    renderConv({ room: { ...room, typingNames: ["jdoe", "ana"] } });
    expect(screen.getByText("jdoe, ana are typing…")).toBeTruthy();
  });

  it("shows no typing line when nobody is typing", () => {
    renderConv();
    expect(screen.queryByText(/typing…/)).toBeNull();
  });
});

describe("Conversation: typing OUT (throttled)", () => {
  it("announces once when typing starts, not on every keystroke", () => {
    const props = renderConv();
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "h" } });
    fireEvent.change(box, { target: { value: "he" } }); // < 3 s later: no re-announce
    expect(props.onTyping).toHaveBeenCalledTimes(1);
    expect(props.onTyping).toHaveBeenCalledWith(true);
  });

  it("cancels the typing signal when the draft empties", () => {
    const props = renderConv();
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.change(box, { target: { value: "" } });
    expect(props.onTyping).toHaveBeenCalledWith(false);
  });

  it("cancels typing when Enter sends the message", () => {
    const props = renderConv();
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: false });
    expect(props.onSend).toHaveBeenCalledWith("hello");
    expect(props.onTyping).toHaveBeenCalledWith(false);
  });
});

describe("Conversation: Seen", () => {
  it("shows Seen when a receipt reaches my last message", () => {
    renderConv({ receipts: [{ userId: "@jdoe:mako", eventId: "$b", ts: 10 }] });
    expect(screen.getByText("Seen")).toBeTruthy();
  });

  it("does not show Seen for a receipt on an earlier message", () => {
    renderConv({ receipts: [{ userId: "@jdoe:mako", eventId: "$a", ts: 10 }] });
    expect(screen.queryByText("Seen")).toBeNull();
  });

  it("counts a receipt on a LATER message as seen for my earlier one", () => {
    const withReply: MakoMessage[] = [
      ...messages,
      { eventId: "$c", senderId: "@jdoe:mako", senderName: "jdoe", body: "great", ts: 3, isMine: false, kind: "text" },
    ];
    renderConv({
      messages: withReply,
      receipts: [{ userId: "@jdoe:mako", eventId: "$c", ts: 10 }],
    });
    expect(screen.getByText("Seen")).toBeTruthy();
  });
});

describe("Conversation: auto-read", () => {
  it("marks the room read when there are messages", () => {
    const props = renderConv();
    expect(props.onRead).toHaveBeenCalled();
  });

  it("does not mark read an empty room", () => {
    const props = renderConv({ messages: [] });
    expect(props.onRead).not.toHaveBeenCalled();
  });
});

describe("Conversation: file sharing (Batch 5)", () => {
  const mediaMessages: MakoMessage[] = [
    { eventId: "$i", senderId: "@jdoe:mako", senderName: "jdoe", body: "beach.png", ts: 10, isMine: false, kind: "image", mxcUrl: "mxc://mako/i1", mimetype: "image/png", size: 90000 },
    { eventId: "$f", senderId: "@jdoe:mako", senderName: "jdoe", body: "report.pdf", ts: 11, isMine: false, kind: "file", mxcUrl: "mxc://mako/f1", mimetype: "application/pdf", size: 2048 },
    { eventId: "$t", senderId: "@jdoe:mako", senderName: "jdoe", body: "plain text", ts: 12, isMine: false, kind: "text" },
  ];

  it("renders an inline image that links to the full-size original", () => {
    renderConv({ messages: mediaMessages });
    const img = screen.getByAltText("beach.png") as HTMLImageElement;
    expect(img.src).toContain("http://media/thumb/mxc://mako/i1");
    expect(img.closest("a")?.getAttribute("href")).toContain("http://media/full/mxc://mako/i1");
  });

  it("renders a file card with name, human size, and a download link", () => {
    renderConv({ messages: mediaMessages });
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    const download = screen.getAllByText("Download")[0] as HTMLAnchorElement;
    expect(download.getAttribute("href")).toContain("http://media/full/mxc://mako/f1");
    expect(download.getAttribute("download")).toBe("report.pdf");
  });

  it("shows the files drawer with every shared file, toggled from the header", () => {
    renderConv({ messages: mediaMessages });
    fireEvent.click(screen.getByTitle("Files shared in this room"));
    const drawer = screen.getByLabelText("Files in this room");
    expect(drawer.textContent).toContain("beach.png");
    expect(drawer.textContent).toContain("report.pdf");
    fireEvent.click(screen.getByTitle("Files shared in this room"));
    expect(screen.queryByLabelText("Files in this room")).toBeNull();
  });

  it("hands a picked file to onAttach", () => {
    const props = renderConv();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onAttach).toHaveBeenCalledWith(file);
  });

  it("shows upload progress as a status line", () => {
    renderConv({ uploading: { name: "big.zip", pct: 42 } });
    expect(screen.getByRole("status").textContent).toContain("42%");
    expect(screen.getByRole("status").textContent).toContain("big.zip");
  });

  it("shows an upload notice as an alert", () => {
    renderConv({ notice: "Upload failed. Please try again." });
    expect(screen.getByRole("alert").textContent).toContain("Upload failed");
  });
})
