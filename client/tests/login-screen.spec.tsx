import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginScreen, friendlyError } from "../src/components/LoginScreen";

// The component is tested against the WRAPPER, not the SDK — one mock level
// deep, and the component's real dependency is exercised. vi.mock replaces
// only the async login; pure helpers stay real via importOriginal.
vi.mock("../src/matrix/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/matrix/client")>()),
  login: vi.fn(),
  lastServerUrl: vi.fn().mockReturnValue("http://mako-server:8008"),
  rememberServerUrl: vi.fn(),
}));

import { login, type MakoSession } from "../src/matrix/client";

beforeEach(() => {
  vi.mocked(login).mockReset();
});
afterEach(cleanup); // vitest globals are off, so RTL auto-cleanup is too

const goodSession: MakoSession = {
  baseUrl: "http://mako-server:8008",
  userId: "@jdoe:mako",
  accessToken: "t",
  deviceId: "d",
};

function fillAndSubmit(user: string, pass: string) {
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: user } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: pass } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginScreen", () => {
  it("shows the MAKO CHAT brand", () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByText("MAKO CHAT")).toBeTruthy();
    expect(screen.getByText("Institutional messaging. Institution owned.")).toBeTruthy();
  });

  it("refuses an empty submit with a visible message and no login call", async () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(login).not.toHaveBeenCalled();
  });

  it("logs in with the typed credentials and hands the session up", async () => {
    const onLogin = vi.fn();
    vi.mocked(login).mockResolvedValue(goodSession);
    render(<LoginScreen onLogin={onLogin} />);

    fillAndSubmit("jdoe", "correct-horse");

    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith("http://mako-server:8008", "jdoe", "correct-horse");
    expect(onLogin).toHaveBeenCalledWith(goodSession);
  });

  it("surfaces a friendly error when the wrapper rejects", async () => {
    vi.mocked(login).mockRejectedValue({ httpStatus: 403, errcode: "M_FORBIDDEN" });
    render(<LoginScreen onLogin={vi.fn()} />);

    fillAndSubmit("jdoe", "wrong");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("not right");
  });
});

describe("friendlyError", () => {
  it("explains bad credentials", () => {
    expect(friendlyError({ httpStatus: 403, errcode: "M_FORBIDDEN" })).toContain("not right");
  });
  it("explains an unreachable server", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toContain("Could not reach");
  });
  it("passes through unknown messages", () => {
    expect(friendlyError(new Error("weird thing"))).toBe("weird thing");
  });
});
