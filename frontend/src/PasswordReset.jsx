import { useState } from "react";
import "./App.css";
import { completePasswordReset } from "./measurementApi";

export default function PasswordReset({ token, onComplete, onCancel }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await completePasswordReset(token, password);
      onComplete();
    } catch (error) {
      setMessage(error.message || "Could not reset your password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="welcome">
          <h2>Choose a new password</h2>
          <p>Use at least 8 characters with uppercase, lowercase, and a number.</p>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="input-box">
            <input
              type="password"
              autoComplete="new-password"
              aria-label="New password"
              placeholder="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="input-box">
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Confirm new password"
              placeholder="Confirm new password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </div>
          <button className="login-button" type="submit" disabled={loading}>
            {loading ? "Updating…" : "Reset password"}
          </button>
          <button
            className="text-link"
            type="button"
            onClick={onCancel}
            disabled={loading}
          >
            Back to sign in
          </button>
          {message && (
            <p className="form-message" role="alert">
              {message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
