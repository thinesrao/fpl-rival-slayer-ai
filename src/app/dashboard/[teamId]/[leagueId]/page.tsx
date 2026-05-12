import { Dashboard } from "@/components/Dashboard";
import { aiEnabled } from "@/lib/env";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ teamId: string; leagueId: string }>;
}

export default async function DashboardPage({ params }: PageProps) {
  const { teamId, leagueId } = await params;
  const t = Number(teamId);
  const l = Number(leagueId);
  if (!Number.isInteger(t) || t <= 0 || !Number.isInteger(l) || l <= 0) notFound();
  return <Dashboard teamId={t} leagueId={l} aiEnabled={aiEnabled} />;
}
