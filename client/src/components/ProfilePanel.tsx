import { useState } from "react";
import { mxcToHttp, type MakoProfile } from "../matrix/client";

/** What a profile save can change. */
export interface ProfileUpdates {
  displayName?: string;
  avatarFile?: File;
}

/**
 * The "my profile" card: shows the name and picture other members see,
 * and lets the member change either. Dumb component — the shell does the
 * server calls and hands back busy/error states.
 */
export function ProfilePanel({
  profile,
  myUserId,
  busy,
  error,
  onSave,
  onClose,
}: {
  profile: MakoProfile;
  myUserId: string;
  busy: boolean;
  error: string | null;
  onSave: (updates: ProfileUpdates) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile.displayName);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const localpart = myUserId.split(":")[0].slice(1) || "?";
  const avatarUrl = profile.avatarMxc ? mxcToHttp(profile.avatarMxc, 96, 96) : null;
  const nothingChanged = !avatarFile && name.trim() === profile.displayName;

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="profile-card"
        role="dialog"
        aria-label="My profile"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>My profile</h3>

        <div className="profile-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{localpart[0]?.toUpperCase()}</span>}
        </div>

        <div className="field">
          <label htmlFor="profile-name">Display name</label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />
        </div>

        <div className="field">
          <label htmlFor="profile-avatar">New picture</label>
          <input
            id="profile-avatar"
            type="file"
            accept="image/*"
            aria-label="Choose a new profile picture"
            onChange={(e) => setAvatarFile(e.target.files?.[0] ?? null)}
          />
          {avatarFile && <p className="muted-hint">Will replace: {avatarFile.name}</p>}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="profile-actions">
          <button className="btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || nothingChanged}
            onClick={() => onSave({ displayName: name.trim(), avatarFile: avatarFile ?? undefined })}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>

        <p className="muted-hint">Your sign-in name stays {myUserId}.</p>
      </div>
    </div>
  );
}
