import { ExternalStore } from "@snort/shared";
import { useSyncExternalStore } from "react";

export interface WoTFilterState {
  enabled: boolean;
  maxDistance: number; // Maximum follow distance to consider "trusted"
}

class WoTFilterStore extends ExternalStore<WoTFilterState> {
  #state: WoTFilterState;

  constructor() {
    super();
    const saved = window.localStorage.getItem("wot-filter");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.#state = {
          enabled: parsed.enabled ?? false,
          maxDistance: parsed.maxDistance ?? 2, // Default to friends of friends
        };
      } catch {
        this.#state = {
          enabled: false,
          maxDistance: 2,
        };
      }
    } else {
      this.#state = {
        enabled: false,
        maxDistance: 2,
      };
    }
  }

  takeSnapshot() {
    return { ...this.#state };
  }

  setEnabled(enabled: boolean) {
    this.#state.enabled = enabled;
    this.#save();
  }

  setMaxDistance(maxDistance: number) {
    this.#state.maxDistance = maxDistance;
    this.#save();
  }

  #save() {
    window.localStorage.setItem("wot-filter", JSON.stringify(this.#state));
    this.notifyChange();
  }
}

export const WoTFilterState = new WoTFilterStore();

export function useWoTFilter() {
  return useSyncExternalStore(
    (c) => WoTFilterState.hook(c),
    () => WoTFilterState.snapshot(),
  );
}