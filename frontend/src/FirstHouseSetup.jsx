import { useState } from "react";
import "./FirstHouseSetup.css";

const PROJECT_STATUSES = ["Not started", "In progress", "On hold", "Completed"];

function FirstHouseSetup({ onCreateProject, error: projectError }) {
  const [form, setForm] = useState({
    name: "",
    customerName: "",
    location: "",
    deadline: "",
    status: "Not started",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Enter a name for your first house.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onCreateProject({ ...form, name });
    } catch (createError) {
      setError(createError.message || "Could not create your house. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="first-house-content" id="projects">
        <span className="first-house-eyebrow">YOUR HOUSE PROJECTS</span>
        <h1>Add your first house</h1>
        <p className="first-house-intro">
          Start by adding a house. You can then keep its measurements, paint
          estimates, quotations, and attendance together.
        </p>

        <form className="first-house-form" onSubmit={handleSubmit}>
          <label>
            House or project name
            <input
              autoFocus
              autoComplete="organization"
              maxLength={120}
              required
              placeholder="For example, Lakshmi Residence"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            Customer name <span>(optional)</span>
            <input
              autoComplete="name"
              maxLength={120}
              value={form.customerName}
              onChange={(event) =>
                setForm({ ...form, customerName: event.target.value })
              }
            />
          </label>
          <label>
            Location <span>(optional)</span>
            <input
              autoComplete="street-address"
              maxLength={240}
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
            />
          </label>
          <label>
            Deadline <span>(optional)</span>
            <input
              type="date"
              value={form.deadline}
              onChange={(event) => setForm({ ...form, deadline: event.target.value })}
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          {(error || projectError) && (
            <p className="first-house-error" role="alert">
              {error || projectError}
            </p>
          )}
          <button className="first-house-submit" type="submit" disabled={submitting}>
            {submitting ? "Creating house…" : "Create first house"}
          </button>
        </form>
    </section>
  );
}

export default FirstHouseSetup;
