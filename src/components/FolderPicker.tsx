"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FolderPicker({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState("");
  const list = trpc.projects.listFolders.useQuery(
    { dir: browse || undefined },
    { enabled: open },
  );
  const data = list.data;

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1 font-mono"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          variant="outline"
          type="button"
          className="shrink-0"
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            setBrowse(value);
            setOpen(true);
          }}
        >
          <FolderOpen />
          Select folder
        </Button>
      </div>
      {open && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{data?.dir ?? "…"}</p>
            {data?.git && <Badge variant="local">git</Badge>}
          </div>
          {list.isError && <p className="mt-2 text-sm text-destructive">{list.error.message}</p>}
          {data?.error && <p className="mt-2 text-sm text-destructive">{data.error}</p>}
          <ul className="mt-2 max-h-56 overflow-auto text-sm">
            {data?.parent && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted"
                  onClick={() => setBrowse(data.parent!)}
                >
                  ..
                </button>
              </li>
            )}
            {(data?.entries ?? []).map((entry) => (
              <li key={entry.path} className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => setBrowse(entry.path)}
                >
                  <span className="truncate">{entry.name}</span>
                  {entry.git && (
                    <Badge variant="local" className="shrink-0">
                      git
                    </Badge>
                  )}
                </button>
                <Button variant="ghost" size="sm" type="button" onClick={() => choose(entry.path)}>
                  Choose
                </Button>
              </li>
            ))}
            {data && data.entries.length === 0 && !data.error && (
              <li className="px-2 py-1.5 text-muted-foreground">No subfolders</li>
            )}
          </ul>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" type="button" disabled={!data?.dir} onClick={() => data?.dir && choose(data.dir)}>
              Use this folder
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
