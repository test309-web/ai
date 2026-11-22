
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  model: string;
  messages: ChatMessage[];
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
  // 1. Check Playground password
  const suppliedPassword =
    req.headers.get("x-playground-password") || "";

  const expectedPassword = process.env.PLAYGROUND_PASSWORD;

  if (!expectedPassword) {
    return errorResponse("Server configuration is incomplete.", 500);
  }

  if (suppliedPassword !== expectedPassword) {
    return errorResponse(
      "Access denied. Check the playground password.",
      401
    );
  }

  // 2. Check Oracle configuration
  const baseUrl = process.env.ORACLE_AI_URL?.replace(/\/+$/, "");
  const apiToken = process.env.ORACLE_API_TOKEN;

  if (!baseUrl || !apiToken) {
    return errorResponse(
      "Oracle AI server configuration is incomplete.",
      500
    );
  }

  // 3. Validate request body
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

  // 4. Validate model
  if (typeof model !== "string" || !allowedModels.has(model)) {
    return errorResponse("This model is not enabled.", 403);
  }

  // 5. Validate conversation length
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 30
  ) {
    return errorResponse("Invalid conversation length.", 400);
  }

  // 6. Validate every message
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

    if (
      item.role !== "user" &&
      item.role !== "assistant"
    ) {
      return errorResponse("Invalid message role.", 400);
    }

    if (
      typeof item.content !== "string" ||
      item.content.trim().length === 0 ||
      item.content.length > 6000
    ) {
      return errorResponse(
        "Message content is invalid or too long.",
        400
      );
    }

    cleanMessages.push({
      role: item.role,
      content: item.content,
    });
  }

  // 7. Connect to Oracle AI Gateway
  try {
    const upstream = await fetch(`${baseUrl}/v1/chat`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiToken,
      },

      body: JSON.stringify({
        model,
        messages: cleanMessages,
      }),

      signal: AbortSignal.timeout(55000),
      cache: "no-store",
    });

    // 8. Handle Oracle response
    if (!upstream.ok) {
      if (upstream.status === 429) {
        return errorResponse(
          "AI request limit reached. Please try again later.",
          429
        );
      }

      return errorResponse(
        "AI engine request failed. Check Oracle backend.",
        502
      );
    }

    const data: unknown = await upstream.json();

    if (
      typeof data !== "object" ||
      data === null ||
      !("message" in data) ||
      typeof data.message !== "string" ||
      data.message.length === 0
    ) {
      return errorResponse(
        "No valid AI response received.",
        502
      );
    }

    // 9. Return AI response to frontend
    return NextResponse.json(
      {
        message: data.message,
        model,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );

  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "TimeoutError"
    ) {
      return errorResponse(
        "Oracle AI request timed out.",
        504
      );
    }

    return errorResponse(
      "Unable to connect to Oracle AI server.",
      502
    );
  }
}
