"use client";

import { useEffect } from "react";
import { BarChart3, GitCompare, History, Lightbulb, Radio, X } from "lucide-react";
import type { TabId } from "./BottomNav";
import { cn } from "@/lib/utils";

interface MoreItem {
  id: TabId;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MORE_ITEMS: MoreItem[] = [
  { id: "suggested", label: "Suggested", subtitle: "AI's recommended squad + transfers", icon: Lightbulb },
  { id: "differentials", label: "Differentials", subtitle: "Top-10 league ownership heatmap", icon: GitCompare },
  { id: "projections", label: "Projections", subtitle: "xP chart + overtake meter", icon: BarChart3 },
  { id: "live", label: "Live", subtitle: "Running scoreboard vs rivals", icon: Radio },
  { id: "retrospective", label: "Retrospective", subtitle: "Last GW review + luck audit", icon: History },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (id: TabId) => void;
}

export function MoreSheet({ open, onClose, onPick }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-background/80 backdrop-blur-sm md:hidden"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl border-t bg-card shadow-2xl",
          "animate-in slide-in-from-bottom duration-200",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">More</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="divide-y">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(item.id);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
