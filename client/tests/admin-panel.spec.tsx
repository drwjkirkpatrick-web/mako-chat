import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminPanel } from "../src/components/AdminPanel";

// The panel is tested against the admin API LAYER (one mock level); its
// translation behaviour is covered in admin.spec.ts.
vi.mock("../src/matrix/admin", () => ({
  amIAdmin: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  setUserSuspended: vi.fn(),
  setUserAdmin: vi.fn(),
  resetUserPassword: vi.fn(),
  listRooms: vi.fn(),
  getStorageStats: vi.fn(),
}));

import {
  createUser,
  getStorageStats,
  listRooms,
  listUsers,
  resetUserPassword,
  setUserAdmin,
  setUserSuspended,
  type AdminUser,
} from "../src/matrix/admin";

const me: AdminUser = {
  userId: "@walker:mako", displayName: "Walker", isAdmin: true,
  isSuspended: false, isGuest: false,
};
const member: AdminUser = {
  userId: "@jdoe:mako", displayName: "Jdoe", isAdmin: false,
  isSuspended: false, isGuest: false, createdAtMs: 1000,
};
const suspended: AdminUser = {
  userId: "@old:mako", isAdmin: false, isSuspended: true, isGuest: false,
};

beforeEach(() => {
  vi.mocked(listUsers).mockReset().mockResolvedValue([me, member, suspended]);
  vi.mocked(createUser).mockReset().mockResolvedValue(undefined);
  vi.mocked(setUserSuspended).mockReset().mockResolvedValue(undefined);
  vi.mocked(setUserAdmin).mockReset().mockResolvedValue(undefined);
  vi.mocked(resetUserPassword).mockReset().mockResolvedValue(undefined);
  vi.mocked(listRooms).mockReset().mockResolvedValue([
    { roomId: "!big", name: "Announcements", members: 9 },
  ]);
  vi.mocked(getStorageStats).mockReset().mockResolvedValue({
    mediaFiles: 4,
    mediaBytes: 2148,
    byUser: [{ userId: "@b:mako", displayName: "B", count: 3, bytes: 2048 }],
    serverVersion: "1.164.2",
  });
});
afterEach(cleanup);

describe("AdminPanel", () => {
  it("lists accounts with badges, and shows no actions for (you)", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("@jdoe:mako")).toBeTruthy());
    expect(screen.getByText("admin")).toBeTruthy(); // badge on my row
    expect(screen.getByText("suspended")).toBeTruthy(); // badge on @old
    // my own row has a (you) badge and no action buttons
    expect(screen.getByText("you")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Suspend" })).toHaveLength(1); // not me
  });

  it("creates an account through the form", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    fireEvent.click(screen.getByRole("button", { name: "+ New account" }));

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "newbie" } });
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: "New Person" } });
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "longenough" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create account" }).closest("form")!);

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith("newbie", {
        displayName: "New Person",
        password: "longenough",
        isAdmin: false,
      }),
    );
    // and the list reloads
    await waitFor(() => expect(vi.mocked(listUsers).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("suspends only after a second confirming click", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    const suspend = screen.getByRole("button", { name: "Suspend" });
    fireEvent.click(suspend); // arms the confirm
    expect(setUserSuspended).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    await waitFor(() => expect(setUserSuspended).toHaveBeenCalledWith("@jdoe:mako", true));
  });

  it("resets a password inline", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    // two actionable members -> two "Reset password" buttons; first row is @jdoe
    fireEvent.click(screen.getAllByRole("button", { name: "Reset password" })[0]);
    fireEvent.change(screen.getByLabelText("New password for @jdoe:mako"), {
      target: { value: "brandnewpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    await waitFor(() =>
      expect(resetUserPassword).toHaveBeenCalledWith("@jdoe:mako", "brandnewpass"),
    );
  });

  it("toggles admin rights", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    // two members are non-admin -> two "Make admin" buttons; the first row is @jdoe
    const makeAdmin = screen.getAllByRole("button", { name: "Make admin" })[0];
    fireEvent.click(makeAdmin);
    await waitFor(() => expect(setUserAdmin).toHaveBeenCalledWith("@jdoe:mako", true));
  });

  it("shows the rooms overview on the Rooms tab", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    await waitFor(() => expect(screen.getByText("Announcements")).toBeTruthy());
    expect(screen.getByText("9 members")).toBeTruthy();
  });

  it("shows storage stats and the security summary on the Storage tab", async () => {
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("@jdoe:mako"));
    fireEvent.click(screen.getByRole("button", { name: "Storage" }));
    await waitFor(() => expect(screen.getByText("1.164.2")).toBeTruthy());
    expect(screen.getByText("4")).toBeTruthy(); // file count
    expect(screen.getByText("2.1 KB")).toBeTruthy(); // humanSize(2148)
    expect(screen.getByText(/Self-registration is disabled/)).toBeTruthy();
  });

  it("surfaces admin API errors as alerts", async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error("You are not a server admin"));
    render(<AdminPanel myUserId="@walker:mako" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("You are not a server admin"),
    );
  });
});
