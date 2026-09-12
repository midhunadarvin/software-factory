export type IncomingIssue = {
  source: string;
  externalKey: string;
  issueNumber: number | null;
  title: string;
  body: string;
  url: string;
  labels: string[];
  /** Provider-specific match keys (repo owner, team id, project key, …). */
  attrs: Record<string, string>;
  /** @deprecated convenience aliases kept for older callers/tests */
  repoOwner?: string;
  repoName?: string;
  linearTeamId?: string;
  jiraProjectKey?: string;
};

export type SettingsField = {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  kind: "text";
};

export type ProviderSettings = {
  enabled: boolean;
  [key: string]: string | boolean | undefined;
};

export type ProjectRow = {
  id: string;
  repoOwner: string | null;
  repoName: string | null;
  intake?: string | null;
};

export type WebhookContext = {
  req: Request;
  raw: Buffer;
  headers: Headers;
  url: URL;
  payload?: unknown;
};

export type VerifyResult = { ok: true } | { ok: false; status: number; error: string };

export type ParseResult =
  | { kind: "issue"; issue: IncomingIssue }
  | { kind: "ignore"; reason: string }
  | { kind: "ping" };

/**
 * An intake integration. Built-ins (GitHub, Linear, Jira) register at boot.
 * Add another by calling `registerIntegration(plugin)` from app startup.
 */
export type IntegrationPlugin = {
  id: string;
  label: string;
  description: string;
  secretEnv: string;
  defaultEnabled: boolean;
  settingsFields: SettingsField[];
  /** When no exact match, use the only project that has this plugin enabled. */
  fallbackToSingle: boolean;
  webhookUrl: (origin: string) => string;
  verify: (ctx: WebhookContext) => VerifyResult;
  parse: (ctx: WebhookContext) => ParseResult;
  match: (issue: IncomingIssue, project: ProjectRow, settings: ProviderSettings) => boolean;
};

export type PublicIntegration = {
  id: string;
  label: string;
  description: string;
  secretEnv: string;
  settingsFields: SettingsField[];
  webhookPath: string;
};
