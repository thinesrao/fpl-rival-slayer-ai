import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function HoloOverlay({ className }: Props) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-[inherit] bg-holo-stripes opacity-30 mix-blend-overlay",
          className,
        )}
      />
      <div aria-hidden className="holo-overlay" />
    </>
  );
}
