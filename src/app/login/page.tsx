"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.push("/dashboard");
    } else {
      setError("Wrong password");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div
        className="w-full max-w-sm p-8 rounded-2xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <h1 className="text-2xl font-bold mb-1">Bootle</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          Social Intelligence Dashboard
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-lg text-sm outline-none mb-4"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
            autoFocus
          />
          {error && (
            <p className="text-sm mb-3" style={{ color: "var(--accent-red)" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-medium transition-opacity"
            style={{ background: "var(--accent-blue)", color: "#fff" }}
          >
            {loading ? "..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
