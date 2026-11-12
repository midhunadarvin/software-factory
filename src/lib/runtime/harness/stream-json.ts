import type { LlmStreamPart } from "../llm";

export type StreamJsonAcc = { live?: boolean };

function pushText(parts: LlmStreamPart[], delta: string) {
  if (delta) parts.push({ type: "text", delta });
}

function pushThinking(parts: LlmStreamPart[], delta: string) {
  if (delta) parts.push({ type: "thinking", delta });
}

function fromContentBlocks(content: unknown, parts: LlmStreamPart[]) {
  if (typeof content === "string") {
    pushText(parts, content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const o = block as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type : "";
    if (type === "thinking" || type === "reasoning" || type === "redacted_thinking") {
      const t = typeof o.thinking === "string" ? o.thinking : typeof o.text === "string" ? o.text : "";
      pushThinking(parts, t);
      continue;
    }
    if (type === "text" || typeof o.text === "string") {
      if (typeof o.text === "string") pushText(parts, o.text);
    }
    if (type === "tool_use" || type === "tool_call") {
      const name = typeof o.name === "string" ? o.name : "tool";
      parts.push({ type: "tool", delta: "", tool: name });
    }
  }
}

function fromDelta(delta: unknown, parts: LlmStreamPart[]) {
  if (!delta || typeof delta !== "object") return;
  const d = delta as Record<string, unknown>;
  const dtype = typeof d.type === "string" ? d.type : "";
  if (dtype === "thinking_delta" || typeof d.thinking === "string") {
    if (typeof d.thinking === "string") pushThinking(parts, d.thinking);
  }
  if (dtype === "text_delta" || (typeof d.text === "string" && dtype !== "thinking_delta")) {
    if (typeof d.text === "string") pushText(parts, d.text);
  }
}

function innerEvent(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.event && typeof parsed.event === "object") return parsed.event as Record<string, unknown>;
  return parsed;
}

export function parseStreamJsonLine(
  line: string,
  acc?: StreamJsonAcc,
): { parts: LlmStreamPart[]; sessionId?: string } {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return { parts: [] };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { parts: [{ type: "text", delta: trimmed }] };
  }
  const parts: LlmStreamPart[] = [];
  const type = typeof parsed.type === "string" ? parsed.type : "";
  const sessionId =
    (typeof parsed.session_id === "string" && parsed.session_id) ||
    (typeof parsed.sessionId === "string" && parsed.sessionId) ||
    undefined;

  const inner = innerEvent(parsed);
  const innerType = typeof inner.type === "string" ? inner.type : type;

  if (innerType === "content_block_delta" || type === "content_block_delta" || type === "stream_event") {
    fromDelta(inner.delta ?? parsed.delta, parts);
    if (parts.length && acc) acc.live = true;
  } else if (type === "thinking") {
    const t =
      (typeof parsed.thinking === "string" && parsed.thinking) ||
      (typeof parsed.text === "string" && parsed.text) ||
      "";
    pushThinking(parts, t);
  } else if (type === "assistant" && parsed.message && typeof parsed.message === "object") {
    if (acc?.live) {
      /* deltas already streamed */
    } else {
      fromContentBlocks((parsed.message as { content?: unknown }).content, parts);
    }
  } else if (type === "tool_use" || type === "tool_call" || type.includes("tool")) {
    const name =
      (typeof parsed.name === "string" && parsed.name) ||
      (typeof parsed.tool === "string" && parsed.tool) ||
      "tool";
    parts.push({ type: "tool", delta: "", tool: name });
  } else if (typeof parsed.result === "string" && parsed.result && !acc?.live) {
    pushText(parts, parsed.result);
  } else if (typeof parsed.text === "string" && parsed.text && type !== "user" && type !== "system") {
    pushText(parts, parsed.text);
  }

  return { parts, sessionId };
}

export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let nl = rest.indexOf("\n");
  while (nl >= 0) {
    lines.push(rest.slice(0, nl));
    rest = rest.slice(nl + 1);
    nl = rest.indexOf("\n");
  }
  return { lines, rest };
}
