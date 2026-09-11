import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        approval: "border-transparent bg-amber-50 text-amber-800",
        failed: "border-transparent bg-red-50 text-red-700",
        paused: "border-transparent bg-zinc-100 text-zinc-600",
        rejected: "border-transparent bg-rose-50 text-rose-700",
        queued: "border-transparent bg-sky-50 text-sky-800",
        local: "border-transparent bg-emerald-50 text-emerald-800",
        success: "border-transparent bg-emerald-50 text-emerald-800",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
