import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch, saveSession } from "../lib/api";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
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
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: form,
      });
      saveSession(data);
      navigate(location.state?.from || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">Browser workspace</p>
        <h1>CodeRoom</h1>
        <p>
          Join shared project rooms, edit together in Monaco, and run code from
          a backend workspace without installing local runtimes.
        </p>
      </section>

      <form className="auth-panel" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>Log in</h2>
        </div>

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
            autoComplete="current-password"
            name="password"
            onChange={handleChange}
            placeholder="At least 6 characters"
            type="password"
            value={form.password}
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button className="primary-action" disabled={loading} type="submit">
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="muted-line">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </main>
  );
}

export default Login;
