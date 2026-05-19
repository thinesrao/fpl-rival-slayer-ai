"use client";

import { motion, type PanInfo } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

interface SlotRef {
  /** Player ID at this slot. */
  id: number;
  /** Center of the slot in viewport coords (computed at drag start). */
  cx: number;
  cy: number;
}

interface Props {
  /** Returns DOM nodes for all candidate drop targets. We snapshot
   *  positions at drag-start. */
  getAnchors: () => Array<{ id: number; el: HTMLElement }>;
  /** Tag rendered in the badge ('C' or 'V'). */
  label: string;
  /** Color theme. */
  variant: "captain" | "vice";
  /** Called when the user drops the badge within snapRadius of an anchor. */
  onAssign: (id: number) => void;
  /** Snap radius in CSS pixels. Default 96 — generous so users don't
   *  need pixel-perfect aim, especially on mobile. */
  snapRadius?: number;
}

/** Floating, draggable C / V badge. Snapshots anchor positions at
 *  drag-start, broadcasts the currently-hovered id via a custom
 *  window event, and on release calls onAssign if the pointer is
 *  within snapRadius of an anchor. */
export function MagneticCaptainBadge({ getAnchors, label, variant, onAssign, snapRadius = 96 }: Props) {
  const slotsRef = useRef<SlotRef[]>([]);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const styles = useMemo(() => {
    if (variant === "captain") {
      return {
        background: "linear-gradient(120deg,#fde68a 0%,#f59e0b 35%,#fbbf24 60%,#f59e0b 100%)",
        text: "text-amber-950",
        glow: "0 0 14px #f59e0b99",
      };
    }
    return {
      background: "linear-gradient(120deg,#f1f5f9,#cbd5e1)",
      text: "text-slate-900",
      glow: "0 0 10px #cbd5e188",
    };
  }, [variant]);

  // Broadcast hover-id so the parent can highlight the targeted tile.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ev = new CustomEvent("magnetic-hover", { detail: { id: hoverId, label } });
    window.dispatchEvent(ev);
  }, [hoverId, label]);

  const snapshot = () => {
    slotsRef.current = getAnchors().map(({ id, el }) => {
      const r = el.getBoundingClientRect();
      return { id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
  };

  const onDragStart = () => {
    setDragging(true);
    snapshot();
  };

  const findNearest = (info: PanInfo) => {
    let best: { id: number; d: number } | null = null;
    for (const s of slotsRef.current) {
      const d = Math.hypot(s.cx - info.point.x, s.cy - info.point.y);
      if (!best || d < best.d) best = { id: s.id, d };
    }
    return best;
  };

  const onDrag = (_: unknown, info: PanInfo) => {
    const best = findNearest(info);
    setHoverId(best && best.d <= snapRadius ? best.id : null);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const best = findNearest(info);
    if (best && best.d <= snapRadius) {
      onAssign(best.id);
    }
    setHoverId(null);
    setDragging(false);
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.15}
      dragSnapToOrigin
      // Wide constraints so parent overflow:hidden doesn't restrict drag.
      dragConstraints={{ left: -3000, right: 3000, top: -3000, bottom: 3000 }}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.25, cursor: "grabbing", zIndex: 100 }}
      style={{ background: styles.background, boxShadow: dragging ? `${styles.glow},0 0 0 4px ${variant === "captain" ? "#f59e0b33" : "#cbd5e133"}` : styles.glow }}
      className={`relative z-10 flex h-9 w-9 cursor-grab touch-none select-none items-center justify-center rounded-full text-sm font-bold shadow-lg ${styles.text}`}
      aria-label={`Drag ${label} badge onto a player to assign`}
    >
      {label}
    </motion.div>
  );
}
