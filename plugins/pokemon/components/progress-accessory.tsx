import { useCallback, useState } from "react";
import { useRpc, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { pokemonRpcContract } from "../server";
import { usePokedexSignal } from "@/lib/use-pokedex-signal";

type Progress = PluginRpcResult<(typeof pokemonRpcContract)["getProgress"]>;

/** "12/1025" beside the Pokédex row in the sidebar. */
export function ProgressAccessory() {
  const rpc = useRpc<typeof pokemonRpcContract>();
  const [progress, setProgress] = useState<Progress | null>(null);
  const refetch = useCallback(() => {
    rpc.call("getProgress", null).then(setProgress, () => undefined);
  }, [rpc]);
  usePokedexSignal(refetch);

  if (progress === null) return null;
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {progress.caughtSpecies}/{progress.totalSpecies}
    </span>
  );
}
