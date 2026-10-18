import { useSyncExternalStore } from "react";
import { getShot, subscribeShots, type Shot } from "../screenshots.ts";

/** The cached still (and last load error) for a tab; re-renders when it changes. */
export function useShot(tabId: string): Shot {
  const read = () => getShot(tabId);
  return useSyncExternalStore(subscribeShots, read, read);
}

export const LOADING_TEXT = "Loading view…";
