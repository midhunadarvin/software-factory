/** Strip endpoint suffixes so the SDK can append /models, /chat/completions, /responses, or /messages. */
export function normalizeLlmBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/(chat\/completions|responses|models|messages)$/i, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed
      .replace(/\/+$/, "")
      .replace(/\/(chat\/completions|responses|models|messages)$/i, "");
  }
}
