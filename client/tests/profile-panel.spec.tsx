import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfilePanel } from "../src/components/ProfilePanel";
import type { MakoProfile } from "../src/matrix/client";

// The panel resolves the avatar URL through the wrapper — mock just that.
vi.mock("../src/matrix/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/matrix/client")>()),
  mxcToHttp: vi.fn(() => "http://media/avatar"),
}));

afterEach(cleanup);

const profile: MakoProfile = { displayName: "Walker", avatarMxc: "mxc://mako/av1" };

function renderPanel(overrides: Record<string, unknown> = {}) {
  const props = {
    profile,
    myUserId: "@walker:mako",
    busy: false,
    error: null as string | null,
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ProfilePanel {...props} />);
  return props;
}

describe("ProfilePanel", () => {
  it("shows the current name and the sign-in name", () => {
    renderPanel();
    expect(screen.getByLabelText("Display name")).toHaveProperty("value", "Walker");
    expect(screen.getByText(/@walker:mako/)).toBeTruthy();
  });

  it("keeps Save disabled until something changes", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("saves a changed name", () => {
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Walker K." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledWith({ displayName: "Walker K.", avatarFile: undefined });
  });

  it("saves a new picture together with the name", () => {
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "W." } });
    const input = screen.getByLabelText("Choose a new profile picture");
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("Will replace: me.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledWith({ displayName: "W.", avatarFile: file });
  });

  it("shows an error and stays open when saving failed", () => {
    renderPanel({ error: "Could not save. Please try again." });
    expect(screen.getByRole("alert").textContent).toContain("Could not save");
  });

  it("closes via Cancel", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
