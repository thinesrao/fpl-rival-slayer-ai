"use client";

// WC26 dashboard: tabbed cockpit (squad / coach / live / fixtures / chat).
// Tab state lives in the URL (?tab=) so links can deep-link a tab; mobile
// gets the bottom nav, desktop the top tab bar.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WcBottomNav, WcTopTabs, type WcTabId } from "@/components/wc/WcBottomNav";
import { WcCountdown } from "@/components/wc/WcCountdown";
import { WcSquadBuilder } from "@/components/wc/WcSquadBuilder";
import { WcAiDraftPanel } from "@/components/wc/WcAiDraftPanel";
import { WcCoachPanel } from "@/components/wc/WcCoachPanel";
import { WcLivePanel } from "@/components/wc/WcLivePanel";
import { WcFixturesPanel } from "@/components/wc/WcFixturesPanel";
import { WcChatPanel } from "@/components/wc/WcChatPanel";
import { useWcBootstrap, useWcSquad } from "@/components/wc/useWcData";

const VALID_TABS: WcTabId[] = ["squad", "coach", "live", "fixtures", "chat"];

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get("tab") as WcTabId | null;
  const [tab, setTab] = useState<WcTabId>(urlTab && VALID_TABS.includes(urlTab) ? urlTab : "squad");

  useEffect(() => {
    if (urlTab && VALID_TABS.includes(urlTab)) setTab(urlTab);
  }, [urlTab]);

  const changeTab = useCallback(
    (next: WcTabId) => {
      setTab(next);
      router.replace(`/wc/dashboard?tab=${next}`, { scroll: false });
    },
    [router],
  );

  const { data, isLoading, error } = useWcBootstrap();
  const { squad, loaded, update } = useWcSquad();

  const hasSquad = (squad?.picks.length ?? 0) === 15;

  return (
    <main className="min-h-screen pb-20 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-md">
        <div className="h-1 bg-wc-stripe" />
        <div className="container mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/wc" className="text-muted-foreground hover:text-foreground" aria-label="Back to landing">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="font-display text-sm font-extrabold uppercase tracking-tight">
            WC26 <span className="text-fut-gold">Fantasy AI</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {data && (
              <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
                {data.rules.label}
              </span>
            )}
            <WcTopTabs activeTab={tab} onTabChange={changeTab} />
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-5xl px-4 py-4">
        {/* Lock banner */}
        {data && tab !== "live" && (
          <div className="mb-4 flex items-center justify-between rounded-xl border bg-card px-4 py-2.5">
            <WcCountdown lockIso={data.targetLockIso} label={`${data.rules.label} locks in`} />
            <div className="text-right font-mono text-[10px] uppercase leading-relaxed tracking-wider text-muted-foreground">
              <div>${data.rules.budget}m budget · max {data.rules.maxPerNation}/nation</div>
              <div>
                {data.rules.freeTransfers === -1 ? "Unlimited transfers" : `${data.rules.freeTransfers} free transfers`}
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            Couldn&apos;t reach the official FIFA Fantasy feed: {error.message}
          </div>
        )}

        {data && loaded && squad && (
          <>
            {tab === "squad" &&
              (hasSquad ? (
                <WcSquadBuilder data={data} squad={squad} update={update} />
              ) : (
                <div className="space-y-4">
                  <WcAiDraftPanel data={data} update={update} />
                  <details className="rounded-xl border bg-card p-4">
                    <summary className="cursor-pointer text-sm font-semibold">
                      …or build your 15 manually
                    </summary>
                    <div className="mt-3">
                      <WcSquadBuilder data={data} squad={squad} update={update} />
                    </div>
                  </details>
                </div>
              ))}
            {tab === "coach" &&
              (hasSquad ? (
                <WcCoachPanel data={data} squad={squad} update={update} />
              ) : (
                <WcAiDraftPanel data={data} update={update} onAdopted={() => changeTab("squad")} />
              ))}
            {tab === "live" && <WcLivePanel data={data} squad={squad} />}
            {tab === "fixtures" && <WcFixturesPanel />}
            {tab === "chat" && <WcChatPanel squad={squad} />}
          </>
        )}
      </div>

      <WcBottomNav activeTab={tab} onTabChange={changeTab} />
    </main>
  );
}

export default function WcDashboardPage() {
  return (
    <Suspense fallback={<div className="p-8"><Skeleton className="h-96 w-full" /></div>}>
      <DashboardInner />
    </Suspense>
  );
}
