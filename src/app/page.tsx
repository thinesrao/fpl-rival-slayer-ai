import Link from "next/link";
import { redirect } from "next/navigation";
import { RivalForm } from "@/components/RivalForm";
import { readActiveTeamCookie } from "@/lib/auth/cookie";
import { Target, Newspaper, Brain, Globe2, ArrowRight } from "lucide-react";

export default async function Home() {
  // Returning user — cookie was set after a previous validated submit.
  const active = await readActiveTeamCookie();
  if (active) {
    redirect(`/dashboard/${active.teamId}/${active.leagueId}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--fut-gold)/0.18),transparent_70%)]" />
      <div className="container mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-16">
        <Link
          href="/wc"
          className="group mb-8 inline-flex items-center gap-2 rounded-full bg-wc-stripe p-px font-mono text-[11px] font-bold uppercase tracking-widest"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-background/90 px-4 py-1.5 transition-colors group-hover:bg-background/75">
            <Globe2 className="h-3.5 w-3.5 text-fut-gold" />
            World Cup 2026 Fantasy mode is live
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
        <div className="flex flex-col items-center gap-6 text-center">
          <span className="rounded-full border border-fut-gold/30 bg-card/60 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest text-fut-gold">
            Fantasy Premier League · 2025/26
          </span>
          <h1 className="max-w-3xl text-balance font-display text-4xl font-extrabold uppercase tracking-tight sm:text-6xl">
            Slay the rivals directly above you in your mini-league.
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            An AI coach that fetches your squad, your closest rivals, the latest injury news, and
            recommends the exact transfers, captain, and chip moves to leap them this gameweek.
          </p>
        </div>

        <div className="mt-12 w-full max-w-md">
          <RivalForm />
        </div>

        <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          <Feature
            icon={<Target className="h-5 w-5 text-fut-gold" />}
            title="Rival-targeted"
            text="Compares your squad to the 2-3 managers immediately above you in your league — not generic advice."
          />
          <Feature
            icon={<Newspaper className="h-5 w-5 text-fut-gold" />}
            title="Live news"
            text="Gemini searches the web for the latest pressers and injury updates before every recommendation."
          />
          <Feature
            icon={<Brain className="h-5 w-5 text-fut-gold" />}
            title="Overtake odds"
            text="A Monte-Carlo simulation gives you the probability you leapfrog each rival this gameweek."
          />
        </div>
      </div>
    </main>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="font-display text-sm font-bold uppercase tracking-tight">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
