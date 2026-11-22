"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

const MODELS = [{ id: "gemma3:4b", label: "Gemma 3 4B" }];

export default function Home() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("softatlas-playground-pass");
    if (saved) {
      setPassword(saved);
      setUnlocked(true);
    }
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function unlock(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    sessionStorage.setItem("softatlas-playground-pass", password);
    setUnlocked(true);
    setError("");
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();

    const content = input.trim();
    if (!content || busy) return;

    const next: Message[] = [...messages, { role: "user", content }];
    const controller = new AbortController();

    abortRef.current = controller;
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-playground-password": password,
          "Accept": "application/x-ndjson",
        },
        body: JSON.stringify({ model, messages: next }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
          const data = await response.json();
          if (typeof data.error === "string") message = data.error;
        } catch {
          // Keep the HTTP status message if the response is not JSON.
        }
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("The AI stream is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let finished = false;

      const updateAssistant = (value: string) => {
        setMessages((current) => {
          const updated = [...current];
          const lastIndex = updated.length - 1;

          if (lastIndex >= 0 && updated[lastIndex].role === "assistant") {
            updated[lastIndex] = { role: "assistant", content: value };
          }

          return updated;
        });
      };

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const chunk = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };

        if (chunk.error) {
          throw new Error(chunk.error);
        }

        const piece = chunk.message?.content;
        if (typeof piece === "string" && piece.length > 0) {
          assistantText += piece;
          updateAssistant(assistantText);
        }

        if (chunk.done) {
          finished = true;
        }
      };

      while (!finished) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          processLine(line);
          if (finished) break;
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);

      if (!assistantText.trim()) {
        throw new Error("The AI returned an empty response.");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Generation stopped.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");

        // Remove the empty assistant placeholder if the request failed
        // before the model generated any text.
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.role === "assistant" && !last.content) {
            return current.slice(0, -1);
          }
          return current;
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setError("");
  }

  if (!unlocked) {
    return (
      <main className="gate">
        <form className="gate-card" onSubmit={unlock}>
          <div className="logo-mark">S</div>
          <p className="eyebrow">PRIVATE MODEL TESTING</p>
          <h1>
            SoftAtlas <span>AI</span>
          </h1>
          <p className="muted">
            Enter the private access password to open the playground.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Access password"
            autoFocus
          />
          <button className="primary" type="submit">
            Enter playground <span>→</span>
          </button>
          <p className="tiny">Private testing environment</p>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-mark small">S</div>
          <div>
            <b>SoftAtlas</b>
            <small>AI PLAYGROUND</small>
          </div>
        </div>

        <button className="new-chat" onClick={reset}>
          ＋ <span>New chat</span>
        </button>

        <div className="side-note">
          <span className="dot" /> Private testing
        </div>

        <div className="sidebar-bottom">
          <div className="avatar">SA</div>
          <div>
            <b>Guest tester</b>
            <small>Limited access</small>
          </div>
          <button
            className="logout"
            title="Lock playground"
            onClick={() => {
              abortRef.current?.abort();
              sessionStorage.removeItem("softatlas-playground-pass");
              setUnlocked(false);
              setPassword("");
            }}
          >
            ↪
          </button>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <span className="mobile-brand">SoftAtlas AI</span>
            <span className="status">
              <i /> Engine connected through secure gateway
            </span>
          </div>

          <label className="model-picker">
            MODEL
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            >
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">✳</div>
              <p className="eyebrow">SOFTATLAS AI ENGINE</p>
              <h1>
                What would you
                <br />
                <span>like to explore?</span>
              </h1>
              <p className="muted">
                Test the selected AI models and explore their capabilities.
              </p>
              <div className="suggestions">
                {[
                  "Explain how AI agents work",
                  "Write a professional email",
                  "Give me three startup ideas",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={index}>
                  <div className="message-avatar">
                    {message.role === "user" ? "Y" : "S"}
                  </div>
                  <div>
                    <small>
                      {message.role === "user" ? "YOU" : "SOFTATLAS AI"}
                    </small>
                    <p>
                      {message.content ||
                        (busy && index === messages.length - 1
                          ? "Thinking..."
                          : "")}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="error">{error}</div>}

          <form className="composer" onSubmit={send}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Message SoftAtlas AI..."
              rows={1}
              disabled={busy}
            />

            {busy ? (
              <button
                className="send"
                type="button"
                onClick={stopGeneration}
                aria-label="Stop generation"
                title="Stop generation"
              >
                ■
              </button>
            ) : (
              <button
                className="send"
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            )}
          </form>

          <p className="disclaimer">
            AI can make mistakes. Do not enter confidential or personal
            information.
          </p>
        </div>
      </section>
    </main>
  );
}
