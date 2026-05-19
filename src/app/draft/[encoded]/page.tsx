// Shareable draft import page. Visiting /draft/<encoded> renders an
// OG-tagged page so chat platforms unfurl the PNG card, then offers
// a one-tap "Save as a new draft" import into the recipient's local
// drafts list.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBootstrap } from "@/lib/fpl/client";
import { decodeDraft } from "@/lib/drafts/encode";
import { DraftImporter } from "@/components/DraftImporter";

interface PageProps {
  params: Promise<{ encoded: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { encoded } = await params;
  const draft = decodeDraft(encoded);
  if (!draft) {
    return { title: "Invalid draft — Rival Slayer" };
  }
  const title = `${draft.n} — FPL squad draft`;
  const description = `Imported squad draft from Rival Slayer. £${(draft.b / 10).toFixed(1)}m budget.`;
  const ogImage = `/api/og/draft?d=${encoded}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function DraftSharePage({ params }: PageProps) {
  const { encoded } = await params;
  const decoded = decodeDraft(encoded);
  if (!decoded) notFound();

  // Server-side resolve player metadata so the preview can render
  // names + photos without waiting on the /api/players fetch.
  const bs = await getBootstrap();
  const byId = new Map(bs.elements.map((e) => [e.id, e]));
  const teamShort = new Map(bs.teams.map((t) => [t.id, t.short_name]));

  const filled = decoded.p.filter((id) => id != null).length;
  const totalCost =
    decoded.p.reduce<number>(
      (s, id) => s + (id != null ? byId.get(id)?.now_cost ?? 0 : 0),
      0,
    ) / 10;

  const playerSummary = decoded.p
    .filter((id): id is number => id != null)
    .map((id) => {
      const e = byId.get(id);
      if (!e) return null;
      return {
        id,
        code: e.code,
        webName: e.web_name,
        team: teamShort.get(e.team) ?? "?",
        price: e.now_cost / 10,
        position: e.element_type,
        isCaptain: id === decoded.c,
        isVice: id === decoded.v,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <DraftImporter
          encoded={encoded}
          name={decoded.n}
          filled={filled}
          totalCost={totalCost}
          budget={decoded.b / 10}
          players={playerSummary}
        />
      </div>
    </div>
  );
}
