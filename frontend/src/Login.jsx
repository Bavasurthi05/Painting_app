
import { useState } from "react";
import "./App.css";

function Login({ onSignupClick, onLoginSuccess}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  function handleLogin(event) {
    event.preventDefault();
    setMessage("");

    if (!email.trim() || !password) {
      setMessage("Please enter your email and password.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage("Please enter a valid email address.");
      return;
    }

    setMessage("Login successful!");
  onLoginSuccess();
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
        </div>

        <div className="welcome">
          <h2>Welcome Back!</h2>
          <p>
            Sign in to your account and continue planning
            your painting projects.
          </p>
        </div>

        <form onSubmit={handleLogin} noValidate>
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

          <div className="input-box">
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
          </div>

          <div className="form-options">
            <label className="remember-option">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>Remember me</span>
            </label>

            <button
              className="text-link"
              type="button"
              onClick={() =>
                setMessage("Password recovery will be added later.")
              }
            >
              Forgot password?
            </button>
          </div>

          <button className="login-button" type="submit">
            Login <span aria-hidden="true">→</span>
          </button>

          {message && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}

          <div className="divider">
            <span></span>
            <p>OR</p>
            <span></span>
          </div>

          <button
            className="google-button"
            type="button"
            onClick={() =>
              setMessage("Google sign-in will be connected later.")
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
