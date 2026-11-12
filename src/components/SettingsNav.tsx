"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "project", href: "/settings", label: "Project" },
  { id: "lanes", href: "/settings/lanes", label: "Lanes and actions" },
] as const;

export function SettingsNav({
  projectId,
  current,
}: {
  projectId: string;
  current: (typeof TABS)[number]["id"];
}) {
  return (
    <div className="mt-6 flex gap-1 rounded-lg bg-muted p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={`${tab.href}?project=${projectId}`}
          className={cn(
            "flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            current === tab.id ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
