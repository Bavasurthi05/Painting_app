import { useEffect, useState } from "react";
import { getProfile, updateProfile } from "./measurementApi";
import "./Profile.css";

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatCreatedAt(value) {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function Profile({ onLogout, loggingOut, logoutError }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function renderAccountActions() {
    return (
      <div className="profile-account-actions">
        {logoutError && (
          <p className="profile-message profile-message-error" role="alert">
            {logoutError}
          </p>
        )}
        <button
          className="profile-logout-button"
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Saving…" : "Logout"}
        </button>
      </div>
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    getProfile({ signal: controller.signal })
      .then(({ profile: loadedProfile }) => {
        setProfile(loadedProfile);
        setForm({ name: loadedProfile.name, phone: loadedProfile.phone });
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Could not load your profile.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadAttempt]);

  function cancelEditing() {
    setForm({ name: profile.name, phone: profile.phone });
    setEditing(false);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();
    const hasControlCharacters = Array.from(name).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127;
    });
    if (!name || name.length > 120 || hasControlCharacters) {
      setError("Enter a name between 1 and 120 characters.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter a valid 10-digit Indian phone number.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await updateProfile({ name, phone });
      setProfile(result.profile);
      setForm({ name: result.profile.name, phone: result.profile.phone });
      setEditing(false);
      setSuccess("Your profile was updated successfully.");
    } catch (saveError) {
      setError(saveError.message || "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="profile-page" aria-live="polite">
        <p className="profile-state">Loading your profile…</p>
        {renderAccountActions()}
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="profile-page">
        <p className="profile-state profile-state-error" role="alert">
          {error || "Your profile could not be loaded."}
        </p>
        <button
          className="profile-primary-button"
          type="button"
          onClick={() => {
            setError("");
            setLoading(true);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Retry
        </button>
        {renderAccountActions()}
      </section>
    );
  }

  const createdAt = formatCreatedAt(profile.createdAt);

  return (
    <section className="profile-page" id="profile">
      <div className="profile-heading">
        <div>
          <span className="profile-eyebrow">ACCOUNT</span>
          <h1>Profile</h1>
          <p>View and manage your PaintWise account details.</p>
        </div>
        {!editing && (
          <button
            className="profile-primary-button"
            type="button"
            onClick={() => {
              setError("");
              setSuccess("");
              setEditing(true);
            }}
          >
            Edit profile
          </button>
        )}
      </div>

      {error && <p className="profile-message profile-message-error" role="alert">{error}</p>}
      {success && <p className="profile-message profile-message-success" role="status">{success}</p>}

      <div className="profile-card">
        <div className="profile-summary">
          <div className="profile-avatar" aria-label={`${profile.name} initials`}>
            {getInitials(profile.name)}
          </div>
          <div className="profile-summary-text">
            <h2>{profile.name}</h2>
            <p>{profile.email}</p>
          </div>
        </div>

        {editing ? (
          <form className="profile-form" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                autoComplete="name"
                maxLength={120}
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              Email address
              <input type="email" value={profile.email} readOnly />
              <span className="profile-field-hint">Email changes are not available.</span>
            </label>
            <label>
              Phone number
              <input
                autoComplete="tel"
                inputMode="numeric"
                maxLength={10}
                pattern="[6-9][0-9]{9}"
                required
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
              <span className="profile-field-hint">Enter a 10-digit Indian mobile number.</span>
            </label>
            <div className="profile-form-actions">
              <button className="profile-primary-button" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                className="profile-secondary-button"
                type="button"
                onClick={cancelEditing}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="profile-details">
            <div>
              <dt>Full name</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{profile.email}</dd>
            </div>
            <div>
              <dt>Phone number</dt>
              <dd>{profile.phone || "Not provided"}</dd>
            </div>
            {createdAt && (
              <div>
                <dt>Account created</dt>
                <dd>{createdAt}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {renderAccountActions()}
    </section>
  );
}

export default Profile;
