import type { LlmStreamPart } from "../llm";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const o = block as Record<string, unknown>;
      if (typeof o.text === "string") return o.text;
      if (o.type === "text" && typeof o.text === "string") return o.text;
      return "";
    })
    .join("");
}

export function parseStreamJsonLine(line: string): { parts: LlmStreamPart[]; sessionId?: string } {
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

  if (type === "assistant" && parsed.message && typeof parsed.message === "object") {
    const text = textFromContent((parsed.message as { content?: unknown }).content);
    if (text) parts.push({ type: "text", delta: text });
  } else if (type === "content_block_delta" || type === "stream_event") {
    const delta = parsed.delta;
    if (delta && typeof delta === "object") {
      const d = delta as Record<string, unknown>;
      if (typeof d.text === "string" && d.text) parts.push({ type: "text", delta: d.text });
      if (typeof d.thinking === "string" && d.thinking) parts.push({ type: "thinking", delta: d.thinking });
    }
  } else if (type === "tool_use" || type === "tool_call" || type.includes("tool")) {
    const name =
      (typeof parsed.name === "string" && parsed.name) ||
      (typeof parsed.tool === "string" && parsed.tool) ||
      "tool";
    parts.push({ type: "tool", delta: "", tool: name });
  } else if (typeof parsed.result === "string" && parsed.result) {
    parts.push({ type: "text", delta: parsed.result });
  } else if (typeof parsed.text === "string" && parsed.text) {
    parts.push({ type: "text", delta: parsed.text });
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
