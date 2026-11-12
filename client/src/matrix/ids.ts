// Pure helpers for user-ID shapes — no SDK, no network, fully testable.
//
// A Matrix user ID looks like "@jdoe:mako". Institution members mostly know
// their SHORT name ("jdoe"), so the UI accepts every spelling people type:
//   "jdoe"          -> "@jdoe:mako"   (bare localpart — most common)
//   "@jdoe"         -> "@jdoe:mako"
//   "jdoe:mako"     -> "@jdoe:mako"
//   "@jdoe:mako"    -> unchanged
// The server part is taken from MY OWN user id — everyone on one server
// shares it, so users never need to type it.

export function expandUserId(input: string, myUserId: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const server = myUserId.split(":")[1] ?? "";
  if (!server) return null; // malformed myUserId — refuse rather than guess

  let candidate = raw;
  if (!candidate.startsWith("@")) candidate = "@" + candidate;
  if (!candidate.slice(1).includes(":")) candidate = candidate + ":" + server;

  // Final shape check: "@localpart:server" — neither part may contain
  // colons or spaces.
  if (!/^@[^:@\s]+:[^:@\s]+$/.test(candidate)) return null;
  return candidate;
}
