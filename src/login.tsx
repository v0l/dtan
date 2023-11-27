import { ExternalStore } from "@snort/shared";
import { useSyncExternalStore } from "react";

export interface LoginSession {
  publicKey: string;
}
class LoginStore extends ExternalStore<LoginSession | undefined> {
  #session?: LoginSession;

  constructor() {
    super();
    const s = window.localStorage.getItem("session");
    if (s) {
      this.#session = JSON.parse(s);
    }
  }

  takeSnapshot() {
    return this.#session ? { ...this.#session } : undefined;
  }

  login(pubkey: string) {
    this.#session = {
      publicKey: pubkey,
    };
    this.#save();
  }

  #save() {
    window.localStorage.setItem("session", JSON.stringify(this.#session));
    this.notifyChange();
  }
}

export const LoginState = new LoginStore();

export function useLogin() {
  return useSyncExternalStore(
    (c) => LoginState.hook(c),
    () => LoginState.snapshot(),
  );
}
