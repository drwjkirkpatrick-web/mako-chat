import { describe, expect, it } from "vitest";
import { expandUserId } from "../src/matrix/ids";

// The server part always comes from my own ID — users never type it.
const ME = "@walker:mako";

describe("expandUserId", () => {
  it("expands a bare localpart", () => {
    expect(expandUserId("jdoe", ME)).toBe("@jdoe:mako");
  });
  it("expands a localpart with @ but no server", () => {
    expect(expandUserId("@jdoe", ME)).toBe("@jdoe:mako");
  });
  it("expands a localpart with server but no @", () => {
    expect(expandUserId("jdoe:mako", ME)).toBe("@jdoe:mako");
  });
  it("keeps a full ID exactly as typed", () => {
    expect(expandUserId("@jdoe:mako", ME)).toBe("@jdoe:mako");
  });
  it("ignores surrounding whitespace", () => {
    expect(expandUserId("  jdoe  ", ME)).toBe("@jdoe:mako");
  });
  it("rejects empty input", () => {
    expect(expandUserId("   ", ME)).toBeNull();
  });
  it("rejects a malformed localpart (colon inside)", () => {
    expect(expandUserId("@jd:oe:mako", ME)).toBeNull();
  });
  it("rejects a malformed localpart (spaces inside)", () => {
    expect(expandUserId("@jd oe", ME)).toBeNull();
  });
});
