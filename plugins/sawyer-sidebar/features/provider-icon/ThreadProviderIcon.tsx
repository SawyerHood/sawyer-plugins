import { useMemo } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
} from "@get-bb/plugin-sdk/app";

/**
 * The agent provider's icon (Claude Code, Codex, ...) drawn at the left of a
 * thread row. It is decorative and click-through like the title, so the row
 * link underneath still takes every click. Unknown or still-loading providers
 * draw the host's generic glyph, so the row keeps its layout.
 */
export function ThreadProviderIcon({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  const provider = useMemo(
    () => providers.find((candidate) => candidate.id === providerId),
    [providers, providerId],
  );
  return (
    <span
      data-sidebar-thread-provider-icon={providerId}
      className="pointer-events-none relative flex size-4 shrink-0 items-center justify-center text-muted-foreground"
    >
      <ProviderIcon
        providerKind="agent"
        provider={provider ?? { id: providerId }}
        fallback="Bot"
        className="size-3.5"
        aria-hidden
      />
    </span>
  );
}
