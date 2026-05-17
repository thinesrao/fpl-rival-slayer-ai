"use client";

import { Calendar, LayoutGrid, LayoutList, Radio, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId =
  | "squads"
  | "differentials"
  | "projections"
  | "plan"
  | "suggested"
  | "pitch"
  | "live"
  | "matches"
  | "retrospective";

interface NavItem {
  id: TabId | "__more";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY: NavItem[] = [
  { id: "pitch", label: "Pitch", icon: LayoutGrid },
  { id: "plan", label: "Plan", icon: Calendar },
  { id: "matches", label: "Matches", icon: Radio },
  { id: "squads", label: "Squads", icon: Users },
  { id: "__more", label: "More", icon: LayoutList },
];

interface Props {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
  onOpenMore: () => void;
}

export function BottomNav({ activeTab, onTabChange, onOpenMore }: Props) {
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
              onClick={() => (item.id === "__more" ? onOpenMore() : onTabChange(item.id as TabId))}
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
