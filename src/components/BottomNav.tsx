"use client";

import { BookMarked, LayoutGrid, MessageSquareText, Radio, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId =
  | "squad"
  | "vs"
  | "coach"
  | "matches"
  | "collection";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY: NavItem[] = [
  { id: "squad", label: "Squad", icon: LayoutGrid },
  { id: "vs", label: "Rival", icon: Swords },
  { id: "coach", label: "AI", icon: MessageSquareText },
  { id: "matches", label: "Matches", icon: Radio },
  { id: "collection", label: "Draft", icon: BookMarked },
];

interface Props {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}

export function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t border-fut-gold/15 bg-background/95 backdrop-blur-md md:hidden",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {PRIMARY.map((item) => {
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
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-tier-gold shadow-fut-gold" />
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
