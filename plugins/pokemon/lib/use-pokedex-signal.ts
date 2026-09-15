import { useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { CATCH_CHANNEL } from "./catch-event";

/** Runs `refetch` on mount, after every catch, and after a reconnect. */
export function usePokedexSignal(refetch: () => void): void {
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(CATCH_CHANNEL, refetch);
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    // Signals are not replayed, so catches made while disconnected need a refetch.
    if (previousConnection.current === "reconnecting" && connection === "connected") {
      refetch();
    }
    previousConnection.current = connection;
  }, [connection, refetch]);
}
