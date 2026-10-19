
import { useState } from "react";
import "./App.css";
import PainterMascot from "./PainterMascot";
import {
  API_BASE_URL,
  loginAccount,
  requestPasswordReset,
} from "./measurementApi";

function Login({ onSignupClick, onLoginSuccess, initialMessage = "" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setMessage("");

    if (!email.trim() || !password) {
      setMessage("Please enter your email and password.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMessage("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const result = await loginAccount({
        email: email.trim(),
        password,
        remember,
      });
      onLoginSuccess(result.user);
    } catch (error) {
      setMessage(error.message || "Could not sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecovery() {
    setMessage("");
    if (!email.trim()) {
      setMessage("Enter your email address to receive a reset link.");
      return;
    }
    setLoading(true);
    try {
      const result = await requestPasswordReset(email.trim());
      setMessage(result.message);
    } catch (error) {
      setMessage(error.message || "Could not request a password reset.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <path
                d="M8 29L32 8L56 29M15 24V55M49 24V37"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 30H43C46 30 48 32 48 35V39H39V54"
                stroke="#F9A20B"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div>
            <h1 className="brand-name">
              Paint<span>Wise</span>
            </h1>
            <p className="brand-tagline">
              Measure · Estimate · Transform
            </p>
          </div>
          <PainterMascot />
        </div>

        <div className="welcome">
          <h2>{recovering ? "Reset your password" : "Welcome Back!"}</h2>
          <p>
            {recovering
              ? "Enter your email address and we’ll send a secure reset link."
              : "Sign in to your account and continue planning your painting projects."}
          </p>
        </div>

        <form
          onSubmit={
            recovering
              ? (event) => {
                  event.preventDefault();
                  void handleRecovery();
                }
              : handleLogin
          }
          noValidate
        >
          <div className="input-box">
            <span className="input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M4 7L12 13L20 7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </span>

            <input
              type="email"
              placeholder="Email Address"
              aria-label="Email address"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {!recovering && <div className="input-box">
            <span className="input-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="4"
                  y="10"
                  width="16"
                  height="11"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M8 10V7A4 4 0 0116 7V10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <circle cx="12" cy="15" r="1.3" fill="currentColor" />
              </svg>
            </span>

            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button
              className="eye-button"
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>}

          <div className="form-options">
            {!recovering && (
              <label className="remember-option">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span>Remember me</span>
              </label>
            )}

            <button
              className="text-link"
              type="button"
              onClick={() => {
                setRecovering((current) => !current);
                setMessage("");
              }}
            >
              {recovering ? "Back to login" : "Forgot password?"}
            </button>
          </div>

          {recovering ? (
            <button className="login-button" type="submit" disabled={loading}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          ) : (
            <button className="login-button" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Login"} <span aria-hidden="true">→</span>
            </button>
          )}

          {message && (
            <p className="form-message" role="alert">
              {message}
            </p>
          )}

          {!recovering && (
            <>
              <div className="divider">
                <span></span>
                <p>OR</p>
                <span></span>
              </div>

              <button
                className="google-button"
                type="button"
                onClick={() =>
                  window.location.assign(`${API_BASE_URL}/auth/google`)
                }
              >
                <span className="google-g">G</span>
                Continue with Google
              </button>

              <p className="signup-text">
                Don’t have an account?
                <button
                  type="button"
                  className="text-link signup-link"
                  onClick={onSignupClick}
                >
                  Sign Up
                </button>
              </p>
            </>
          )}
        </form>
      </section>

      <section
        className="painting-panel"
        aria-label="Painting inspiration"
      >
        <div className="image-overlay">
          
        </div>
      </section>
    </main>
  );
}

export default Login;
