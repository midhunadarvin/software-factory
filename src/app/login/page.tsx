"use client";

import { useState } from "react";
import { Factory, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(0.91_0.008_90)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.91_0.008_90)_1px,transparent_1px)] bg-size-[48px_48px] mask-[radial-gradient(ellipse_60%_50%_at_50%_40%,black,transparent)] opacity-60" />
      <Card className="relative w-full max-w-md shadow-sm">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Factory className="size-5" />
          </span>
          <CardTitle className="text-xl">Software Factory</CardTitle>
          <CardDescription>
            Local multi-agent factory. Sign in with the app password from your environment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setPending(true);
                const res = await fetch("/api/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ password }),
                });
                setPending(false);
                if (!res.ok) {
                  setError(((await res.json()) as { error?: string }).error ?? "login failed");
                  return;
                }
                window.location.href = "/open";
              })();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="password">App password</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="FACTORY_APP_PASSWORD"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              Continue
              <ArrowRight />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
