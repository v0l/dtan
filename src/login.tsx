import { ExternalStore } from "@snort/shared";
import { EventPublisher, Nip7Signer } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { useContext, useSyncExternalStore } from "react";

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
  const session = useSyncExternalStore(
    (c) => LoginState.hook(c),
    () => LoginState.snapshot(),
  );
  const system = useContext(SnortContext);
  return session
    ? {
        ...session,
        builder: new EventPublisher(new Nip7Signer(), session.publicKey),
        system,
      }
    : undefined;
}
