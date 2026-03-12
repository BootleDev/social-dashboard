"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
}

export default function ChatBox() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");
    const updated = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(updated);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: updated.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessages([
          ...updated,
          { role: "assistant", content: data.error, isError: true },
        ]);
      } else {
        setMessages([
          ...updated,
          { role: "assistant", content: data.reply || "No response" },
        ]);
      }
    } catch {
      setMessages([
        ...updated,
        { role: "assistant", content: "Error connecting to AI", isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Open AI chat"}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full text-sm font-medium shadow-lg transition-all hover:scale-105"
        style={{
          background: open ? "var(--bg-secondary)" : "var(--accent-purple)",
          color: open ? "var(--text-secondary)" : "#fff",
          border: "1px solid var(--border)",
        }}
      >
        {open ? (
          <span>Close</span>
        ) : (
          <>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Ask AI</span>
            {messages.length > 0 && (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "#22c55e" }}
              />
            )}
          </>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 rounded-xl flex flex-col shadow-2xl"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            width: "min(420px, calc(100vw - 48px))",
            height: "min(520px, calc(100vh - 140px))",
          }}
        >
          <div
            className="px-5 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--border)" }}
          >
            <div>
              <h3 className="text-sm font-semibold">Social Media Analyst</h3>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Powered by Claude — knows your social data
              </p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/10"
                style={{ color: "var(--text-secondary)" }}
              >
                Clear
              </button>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p
                  className="text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Ask anything about your social media performance. Try:
                </p>
                {[
                  "What was our best performing post this week?",
                  "How is our engagement rate trending?",
                  "Which content type works best on Instagram?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{
                      background: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={`${msg.role}-${i}`}
                className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${msg.role === "user" ? "ml-auto" : ""}`}
                style={{
                  background:
                    msg.role === "user"
                      ? "var(--accent-purple)"
                      : msg.isError
                        ? "rgba(239, 68, 68, 0.1)"
                        : "var(--bg-secondary)",
                  color: msg.isError
                    ? "var(--accent-red)"
                    : "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div
                className="text-sm rounded-lg px-3 py-2"
                style={{ background: "var(--bg-secondary)" }}
              >
                <span className="animate-pulse">Thinking...</span>
              </div>
            )}
          </div>

          <div
            className="p-3 border-t flex gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask about your social media..."
              aria-label="Chat message"
              autoFocus
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ background: "var(--accent-purple)", color: "#fff" }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
