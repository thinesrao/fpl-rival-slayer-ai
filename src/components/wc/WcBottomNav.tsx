"use client";

import { Brain, CalendarDays, MessageSquareText, Radio, Shirt } from "lucide-react";
import { cn } from "@/lib/utils";

export type WcTabId = "squad" | "coach" | "live" | "fixtures" | "chat";

const TABS: Array<{ id: WcTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "squad", label: "Squad", icon: Shirt },
  { id: "coach", label: "Coach", icon: Brain },
  { id: "live", label: "Live", icon: Radio },
  { id: "fixtures", label: "Matches", icon: CalendarDays },
  { id: "chat", label: "Chat", icon: MessageSquareText },
];

export function WcBottomNav({
  activeTab,
  onTabChange,
}: {
  activeTab: WcTabId;
  onTabChange: (id: WcTabId) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-fut-gold/15 bg-background/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {TABS.map((item) => {
          const isActive = item.id === activeTab;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                isActive ? "text-fut-gold" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-wc-stripe" />
              )}
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Desktop top tab bar — same tabs, horizontal. */
export function WcTopTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: WcTabId;
  onTabChange: (id: WcTabId) => void;
}) {
  return (
    <div className="hidden gap-1 md:flex">
      {TABS.map((item) => {
        const isActive = item.id === activeTab;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider transition-colors",
              isActive
                ? "border-fut-gold/60 bg-fut-gold/15 text-fut-gold"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
