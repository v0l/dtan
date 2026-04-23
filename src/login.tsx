import { ExternalStore } from "@snort/shared";
import { EventPublisher, Nip46Signer, Nip7Signer, PrivateKeySigner } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { useContext, useEffect, useSyncExternalStore } from "react";

export interface LoginSession {
  type: "nip7" | "nsec" | "nip46";
  publicKey: string;
  privateKey?: string;
  bunker?: string;
}
class LoginStore extends ExternalStore<LoginSession | undefined> {
  #session?: LoginSession;
  #signer?: EventPublisher;

  constructor() {
    super();
    if (typeof window !== "undefined") {
      const s = window.localStorage.getItem("session");
      if (s) {
        this.#session = JSON.parse(s);
        // patch session
        if (this.#session) {
          this.#session.type ??= "nip7";
        }
        if (this.#session !== undefined && this.#session.publicKey === undefined) {
          console.warn("Invalid login session, missing pubkey");
          this.#session = undefined;
        }
      }
    }
  }

  takeSnapshot() {
    return this.#session ? { ...this.#session } : undefined;
  }

  logout() {
    this.#session = undefined;
    this.#signer = undefined;
    this.#save();
  }

  login(pubkey: string, type: LoginSession["type"] = "nip7") {
    this.#session = {
      type: type ?? "nip7",
      publicKey: pubkey,
    };
    this.#save();
  }

  loginPrivateKey(key: string) {
    const s = new PrivateKeySigner(key);
    this.#session = {
      type: "nsec",
      publicKey: s.getPubKey(),
      privateKey: key,
    };
    this.#save();
  }

  loginBunker(url: string, localKey: string, remotePubkey: string) {
    this.#session = {
      type: "nip46",
      publicKey: remotePubkey,
      privateKey: localKey,
      bunker: url,
    };
    this.#save();
  }

  getSigner() {
    if (!this.#signer && this.#session) {
      switch (this.#session.type) {
        case "nsec":
          this.#signer = new EventPublisher(new PrivateKeySigner(this.#session.privateKey!), this.#session.publicKey);
          break;
        case "nip46":
          this.#signer = new EventPublisher(
            new Nip46Signer(this.#session.bunker!, new PrivateKeySigner(this.#session.privateKey!)),
            this.#session.publicKey,
          );
          break;
        case "nip7":
          this.#signer = new EventPublisher(new Nip7Signer(), this.#session.publicKey);
          break;
      }
    }

    if (this.#signer) {
      return this.#signer;
    }
    throw "Signer not setup!";
  }

  #save() {
    if (this.#session) {
      window.localStorage.setItem("session", JSON.stringify(this.#session));
    } else {
      window.localStorage.removeItem("session");
    }
    this.notifyChange();
  }
}

export const LoginState = new LoginStore();

export function useLogin() {
  const session = useSyncExternalStore(
    (c) => LoginState.hook(c),
    () => LoginState.snapshot(),
    () => undefined,
  );
  const system = useContext(SnortContext);
  useEffect(() => {
    if (session?.publicKey) {
      const wot = system.config.socialGraphInstance;
      console.log("WoT root set to: ", session.publicKey);
      wot.setRoot(session.publicKey);
    }
  }, [session, system]);
  return session
    ? {
        type: session.type,
        publicKey: session.publicKey,
        builder: LoginState.getSigner(),
        system,
      }
    : undefined;
}
