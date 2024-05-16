import { ExternalStore, appendDedupe, sanitizeRelayUrl } from "@snort/shared";
import { useSyncExternalStore } from "react";

const storageKey = "relays";
class RelaysStore extends ExternalStore<Array<string>> {
  #relays: Array<string> = [];

  constructor() {
    super();
    const loaded = localStorage.getItem(storageKey);
    if (loaded) {
      this.#relays = JSON.parse(loaded);
    } else {
      this.#relays = ["wss://nos.lol/", "wss://relay.damus.io/", "wss://relay.nostr.band/"];
      this.#save();
    }
  }

  add(u: string) {
    const url = sanitizeRelayUrl(u);
    if (url) {
      this.#relays = appendDedupe(this.#relays, [url]);
      this.#save();
    }
  }

  remove(u: string) {
    const url = sanitizeRelayUrl(u);
    if (url) {
      this.#relays = this.#relays.filter((a) => a !== url);
      this.#save();
    }
  }

  #save() {
    localStorage.setItem(storageKey, JSON.stringify(this.#relays));
    this.notifyChange();
  }

  takeSnapshot(): string[] {
    return [...this.#relays];
  }
}

const relayStore = new RelaysStore();

export function useRelays() {
  const relays = useSyncExternalStore(
    (s) => relayStore.hook(s),
    () => relayStore.snapshot(),
  );

  return {
    relays,
    add: (a: string) => relayStore.add(a),
    remove: (a: string) => relayStore.remove(a),
  };
}
