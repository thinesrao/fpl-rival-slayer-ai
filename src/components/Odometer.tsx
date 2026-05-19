"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  /** Minimum number of digits — pads with leading zeros. */
  minDigits?: number;
  /** Tile height in px (also sets each digit's font size). */
  height?: number;
  className?: string;
}

/** Slot-machine style number display. Each digit is an independent
 *  vertical strip (0..9); changing the value springs the strip to
 *  reveal the new digit, with a small per-digit stagger so the read
 *  feels mechanical and weighty. Honors prefers-reduced-motion via
 *  a tiny `transition` override. */
export function Odometer({ value, minDigits = 1, height = 28, className }: Props) {
  // Negative numbers get a static minus sign in front.
  const isNeg = value < 0;
  const absStr = String(Math.abs(Math.trunc(value)));
  const padded = absStr.padStart(minDigits, "0");
  const digits = useMemo(() => padded.split("").map((d) => Number(d)), [padded]);

  return (
    <span
      className={cn("inline-flex items-end gap-[1px] font-mono font-bold leading-none", className)}
      style={{ fontSize: height * 0.85 }}
      aria-label={String(value)}
    >
      {isNeg && <span>−</span>}
      {digits.map((d, i) => (
        <span
          key={i}
          className="relative inline-block overflow-hidden"
          style={{ height, width: height * 0.6 }}
        >
          <motion.span
            animate={{ y: -d * height }}
            transition={{ type: "spring", stiffness: 150, damping: 22, delay: i * 0.03 }}
            className="absolute inset-x-0 top-0 flex flex-col"
          >
            {Array.from({ length: 10 }, (_, n) => (
              <span
                key={n}
                className="flex items-center justify-center"
                style={{ height }}
              >
                {n}
              </span>
            ))}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
