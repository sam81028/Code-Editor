import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, saveSession } from "../lib/api";

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: form,
      });
      saveSession(data);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">Shared coding rooms</p>
        <h1>CodeRoom</h1>
        <p>
          Create password-protected rooms with public links, shared files, live
          collaborators, and a cloud-backed execution console.
        </p>
      </section>

      <form className="auth-panel" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Start collaborating</p>
          <h2>Create account</h2>
        </div>

        <label>
          Name
          <input
            autoComplete="name"
            name="name"
            onChange={handleChange}
            placeholder="Ada Lovelace"
            value={form.name}
          />
        </label>

        <label>
          Email
          <input
            autoComplete="email"
            name="email"
            onChange={handleChange}
            placeholder="you@example.com"
            type="email"
            value={form.email}
          />
        </label>

        <label>
          Password
          <input
            autoComplete="new-password"
            name="password"
            onChange={handleChange}
            placeholder="At least 6 characters"
            type="password"
            value={form.password}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="primary-action" disabled={loading} type="submit">
          {loading ? "Creating..." : "Create account"}
        </button>

        <p className="muted-line">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}

export default Register;
