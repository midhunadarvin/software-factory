"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pluginSettings, type IntakeConfig } from "@/lib/intake/settings";
import type { PublicIntegration } from "@/lib/integrations/types";

export function IntakeSettings({
  origin,
  value,
  integrations,
  onChange,
}: {
  origin: string;
  value: IntakeConfig;
  integrations: PublicIntegration[];
  onChange: (next: IntakeConfig) => void;
}) {
  const [copied, setCopied] = useState("");
  const base = origin.replace(/\/$/, "");

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* ignore */
    }
  };

  const webhookUrl = (plugin: PublicIntegration) => {
    const path = `${base}/api/webhooks/${plugin.id}`;
    if (plugin.id === "jira") return `${path}?secret=YOUR_${plugin.secretEnv}`;
    return path;
  };

  const patchProvider = (id: string, patch: Record<string, string | boolean>) => {
    onChange({
      ...value,
      [id]: { ...pluginSettings(value, id), ...patch },
    });
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Webhook intake</CardTitle>
        <CardDescription>
          Integrations are plugins (GitHub, Linear, and Jira ship built-in). Point a provider at the URL
          below. New issues become intake tickets. Turn on auto-triage to send them into the first agent
          lane without a click.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={Boolean(value.autoTriage)}
            onChange={(e) => onChange({ ...value, autoTriage: e.target.checked })}
          />
          Auto-move new webhook tickets to triage
        </label>

        {integrations.map((plugin) => {
          const settings = pluginSettings(value, plugin.id);
          return (
            <section key={plugin.id} className="space-y-2">
              <h3 className="text-sm font-medium">{plugin.label}</h3>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={Boolean(settings.enabled)}
                  onChange={(e) => patchProvider(plugin.id, { enabled: e.target.checked })}
                />
                {plugin.description}
              </label>
              {plugin.settingsFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label>{field.label}</Label>
                  <Input
                    placeholder={field.placeholder}
                    value={String(settings[field.key] ?? "")}
                    onChange={(e) => patchProvider(plugin.id, { [field.key]: e.target.value })}
                  />
                </div>
              ))}
              <UrlRow
                label={`${plugin.label} URL`}
                value={webhookUrl(plugin)}
                copied={copied === plugin.id}
                onCopy={() => void copy(plugin.id, webhookUrl(plugin))}
              />
            </section>
          );
        })}
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
