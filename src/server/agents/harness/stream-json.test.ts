import { describe, expect, it } from "vitest";
import { parseStreamJsonLine } from "./stream-json";

describe("parseStreamJsonLine", () => {
  it("reads Claude assistant text and session id", () => {
    const { parts, sessionId } = parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        session_id: "sess-1",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    );
    expect(sessionId).toBe("sess-1");
    expect(parts).toEqual([{ type: "text", delta: "hello" }]);
  });

  it("reads a tool_use line", () => {
    const { parts } = parseStreamJsonLine(JSON.stringify({ type: "tool_use", name: "Read" }));
    expect(parts).toEqual([{ type: "tool", delta: "", tool: "Read" }]);
  });

  it("passes through non-JSON as text", () => {
    const { parts } = parseStreamJsonLine("plain log line");
    expect(parts).toEqual([]);
  });

  it("reads Claude thinking_delta inside stream_event", () => {
    const acc = { live: false };
    const { parts } = parseStreamJsonLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "considering the ticket" },
        },
      }),
      acc,
    );
    expect(acc.live).toBe(true);
    expect(parts).toEqual([{ type: "thinking", delta: "considering the ticket" }]);
  });

  it("reads thinking blocks on assistant messages", () => {
    const { parts } = parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "done" },
          ],
        },
      }),
    );
    expect(parts).toEqual([
      { type: "thinking", delta: "hmm" },
      { type: "text", delta: "done" },
    ]);
  });

  it("does not replay assistant snapshots after live deltas", () => {
    const acc = { live: true };
    const { parts } = parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "full dump" }] },
      }),
      acc,
    );
    expect(parts).toEqual([]);
  });
});
