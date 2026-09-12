"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { DraftSeed } from "@/lib/drafts/seed";

interface Props {
  open: boolean;
  teamId: number;
  onClose: () => void;
  onImported: (seed: DraftSeed) => void;
}

const COOKIE_URL = "https://fantasy.premierleague.com/my-team";

/**
 * Pull the squad the manager has already saved for the upcoming deadline —
 * a wildcard team, most usefully — into the drafts list.
 *
 * FPL's public API refuses to serve a gameweek's picks until its deadline has
 * passed, so this is the one flow in the app that needs the manager's own
 * login. The cookie lives in this component's state for the length of one
 * request and is never written to localStorage.
 */
export function FplSquadImport({ open, teamId, onClose, onImported }: Props) {
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);

  const close = () => {
    setCookie("");
    setLoading(false);
    onClose();
  };

  const submit = async () => {
    if (!cookie.trim()) {
      toast.error("Paste your FPL cookie first.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/my-team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, cookie: cookie.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.message ?? `Import failed (${res.status})`);
        return;
      }
      setCookie("");
      onImported(body as DraftSeed);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
              <div>
                <div className="flex items-center gap-2 font-display text-base font-semibold uppercase tracking-tight">
                  <KeyRound className="h-4 w-4 text-fut-gold" /> Import my saved FPL squad
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Pulls the team you&apos;ve already saved for the next deadline — wildcard
                  included — so you can rate it here before it locks.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={close} aria-label="Close" className="h-8 shrink-0 px-2">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 p-4 text-[12px] leading-relaxed">
              <p className="text-muted-foreground">
                FPL&apos;s public API won&apos;t show a gameweek&apos;s team until that
                gameweek&apos;s deadline has passed, so importing an unlocked squad needs your own
                FPL session. Here&apos;s how to grab it:
              </p>
              <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
                <li>
                  Sign in at{" "}
                  <a href={COOKIE_URL} target="_blank" rel="noreferrer" className="underline">
                    fantasy.premierleague.com
                  </a>{" "}
                  in a desktop browser.
                </li>
                <li>
                  Open DevTools (<kbd className="rounded border px-1">F12</kbd>) →{" "}
                  <strong>Application</strong> → <strong>Cookies</strong> →{" "}
                  <code>https://fantasy.premierleague.com</code>.
                </li>
                <li>
                  Copy the <code>pl_profile</code> value (and <code>sessionid</code> if it&apos;s
                  there) and paste below. Pasting the whole cookie header works too.
                </li>
              </ol>

              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px]">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p>
                  That cookie is a login for your FPL account. It&apos;s sent to this app&apos;s
                  server for one request to FPL, is never stored or logged, and never leaves this
                  page otherwise. Sign out of FPL to invalidate it. If you&apos;d rather not, close
                  this and build the squad by hand with <strong>New draft</strong> instead.
                </p>
              </div>

              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder="pl_profile=…; sessionid=…"
                className="w-full resize-y rounded-md border bg-background p-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={close}>
                  Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={loading}>
                  {loading && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  {loading ? "Fetching…" : "Import squad"}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
