/** Shared stadium-pitch chrome — gradient grass + faint crowd band + pitch lines.
 *  Both SuggestedSquadPitch and MySquadLivePanel render this as their backdrop. */
export function PitchBackdrop() {
  return (
    <>
      {/* Pitch gradient — lighter at top, darker at bottom (like a stadium lit from above) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to bottom, hsl(120 55% 36%) 0%, hsl(120 52% 30%) 45%, hsl(120 50% 24%) 100%)",
        }}
      />
      {/* Subtle vertical mowing stripes */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, rgba(255,255,255,0.04) 0 6%, transparent 6% 12%)",
        }}
      />
      {/* Crowd silhouette band — top 7% of the pitch */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[7%]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(15,17,22,0.85), rgba(15,17,22,0.4) 60%, transparent 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[7%] opacity-50"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, rgba(255,255,255,0.08) 0 2px, transparent 2px 5px)",
        }}
      />
      {/* Pitch lines — centre line, centre circle, two penalty-area arcs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        <div className="absolute left-1/2 top-0 h-12 w-32 -translate-x-1/2 rounded-b-2xl border border-t-0 border-white/15" />
        <div className="absolute bottom-0 left-1/2 h-12 w-32 -translate-x-1/2 rounded-t-2xl border border-b-0 border-white/15" />
      </div>
    </>
  );
}
