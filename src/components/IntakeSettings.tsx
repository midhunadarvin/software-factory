"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntakeConfig } from "@/lib/intake/config";

export function IntakeSettings({
  origin,
  value,
  onChange,
}: {
  origin: string;
  value: IntakeConfig;
  onChange: (next: IntakeConfig) => void;
}) {
  const [copied, setCopied] = useState("");
  const base = origin.replace(/\/$/, "");
  const urls = {
    github: `${base}/api/webhooks/github`,
    linear: `${base}/api/webhooks/linear`,
    jira: `${base}/api/webhooks/jira?secret=YOUR_JIRA_WEBHOOK_SECRET`,
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Webhook intake</CardTitle>
        <CardDescription>
          Point GitHub, Linear, or Jira at these URLs. New issues become intake tickets. Turn on auto-triage
          to send them into the first agent lane without a click.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={value.autoTriage}
            onChange={(e) => onChange({ ...value, autoTriage: e.target.checked })}
          />
          Auto-move new webhook tickets to triage
        </label>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">GitHub</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={value.github.enabled}
              onChange={(e) => onChange({ ...value, github: { ...value.github, enabled: e.target.checked } })}
            />
            Accept GitHub issue webhooks for this repo
          </label>
          <div className="space-y-1.5">
            <Label>Required label (blank = every opened issue)</Label>
            <Input
              placeholder="factory"
              value={value.github.label}
              onChange={(e) => onChange({ ...value, github: { ...value.github, label: e.target.value } })}
            />
          </div>
          <UrlRow label="GitHub URL" value={urls.github} copied={copied === "github"} onCopy={() => void copy("github", urls.github)} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Linear</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={value.linear.enabled}
              onChange={(e) => onChange({ ...value, linear: { ...value.linear, enabled: e.target.checked } })}
            />
            Accept Linear issue webhooks
          </label>
          <div className="space-y-1.5">
            <Label>Team ID (required if more than one Linear-enabled project)</Label>
            <Input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={value.linear.teamId}
              onChange={(e) => onChange({ ...value, linear: { ...value.linear, teamId: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Required label (blank = every created issue)</Label>
            <Input
              value={value.linear.label}
              onChange={(e) => onChange({ ...value, linear: { ...value.linear, label: e.target.value } })}
            />
          </div>
          <UrlRow label="Linear URL" value={urls.linear} copied={copied === "linear"} onCopy={() => void copy("linear", urls.linear)} />
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Jira</h3>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={value.jira.enabled}
              onChange={(e) => onChange({ ...value, jira: { ...value.jira, enabled: e.target.checked } })}
            />
            Accept Jira issue webhooks
          </label>
          <div className="space-y-1.5">
            <Label>Project key (e.g. ENG)</Label>
            <Input
              placeholder="ENG"
              value={value.jira.projectKey}
              onChange={(e) => onChange({ ...value, jira: { ...value.jira, projectKey: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Required label (blank = every created issue)</Label>
            <Input
              value={value.jira.label}
              onChange={(e) => onChange({ ...value, jira: { ...value.jira, label: e.target.value } })}
            />
          </div>
          <UrlRow label="Jira URL" value={urls.jira} copied={copied === "jira"} onCopy={() => void copy("jira", urls.jira)} />
        </section>
      </CardContent>
    </Card>
  );
}

function UrlRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <button
        type="button"
        onClick={onCopy}
        className="block w-full truncate rounded-md border border-input bg-muted/40 px-3 py-2 text-left font-mono text-xs hover:bg-muted"
        title="Copy"
      >
        {copied ? "Copied" : value}
      </button>
    </div>
  );
}
