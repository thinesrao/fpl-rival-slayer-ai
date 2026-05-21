import { redirect } from "next/navigation";
import { RivalForm } from "@/components/RivalForm";
import { readActiveTeamCookie } from "@/lib/auth/cookie";
import { Target, Newspaper, Brain } from "lucide-react";

export default async function Home() {
  // Returning user — cookie was set after a previous validated submit.
  const active = await readActiveTeamCookie();
  if (active) {
    redirect(`/dashboard/${active.teamId}/${active.leagueId}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--primary)/0.25),transparent_70%)]" />
      <div className="container mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-16">
        <div className="flex flex-col items-center gap-6 text-center">
          <span className="rounded-full border bg-card/60 px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
            For Fantasy Premier League · 2025/26
          </span>
          <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
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
            icon={<Target className="h-5 w-5 text-primary" />}
            title="Rival-targeted"
            text="Compares your squad to the 2-3 managers immediately above you in your league — not generic advice."
          />
          <Feature
            icon={<Newspaper className="h-5 w-5 text-primary" />}
            title="Live news"
            text="Gemini searches the web for the latest pressers and injury updates before every recommendation."
          />
          <Feature
            icon={<Brain className="h-5 w-5 text-primary" />}
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
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
