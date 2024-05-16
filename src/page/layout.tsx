import { Link, Outlet } from "react-router-dom";
import { Button } from "../element/button";
import { LoginSession, LoginState, useLogin } from "../login";
import { ProfileImage } from "../element/profile-image";
import { Search } from "../element/search";
import { useRelays } from "../relays";
import { useContext, useEffect } from "react";
import { SnortContext } from "@snort/system-react";
import { RelaySettings, SystemInterface } from "@snort/system";

export function Layout() {
  const login = useLogin();
  const system = useContext(SnortContext);
  const { relays } = useRelays();

  async function updateRelayConnections(system: SystemInterface, relays: Record<string, RelaySettings>) {
    if (import.meta.env.VITE_SINGLE_RELAY) {
      system.ConnectToRelay(import.meta.env.VITE_SINGLE_RELAY, { read: true, write: true });
    } else {
      for (const [k, v] of Object.entries(relays)) {
        // note: don't awit this, causes race condition with sending requests to relays
        system.ConnectToRelay(k, v);
      }
      for (const [k, v] of system.pool) {
        if (!relays[k] && !v.ephemeral) {
          system.DisconnectRelay(k);
        }
      }
    }
  }

  useEffect(() => {
    updateRelayConnections(system, Object.fromEntries(relays.map((a) => [a, { read: true, write: true }])));
  }, [system, relays]);

  async function DoLogin() {
    if ("nostr" in window) {
      const pubkey = await window.nostr?.getPublicKey();
      if (pubkey) {
        LoginState.login(pubkey);
      }
    }
  }

  return (
    <div className="container mx-auto">
      <header className="flex gap-4 items-center pt-4 pb-6">
        <Link to={"/"} className="flex gap-2 items-center">
          <img src="/logo_256.jpg" className="rounded-full" height={40} width={40} />
          <h1 className="font-bold uppercase">dtan.xyz</h1>
        </Link>
        <div className="w-1/3">
          <Search />
        </div>
        <div className="grow"></div>
        <Link to="/relays">
          <Button type="secondary">Relays</Button>
        </Link>
        {login ? (
          <LoggedInHeader login={login} />
        ) : (
          <Button type="primary" onClick={DoLogin}>
            Login
          </Button>
        )}
      </header>
      <div>
        <Outlet />
      </div>
    </div>
  );
}

function LoggedInHeader({ login }: { login: LoginSession }) {
  return (
    <div className="flex items-center gap-2">
      <ProfileImage pubkey={login.publicKey} />
      <Link to="/new">
        <Button type="primary">+ Create</Button>
      </Link>
    </div>
  );
}
