import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowedModels = new Set(
  (process.env.ALLOWED_MODELS || "llama3.2:1b").split(",").map(x => x.trim()).filter(Boolean)
);

export async function POST(req: NextRequest) {
  const suppliedPassword = req.headers.get("x-playground-password") || "";
  const expectedPassword = process.env.PLAYGROUND_PASSWORD || "";
  if (!expectedPassword || suppliedPassword !== expectedPassword) {
    return NextResponse.json({ error: "Access denied. Check the playground password." }, { status: 401 });
  }

  const baseUrl = process.env.ORACLE_AI_URL;
  const apiToken = process.env.ORACLE_API_TOKEN;
  if (!baseUrl || !apiToken) {
    return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
  }

  try {
    const body = await req.json();
    const model = String(body.model || "");
    const messages = body.messages;
    if (!allowedModels.has(model)) return NextResponse.json({ error: "This model is not enabled." }, { status: 403 });
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) {
      return NextResponse.json({ error: "Invalid conversation length." }, { status: 400 });
    }
    const clean = messages.map((m: any) => {
      if (!["user", "assistant"].includes(m?.role) || typeof m?.content !== "string" || m.content.length > 6000) {
        throw new Error("Invalid message format or message too long.");
      }
      return { role: m.role, content: m.content };
    });

    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiToken },
      body: JSON.stringify({ model, messages: clean }),
      signal: AbortSignal.timeout(55000),
      cache: "no-store"
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json({ error: "AI engine request failed." }, { status: 502 });
    }
    return NextResponse.json({ message: data.message || "No response returned." });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}