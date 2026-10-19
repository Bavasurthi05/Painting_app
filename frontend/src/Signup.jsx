
import { useState } from "react";
import "./Signup.css";
import PainterMascot from "./PainterMascot";
import { registerAccount } from "./measurementApi";

function Signup({ onLoginClick, onSignupSuccess }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (
      !form.name.trim() ||
      !form.phone.trim() ||
      !form.email.trim() ||
      !form.password ||
      !form.confirmPassword
    ) {
      setMessage("Please fill in all fields.");
      return;
    }

    if (!/^[A-Za-z ]+$/.test(form.name.trim())) {
      setMessage("Name should contain only letters and spaces.");
      return;
    }

    if (!/^[6-9]\d{9}$/.test(form.phone)) {
      setMessage("Enter a valid 10-digit Indian mobile number.");
      return;
    }

    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setMessage("Please enter a valid email address.");
      return;
    }


    if (form.password.length < 8) {
      setMessage("Password must have at least 8 characters.");
      return;
    }

    if (!/[A-Z]/.test(form.password) ||
        !/[a-z]/.test(form.password) ||
        !/[0-9]/.test(form.password)) {
      setMessage(
        "Password needs uppercase, lowercase, and a number."
      );
      return;
    }

    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const result = await registerAccount({
        name: form.name.trim(),
        phone: form.phone,
        email: form.email.trim(),
        password: form.password,
      });
      onSignupSuccess(result.user);
    } catch (error) {
      setMessage(error.message || "Could not create the account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-panel">
        <a className="signup-brand" href="/">
          <span className="signup-brand-icon">⌂</span>
          <span>
            <strong>Paint<span>Wise</span></strong>
            <small>Measure · Estimate · Transform</small>
          </span>
          <PainterMascot />
        </a>

        <div className="signup-heading">
          <span className="signup-eyebrow">START YOUR JOURNEY</span>
          <h1>Create Account</h1>
          <p>
            Join PaintWise and start planning your painting
            projects with confidence.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="signup-form" noValidate>
          <div className="signup-field">
            <label htmlFor="signup-name">Full Name</label>
            <input
              id="signup-name"
              name="name"
              type="text"
              placeholder="Enter your full name"
              autoComplete="name"
              value={form.name}
              onChange={handleChange}
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-phone">Phone Number</label>
            <input
              id="signup-phone"
              name="phone"
              type="tel"
              placeholder="10-digit mobile number"
              autoComplete="tel-national"
              maxLength={10}
              value={form.phone}
              onChange={(event) => {
                const phone = event.target.value.replace(/\D/g, "");
                setForm({ ...form, phone });
              }}
            />
          </div>

          <div className="signup-field full-width">
            <label htmlFor="signup-email">Email Address</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              placeholder="Create password"
              autoComplete="new-password"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-confirm">Confirm Password</label>
            <input
              id="signup-confirm"
              name="confirmPassword"
              type="password"
              placeholder="Re-enter password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={handleChange}
            />
          </div>

          <button className="signup-submit" type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create Account"} <span>→</span>
          </button>

          {message && (
            <p className="signup-message" role="status">
              {message}
            </p>
          )}

          <p className="signup-login">
            Already have an account?
            <button type="button" onClick={onLoginClick}>
              Sign In
            </button>
          </p>
        </form>
      </section>

      
<aside className="signup-art">
  <div className="signup-art-content">
    <div className="signup-benefits">
      
    </div>
  </div>
</aside>

    </main>
  );
}

export default Signup;
