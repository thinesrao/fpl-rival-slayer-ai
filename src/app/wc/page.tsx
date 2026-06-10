"use client";

// WC26 landing: hero with tri-host gradient, live lock countdown, and the two
// entry paths (AI draft vs manual build) — both land on the dashboard.

import Link from "next/link";
import { ArrowRight, Brain, Globe2, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WcCountdown } from "@/components/wc/WcCountdown";
import { useWcBootstrap } from "@/components/wc/useWcData";

export default function WcLandingPage() {
  const { data } = useWcBootstrap();

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <div className="relative isolate overflow-hidden bg-wc-hero">
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 24px)",
          }}
        />
        <div className="container relative mx-auto max-w-4xl px-4 py-14 text-center sm:py-20">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white/90 backdrop-blur">
            <Globe2 className="h-3 w-3" /> Canada · Mexico · USA — June 11 → July 19
          </div>
          <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight text-white sm:text-6xl">
            WC26 Fantasy <span className="text-fut-gold">AI</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/80 sm:text-base">
            Your AI manager for the official FIFA World Cup 2026™ Fantasy game. Live official data,
            web-grounded injury intel, rule-perfect squad optimization — not generic chatbot advice.
          </p>

          <div className="mt-6 flex justify-center">
            {data ? (
              <WcCountdown lockIso={data.targetLockIso} label={`${data.rules.label} locks in`} />
            ) : (
              <div className="h-16" />
            )}
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/wc/dashboard?tab=coach">
                <Brain className="mr-2 h-4 w-4" /> AI-draft my squad
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full border-white/30 bg-white/10 text-white hover:bg-white/20 sm:w-auto">
              <Link href="/wc/dashboard">
                Build manually <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="h-1.5 bg-wc-stripe" />
      </div>

      {/* Feature cards */}
      <div className="container mx-auto max-w-4xl px-4 py-10">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Sparkles,
              title: "Grounded AI drafts",
              body: "An optimizer builds rule-perfect squads from official prices & fixtures; Gemini verifies every pick against this week's squad lists and injury news via live web search.",
            },
            {
              icon: Radio,
              title: "Live matchday cockpit",
              body: "Official live points for your XV, kickoff-ordered captain-rotation plans, and in-round prompts when your captain blanks and the armband should move.",
            },
            {
              icon: ShieldCheck,
              title: "Rules-engine guard-rails",
              body: "Budget, nation caps, formations, transfer limits and booster windows enforced exactly per the official guidelines — AI suggestions that break a rule get rejected automatically.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-4">
              <f.icon className="mb-2 h-5 w-5 text-fut-gold" />
              <div className="font-display text-sm font-bold uppercase">{f.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Unofficial companion app · not affiliated with FIFA · mirror your moves on play.fifa.com/fantasy
        </p>
      </div>
    </main>
  );
}
