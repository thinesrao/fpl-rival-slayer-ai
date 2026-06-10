"use client";

// Client data layer for the WC dashboard: the bootstrap query (single source
// for players/teams/rounds/rules) and the squad state hook (localStorage +
// best-effort Redis mirror).

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { loadSquad, saveSquad } from "@/lib/wc/squad/storage";
import { emptySquad, type WcSquadState } from "@/lib/wc/squad/types";
import type { WcPosition } from "@/lib/wc/fifa/types";
import type { BoosterId, WcPhase } from "@/lib/wc/rules/config";

export interface WcPickerPlayer {
  id: number;
  name: string;
  position: WcPosition;
  price: number;
  status: string;
  percentSelected: number;
  totalPoints: number;
  form: number;
  lastRoundPoints: number;
  oneToWatch: boolean;
  team: string;
  teamName: string;
  group: string;
  teamStrengthRank: number;
  nextOpponent: string | null;
  nextKickoff: string | null;
}

export interface WcBootstrap {
  players: WcPickerPlayer[];
  teams: Array<{
    id: number;
    name: string;
    abbr: string;
    group: string;
    strength: number;
    strengthRank: number;
  }>;
  rounds: Array<{
    id: number;
    status: string;
    stage: string;
    startDate: string;
    endDate: string;
    matchCount: number;
  }>;
  activeRoundId: number | null;
  targetRoundId: number;
  targetLockIso: string;
  rules: {
    phase: WcPhase;
    roundId: number;
    label: string;
    budget: number;
    maxPerNation: number;
    /** -1 = unlimited */
    freeTransfers: number;
    unlimitedTransferWindow: boolean;
    extraTransferPenalty: number;
    boostersAllowed: BoosterId[];
  };
}

export function useWcBootstrap() {
  return useQuery<WcBootstrap>({
    queryKey: ["wc-bootstrap"],
    queryFn: async () => {
      const res = await fetch("/api/wc/bootstrap");
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useWcSquad() {
  const [squad, setSquad] = useState<WcSquadState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSquad().then((s) => {
      if (!cancelled) {
        setSquad(s);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((updater: (prev: WcSquadState) => WcSquadState) => {
    setSquad((prev) => {
      const base = prev ?? emptySquad("");
      const next = { ...updater(base), updatedAt: new Date().toISOString() };
      void saveSquad(next);
      return next;
    });
  }, []);

  return { squad, loaded, update };
}
