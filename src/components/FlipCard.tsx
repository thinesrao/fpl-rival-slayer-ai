"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  front: React.ReactNode;
  back: React.ReactNode;
  /** Optional fixed-height. Default lets content size the card. */
  className?: string;
}

/** Tap-to-flip card. Front + back content are rendered together; we use
 *  preserve-3d + backface-hidden to hide whichever side is facing away.
 *  The card is button-semantically so keyboards work too. */
export function FlipCard({ front, back, className }: Props) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={cn("relative w-full", className)} style={{ perspective: 900 }}>
      <motion.button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        style={{ transformStyle: "preserve-3d" }}
        className="relative w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div style={{ backfaceVisibility: "hidden" }}>{front}</div>
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          {back}
        </div>
      </motion.button>
    </div>
  );
}
