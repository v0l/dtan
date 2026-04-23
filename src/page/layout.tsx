import { Link, Outlet, useNavigate } from "react-router-dom";
import { Button } from "../element/button";
import { useLogin } from "../login";
import { ProfileImage } from "../element/profile-image";
import { Search } from "../element/search";
import { useRelays } from "../relays";
import { useContext, useEffect } from "react";
import { SnortContext } from "@snort/system-react";
import { NostrLink, RelaySettings, SystemInterface } from "@snort/system";
import { useFollowList } from "../follows";
import GithubIcon from "../element/icon/github";
import { IsSSR } from "../const";

export function Layout() {
  const login = useLogin();
  const system = useContext(SnortContext);
  const { relays } = useRelays();
  const navigate = useNavigate();
  if (!IsSSR) {
    useFollowList();
  }

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

  return (
    <div className="mx-auto px-2">
      <header className="flex gap-4 items-center pt-4 pb-6">
        <Link to={"/"} className="flex gap-2 items-center">
          <img src="/logo_256.jpg" className="rounded-full" height={40} width={40} />
          <h1 className="font-bold uppercase">dtan.xyz</h1>
        </Link>
        <div className="w-1/3 max-sm:hidden">
          <Search />
        </div>
        <div className="grow"></div>
        <a href="https://github.com/v0l/dtan" target="_blank">
          <Button type="secondary">
            <GithubIcon />
          </Button>
        </a>
        <Link to="/relays">
          <Button type="secondary">Relays</Button>
        </Link>
        {login?.publicKey ? (
          <LoggedInHeader pubkey={login.publicKey} />
        ) : (
          <Button type="primary" onClick={() => navigate("/login")}>
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

function LoggedInHeader({ pubkey }: { pubkey: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link to={`/p/${NostrLink.publicKey(pubkey).encode()}`}>
        <ProfileImage pubkey={pubkey} />
      </Link>
      <Link to="/new">
        <Button type="primary">+ Create</Button>
      </Link>
    </div>
  );
}
