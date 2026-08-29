"use client";

import { useState } from "react";


export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="shell">
      <h1>Software Factory</h1>
      <p className="muted">Local multi-agent factory. Sign in with the app password.</p>
      <form
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setPending(true);
            const res = await fetch("/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            });
            setPending(false);
            if (!res.ok) {
              setError(((await res.json()) as { error?: string }).error ?? "login failed");
              return;
            }
            window.location.href = "/open";
          })();
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="FACTORY_APP_PASSWORD"
        />
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit" disabled={pending}>
          Continue
        </button>
      </form>
    </div>
  );
}
