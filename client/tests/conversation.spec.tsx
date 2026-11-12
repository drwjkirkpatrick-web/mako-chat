import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Conversation } from "../src/components/Conversation";
import type { MakoMessage, MakoReceipt, MakoRoom } from "../src/matrix/client";

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
  { eventId: "$a", senderId: "@jdoe:mako", senderName: "jdoe", body: "hey", ts: 1, isMine: false },
  { eventId: "$b", senderId: ME, senderName: "me", body: "hi!", ts: 2, isMine: true },
];

function renderConv(overrides: Record<string, unknown> = {}) {
  const props = {
    room,
    messages,
    receipts: [] as MakoReceipt[],
    myUserId: ME,
    onSend: vi.fn(),
    onTyping: vi.fn(),
    onRead: vi.fn(),
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
      { eventId: "$c", senderId: "@jdoe:mako", senderName: "jdoe", body: "great", ts: 3, isMine: false },
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
