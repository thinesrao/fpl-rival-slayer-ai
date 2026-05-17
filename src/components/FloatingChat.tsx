"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Sparkles, X } from "lucide-react";
import { ChatPanel } from "@/components/ChatPanel";
import { cn } from "@/lib/utils";

interface Props {
  teamId: number;
  leagueId: number;
  hidden?: boolean;
}

const HINT_KEY = "fpl-rival-slayer:chat-hint-dismissed";

export function FloatingChat({ teamId, leagueId, hidden = false }: Props) {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = window.localStorage.getItem(HINT_KEY);
    if (!dismissed && !hidden) {
      setShowHint(true);
      const t = setTimeout(() => {
        setShowHint(false);
        window.localStorage.setItem(HINT_KEY, "1");
      }, 6000);
      return () => clearTimeout(t);
    }
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const dismissHint = () => {
    setShowHint(false);
    if (typeof window !== "undefined") window.localStorage.setItem(HINT_KEY, "1");
  };

  if (hidden) return null;

  return (
    <>
      {/* Hint pill — auto-dismisses after 6s */}
      {showHint && !open && (
        <div
          className={cn(
            "fixed right-4 z-30 max-w-[18rem] rounded-2xl bg-card px-3 py-2 text-sm shadow-lg ring-1 ring-border",
            "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] md:bottom-24",
            "flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300",
          )}
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="flex-1 text-xs leading-tight">
            Ask the co-pilot anything about your team, captain, or transfers.
          </p>
          <button
            type="button"
            onClick={dismissHint}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss hint"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <span
            className="absolute -bottom-1 right-6 h-3 w-3 rotate-45 rounded-sm bg-card ring-1 ring-border"
            style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
            aria-hidden
          />
        </div>
      )}

      {/* FAB */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          dismissHint();
        }}
        aria-label="Open co-pilot chat"
        className={cn(
          "fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl",
          "bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:bottom-6 md:right-6",
          "transition-transform hover:scale-105 active:scale-95",
          "ring-4 ring-primary/20",
        )}
      >
        <MessageSquare className="h-6 w-6" />
        <span className="sr-only">Co-pilot chat</span>
      </button>

      {/* Sheet (mobile) / drawer (desktop) */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-end bg-background/80 backdrop-blur-sm md:items-stretch"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex w-full flex-col overflow-hidden bg-card shadow-2xl",
              "h-[85vh] rounded-t-2xl",
              "animate-in slide-in-from-bottom duration-200",
              "md:h-screen md:max-w-md md:rounded-l-2xl md:rounded-tr-none",
              "md:animate-in md:slide-in-from-right md:duration-200",
            )}
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">Co-pilot chat</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <ChatPanel teamId={teamId} leagueId={leagueId} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
