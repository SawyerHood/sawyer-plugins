import { useState } from "react";
import { TYPE_COLORS, titleCaseSlug } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TypeBadges({ types, className }: { types: readonly string[]; className?: string }) {
  if (types.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {types.map((type) => {
        const color = TYPE_COLORS[type] ?? TYPE_COLORS.normal!;
        return (
          <span
            key={type}
            className="inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium text-foreground"
            style={{ backgroundColor: `${color}29`, borderColor: `${color}66` }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
            {titleCaseSlug(type)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * A lazily loaded sprite. Uncaught Pokémon render as a silhouette, and a
 * sprite that fails to load falls back to an empty Poké Ball outline.
 */
export function PokemonSprite({
  src,
  caught,
  pixelated = true,
  className,
}: {
  src: string | null;
  caught: boolean;
  pixelated?: boolean;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src === null || failedSrc === src) {
    return <span aria-hidden className={cn("pokemon-sprite-missing", className)} />;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
      className={cn(
        "select-none object-contain",
        pixelated && "pokemon-pixelated",
        !caught && "pokemon-silhouette",
        className,
      )}
    />
  );
}
