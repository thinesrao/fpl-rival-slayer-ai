import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FutCard } from "@/components/fut/FutCard";
import { FutCardCompact } from "@/components/fut/FutCardCompact";
import { OvrBadge } from "@/components/fut/OvrBadge";
import { TierChip } from "@/components/fut/TierChip";

export const dynamic = "force-dynamic";

export default function FutDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-6xl space-y-12 p-8">
      <header>
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-tight">
          FUT primitives
        </h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Visual smoke test — dev only
        </p>
      </header>

      <section>
        <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
          FutCard — large
        </h2>
        <div className="flex flex-wrap gap-6">
          <FutCard
            tier="gold"
            ovr={94}
            position="MGR"
            name="You"
            sub="Above 6 rivals"
            size="lg"
            stats={[
              { label: "RNK", value: "1.2M" },
              { label: "GW", value: 78 },
              { label: "TOT", value: 1842 },
              { label: "STK", value: 4 },
            ]}
          />
          <FutCard
            tier="silver"
            ovr={77}
            position="MID"
            name="Saka"
            sub="Arsenal"
            size="lg"
            captain
            stats={[
              { label: "xPT", value: 8.4 },
              { label: "MIN", value: 90 },
              { label: "FRM", value: 7.2 },
              { label: "FDR", value: 2 },
            ]}
          />
          <FutCard
            tier="bronze"
            ovr={58}
            position="DEF"
            name="Trippier"
            sub="Newcastle"
            size="lg"
            vice
            stats={[
              { label: "xPT", value: 4.1 },
              { label: "MIN", value: 75 },
              { label: "FRM", value: 4.0 },
              { label: "FDR", value: 4 },
            ]}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
          FutCard — md (pitch tile)
        </h2>
        <div className="flex flex-wrap gap-4">
          {(["gold", "silver", "bronze"] as const).map((tier, i) => (
            <FutCard
              key={tier}
              tier={tier}
              ovr={90 - i * 15}
              position={["FWD", "MID", "DEF"][i]!}
              name={["Haaland", "Palmer", "Gabriel"][i]!}
              sub={["Man City", "Chelsea", "Arsenal"][i]}
              captain={i === 0}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
          FutCardCompact
        </h2>
        <div className="max-w-md space-y-2">
          {[
            { tier: "gold", ovr: 91, name: "Marcus", sub: "Top Boys FC", pts: 78 },
            { tier: "silver", ovr: 74, name: "Sarah K", sub: "Wolves Forever", pts: 64 },
            { tier: "silver", ovr: 68, name: "Dev Patel", sub: "Salah Hour", pts: 52 },
            { tier: "bronze", ovr: 55, name: "Will B", sub: "11 Donkeys", pts: 41 },
          ].map((r) => (
            <FutCardCompact
              key={r.name}
              tier={r.tier as never}
              ovr={r.ovr}
              position="MGR"
              name={r.name}
              sub={r.sub}
              trailing={
                <div className="text-right">
                  <div className="font-display text-lg font-extrabold tabular-nums leading-none">
                    {r.pts}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    GW pts
                  </div>
                </div>
              }
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
          OvrBadge + TierChip
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <OvrBadge tier="gold" ovr={94} />
          <OvrBadge tier="silver" ovr={77} />
          <OvrBadge tier="bronze" ovr={58} />
          <OvrBadge tier="gold" ovr={94} size="sm" />
          <TierChip tier="gold">FWD</TierChip>
          <TierChip tier="silver">MID</TierChip>
          <TierChip tier="bronze">DEF</TierChip>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-lg font-bold uppercase tracking-wide text-muted-foreground">
          FutButton
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="fut" size="lg">Slay my rivals</Button>
          <Button variant="fut">Apply transfers</Button>
          <Button variant="fut" size="sm">Confirm captain</Button>
          <Button variant="fut-outline">Cancel</Button>
        </div>
      </section>
    </main>
  );
}
