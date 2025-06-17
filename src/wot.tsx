import { ExternalStore } from "@snort/shared";
import { useSyncExternalStore } from "react";

export interface WoTState {
  trustedPubkeys: Set<string>;
  enabled: boolean;
}

class WoTStore extends ExternalStore<WoTState> {
  #state: WoTState;

  constructor() {
    super();
    const saved = window.localStorage.getItem("wot");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.#state = {
          trustedPubkeys: new Set(parsed.trustedPubkeys || []),
          enabled: parsed.enabled ?? false,
        };
      } catch {
        this.#state = {
          trustedPubkeys: new Set(),
          enabled: false,
        };
      }
    } else {
      this.#state = {
        trustedPubkeys: new Set(),
        enabled: false,
      };
    }
  }

  takeSnapshot() {
    return {
      trustedPubkeys: new Set(this.#state.trustedPubkeys),
      enabled: this.#state.enabled,
    };
  }

  setEnabled(enabled: boolean) {
    this.#state.enabled = enabled;
    this.#save();
  }

  addTrustedPubkey(pubkey: string) {
    this.#state.trustedPubkeys.add(pubkey);
    this.#save();
  }

  removeTrustedPubkey(pubkey: string) {
    this.#state.trustedPubkeys.delete(pubkey);
    this.#save();
  }

  isTrusted(pubkey: string) {
    return this.#state.trustedPubkeys.has(pubkey);
  }

  #save() {
    const toSave = {
      trustedPubkeys: Array.from(this.#state.trustedPubkeys),
      enabled: this.#state.enabled,
    };
    window.localStorage.setItem("wot", JSON.stringify(toSave));
    this.notifyChange();
  }
}

export const WoTState = new WoTStore();

export function useWoT() {
  return useSyncExternalStore(
    (c) => WoTState.hook(c),
    () => WoTState.snapshot(),
  );
}