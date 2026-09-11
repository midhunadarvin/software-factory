"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Factory } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/open" className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Factory className="size-3.5" />
      </span>
      Software Factory
    </Link>
  );
}

export function AppHeader({
  left,
  right,
}: {
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {left}
        </div>
        <div className="flex items-center gap-1">{right}</div>
      </div>
    </header>
  );
}
