"use client";

import { Calendar, ClipboardList, LayoutGrid, Radio, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId =
  | "pitch"
  | "plan"
  | "matches"
  | "rivals"
  | "drafts";

interface NavItem {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY: NavItem[] = [
  { id: "pitch", label: "Pitch", icon: LayoutGrid },
  { id: "matches", label: "Matches", icon: Radio },
  { id: "rivals", label: "Rivals", icon: Swords },
  { id: "plan", label: "Plan", icon: Calendar },
  { id: "drafts", label: "Drafts", icon: ClipboardList },
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
        "fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur-md md:hidden",
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
                "relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-primary" />
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
