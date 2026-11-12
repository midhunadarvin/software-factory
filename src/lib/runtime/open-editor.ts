import { spawn } from "node:child_process";
import { whichBinary } from "./harness/which";

export type EditorId = "cursor" | "vscode";

const CLIS: Record<EditorId, string[]> = {
  cursor: ["cursor"],
  vscode: ["code", "code-insiders"],
};

const MAC_APPS: Record<EditorId, string> = {
  cursor: "Cursor",
  vscode: "Visual Studio Code",
};

export async function openWorktreeInEditor(worktreePath: string, editor: EditorId): Promise<{ ok: true; via: string }> {
  for (const name of CLIS[editor]) {
    const binary = await whichBinary(name);
    if (!binary) continue;
    spawn(binary, [worktreePath], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, via: name };
  }
  if (process.platform === "darwin") {
    spawn("open", ["-a", MAC_APPS[editor], worktreePath], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, via: `open -a ${MAC_APPS[editor]}` };
  }
  throw new Error(
    editor === "cursor"
      ? "Cursor CLI is not on PATH. Install the `cursor` shell command from Cursor."
      : "VS Code CLI is not on PATH. Install the `code` shell command from VS Code.",
  );
}
