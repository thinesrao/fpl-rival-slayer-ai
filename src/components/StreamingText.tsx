"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

/** Renders a growing string as Framer-Motion spans, one per whitespace
 *  token. As the text grows on each render, *new* tokens mount with a
 *  brief spring rise + fade-in; existing tokens never re-animate.
 *
 *  Keeps the implementation cheap: we don't track per-token history,
 *  we just use the index as the React key. Mount animations run on
 *  initial render of each span — exactly what we want for a streaming
 *  AI reply where the text only grows. */
export function StreamingText({ text }: { text: string }) {
  const tokens = useMemo(() => splitKeepWhitespace(text), [text]);
  return (
    <span>
      {tokens.map((t, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          className="inline"
        >
          {t}
        </motion.span>
      ))}
    </span>
  );
}

function splitKeepWhitespace(s: string): string[] {
  // Split into words + the whitespace between them so spacing is preserved.
  return s.match(/\S+\s*/g) ?? [];
}
