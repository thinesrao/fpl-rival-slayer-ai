"use client";

import { useEffect, useState } from "react";
import CountUp from "react-countup";

interface Props {
  value: number;
  /** Decimals of precision. Default 0. */
  decimals?: number;
  /** Animation duration in seconds. Default 0.8. */
  duration?: number;
  /** Optional prefix (e.g. "+"). */
  prefix?: string;
  /** Optional suffix (e.g. " pts"). */
  suffix?: string;
  className?: string;
}

/** Tick-up wrapper around react-countup that:
 *  - remembers the previous value across renders (so subsequent updates count
 *    from the *previous* value, not from zero)
 *  - respects `prefers-reduced-motion` (instantly displays the new value)
 *  - bails out cleanly when the user navigates away (CountUp handles unmount).
 */
export function AnimatedNumber({ value, decimals = 0, duration = 0.8, prefix, suffix, className }: Props) {
  const [reduced, setReduced] = useState(false);
  const [prev, setPrev] = useState(value);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    setPrev((p) => (p === value ? p : p));
    // After the animation completes the next render uses `value` as the new `prev`.
  }, [value]);

  if (reduced) {
    return (
      <span className={className}>
        {prefix}
        {value.toFixed(decimals)}
        {suffix}
      </span>
    );
  }

  return (
    <CountUp
      start={prev}
      end={value}
      duration={duration}
      decimals={decimals}
      prefix={prefix}
      suffix={suffix}
      preserveValue
      onEnd={() => setPrev(value)}
      className={className}
    />
  );
}
