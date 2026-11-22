 "use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
const MODELS = [
   { id: "gemma3:4b", label: "Gemma 3 4B" }
];

export default function Home() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("softatlas-playground-pass");
    if (saved) { setPassword(saved); setUnlocked(true); }
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

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
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-playground-password": password },
        body: JSON.stringify({ model, messages: next })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      setMessages([...next, { role: "assistant", content: data.message }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  function reset() { setMessages([]); setError(""); }

  if (!unlocked) return (
    <main className="gate">
      <form className="gate-card" onSubmit={unlock}>
        <div className="logo-mark">S</div>
        <p className="eyebrow">PRIVATE MODEL TESTING</p>
        <h1>SoftAtlas <span>AI</span></h1>
        <p className="muted">Enter the private access password to open the playground.</p>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Access password" autoFocus />
        <button className="primary" type="submit">Enter playground <span>→</span></button>
        <p className="tiny">Private testing environment</p>
      </form>
    </main>
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo-mark small">S</div><div><b>SoftAtlas</b><small>AI PLAYGROUND</small></div></div>
        <button className="new-chat" onClick={reset}>＋ <span>New chat</span></button>
        <div className="side-note"><span className="dot" /> Private testing</div>
        <div className="sidebar-bottom">
          <div className="avatar">SA</div>
          <div><b>Guest tester</b><small>Limited access</small></div>
          <button className="logout" title="Lock playground" onClick={() => { sessionStorage.removeItem("softatlas-playground-pass"); setUnlocked(false); setPassword(""); }}>↪</button>
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div><span className="mobile-brand">SoftAtlas AI</span><span className="status"><i /> Engine connected through secure gateway</span></div>
          <label className="model-picker">MODEL
            <select value={model} onChange={e => setModel(e.target.value)}>
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">✳</div>
              <p className="eyebrow">SOFTATLAS AI ENGINE</p>
              <h1>What would you<br /><span>like to explore?</span></h1>
              <p className="muted">Test the selected AI models and explore their capabilities.</p>
              <div className="suggestions">
                {["Explain how AI agents work", "Write a professional email", "Give me three startup ideas"].map(s =>
                  <button key={s} onClick={() => setInput(s)}>{s}<span>↗</span></button>
                )}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m, i) => <div className={`message ${m.role}`} key={i}>
                <div className="message-avatar">{m.role === "user" ? "Y" : "S"}</div>
                <div><small>{m.role === "user" ? "YOU" : "SOFTATLAS AI"}</small><p>{m.content}</p></div>
              </div>)}
              {busy && <div className="message assistant"><div className="message-avatar">S</div><div><small>SOFTATLAS AI</small><p className="typing">Thinking<span>.</span><span>.</span><span>.</span></p></div></div>}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="error">{error}</div>}
          <form className="composer" onSubmit={send}>
            <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Message SoftAtlas AI..." rows={1} />
            <button className="send" disabled={busy || !input.trim()} aria-label="Send message">↑</button>
          </form>
          <p className="disclaimer">AI can make mistakes. Do not enter confidential or personal information.</p>
        </div>
      </section>
    </main>
  );
}
