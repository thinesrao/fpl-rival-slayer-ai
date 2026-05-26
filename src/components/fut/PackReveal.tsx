"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import CountUp from "react-countup";
import { FutPack } from "./FutPack";
import { FutCard } from "./FutCard";
import { Button } from "@/components/ui/button";
import {
  managerOvr,
  managerTier,
  type Tier,
} from "@/lib/fut/tier";

export interface PackRevealManager {
  name: string;
  managerName: string;
  totalPoints: number;
  overallRank: number | null;
  leagueName: string;
  leagueRank: number | null;
  leagueSize: number;
}

interface Props {
  manager: PackRevealManager;
  onDone: () => void;
}

type Phase = "pack" | "tearing" | "card" | "ready";

export function PackReveal({ manager, onDone }: Props) {
  const prefersReducedMotion = useReducedMotion();
  const rank = manager.leagueRank ?? manager.leagueSize;
  const tier: Tier = managerTier(rank, manager.leagueSize, true);
  const ovr = managerOvr(rank, manager.leagueSize);

  const [phase, setPhase] = useState<Phase>(prefersReducedMotion ? "ready" : "pack");
  const [tear, setTear] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const t1 = setTimeout(() => setPhase("tearing"), 700);
    return () => clearTimeout(t1);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (phase !== "tearing") return;
    let raf = 0;
    const start = performance.now();
    const duration = 600;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setTear(p);
      if (p < 1) raf = requestAnimationFrame(step);
      else setPhase("card");
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    if (phase !== "card") return;
    const t = setTimeout(() => setPhase("ready"), 1100);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manager card reveal"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-zinc-950/95 p-6 backdrop-blur"
    >
      <button
        type="button"
        onClick={onDone}
        className="absolute right-4 top-4 font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        Skip
      </button>

      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {manager.leagueName}
      </p>

      <div className="relative flex h-[320px] w-full max-w-xs items-center justify-center">
        <AnimatePresence mode="wait">
          {(phase === "pack" || phase === "tearing") && (
            <motion.div
              key="pack"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{
                scale: phase === "tearing" ? 1.04 : 1,
                opacity: 1,
                rotate: phase === "tearing" ? [0, -1.5, 1.5, -1, 0] : 0,
              }}
              exit={{ scale: 1.2, opacity: 0 }}
              transition={{ duration: 0.45 }}
              className="h-full"
            >
              <FutPack tier={tier} tear={tear} className="h-full" />
            </motion.div>
          )}

          {(phase === "card" || phase === "ready") && (
            <motion.div
              key="card"
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { y: 120, rotateY: 180, opacity: 0 }
              }
              animate={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { y: 0, rotateY: 0, opacity: 1 }
              }
              transition={{
                duration: prefersReducedMotion ? 0.2 : 0.9,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ transformStyle: "preserve-3d" }}
            >
              <FutCard
                tier={tier}
                ovr={ovr}
                position="MGR"
                name={manager.managerName || manager.name}
                sub={manager.name}
                size="lg"
                stats={[
                  { label: "RNK", value: manager.leagueRank ?? "—" },
                  { label: "OF", value: manager.leagueSize },
                  { label: "PTS", value: manager.totalPoints },
                  {
                    label: "WRLD",
                    value: manager.overallRank
                      ? abbreviate(manager.overallRank)
                      : "—",
                  },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {phase === "ready" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-3"
        >
          <p className="font-display text-3xl font-extrabold tabular-nums text-fut-gold">
            <CountUp
              start={prefersReducedMotion ? ovr : 0}
              end={ovr}
              duration={prefersReducedMotion ? 0 : 0.9}
            />
            <span className="ml-2 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
              OVR
            </span>
          </p>
          <Button variant="fut" size="lg" onClick={onDone}>
            Enter the dashboard
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function abbreviate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
