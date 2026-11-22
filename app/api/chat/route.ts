import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Vercel/platform limits still apply. Increase this only if your deployment
// plan supports it. Streaming keeps the connection active while Ollama works.
export const maxDuration = 300;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const allowedModels = new Set(
  (process.env.ALLOWED_MODELS || "gemma3:4b")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean)
);

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function POST(req: NextRequest) {
  // 1. Check Playground password.
  const suppliedPassword = req.headers.get("x-playground-password") || "";
  const expectedPassword = process.env.PLAYGROUND_PASSWORD;

  if (!expectedPassword) {
    return errorResponse("Server configuration is incomplete.", 500);
  }

  if (suppliedPassword !== expectedPassword) {
    return errorResponse("Access denied. Check the playground password.", 401);
  }

  // 2. Check Oracle configuration.
  const baseUrl = process.env.ORACLE_AI_URL?.replace(/\/+$/, "");
  const apiToken = process.env.ORACLE_API_TOKEN;

  if (!baseUrl || !apiToken) {
    return errorResponse("Oracle AI server configuration is incomplete.", 500);
  }

  // 3. Validate request body.
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON request.", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("model" in body) ||
    !("messages" in body)
  ) {
    return errorResponse("Invalid request body.", 400);
  }

  const requestBody = body as Record<string, unknown>;
  const model = requestBody.model;
  const messages = requestBody.messages;

  // 4. Validate model.
  if (typeof model !== "string" || !allowedModels.has(model)) {
    return errorResponse("This model is not enabled.", 403);
  }

  // 5. Validate conversation length.
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) {
    return errorResponse("Invalid conversation length.", 400);
  }

  // 6. Validate every message.
  const cleanMessages: ChatMessage[] = [];

  for (const message of messages) {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      !("content" in message)
    ) {
      return errorResponse("Invalid message format.", 400);
    }

    const item = message as Record<string, unknown>;

    if (item.role !== "user" && item.role !== "assistant") {
      return errorResponse("Invalid message role.", 400);
    }

    if (
      typeof item.content !== "string" ||
      item.content.trim().length === 0 ||
      item.content.length > 6000
    ) {
      return errorResponse("Message content is invalid or too long.", 400);
    }

    cleanMessages.push({
      role: item.role,
      content: item.content,
    });
  }

  // 7. Forward the streaming response from the private Oracle gateway.
  // There is deliberately no short AbortSignal.timeout(55000) here.
  try {
    const upstream = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiToken,
        "Accept": "application/x-ndjson",
      },
      body: JSON.stringify({
        model,
        messages: cleanMessages,
        stream: true,
      }),
      signal: req.signal,
      cache: "no-store",
    });

    if (!upstream.ok) {
      const upstreamText = await upstream.text().catch(() => "");

      if (upstream.status === 429) {
        return errorResponse(
          "AI request limit reached. Please try again later.",
          429
        );
      }

      console.error("Oracle gateway error:", upstream.status, upstreamText);
      return errorResponse(
        "AI engine request failed. Check Oracle backend.",
        upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502
      );
    }

    if (!upstream.body) {
      return errorResponse("Oracle gateway returned an empty stream.", 502);
    }

    // Pass Ollama NDJSON chunks through to the browser without buffering.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (req.signal.aborted) {
      // The browser intentionally stopped or left the request.
      return new Response(null, { status: 499 });
    }

    console.error("Oracle connection error:", error);
    return errorResponse("Unable to connect to Oracle AI server.", 502);
  }
}
