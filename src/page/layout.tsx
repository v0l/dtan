import { Link, Outlet, useNavigate } from "react-router-dom";
import { Button } from "../element/button";
import { LoginSession, useLogin } from "../login";
import { ProfileImage } from "../element/profile-image";
import { Search } from "../element/search";
import { useRelays } from "../relays";
import { useContext, useEffect } from "react";
import { SnortContext } from "@snort/system-react";
import { RelaySettings, SystemInterface } from "@snort/system";
import { FollowListLoader } from "../follow-loader";
import { WoTDebugger } from "../element/wot-debugger";

export function Layout() {
  const login = useLogin();
  const system = useContext(SnortContext);
  const { relays } = useRelays();
  const navigate = useNavigate();

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

  // Configure the system with the current user when they log in
  useEffect(() => {
    if (login?.publicKey && system) {
      console.log("Configuring system with user:", login.publicKey);
      
      // The social graph instance might need to know the current user
      // Try to set the system's public key context
      if (system.config && system.config.socialGraphInstance) {
        console.log("Social graph instance available");
        const sgi = system.config.socialGraphInstance as any;
        
        // Log available methods to understand the API
        console.log("Social graph methods available:", Object.getOwnPropertyNames(Object.getPrototypeOf(sgi)));
        
        // Try some common method names
        if (typeof sgi.setUser === 'function') {
          sgi.setUser(login.publicKey);
          console.log("Set social graph user:", login.publicKey);
        } else if (typeof sgi.setRoot === 'function') {
          sgi.setRoot(login.publicKey);  
          console.log("Set social graph root:", login.publicKey);
        } else if (typeof sgi.buildFromUser === 'function') {
          sgi.buildFromUser(login.publicKey);
          console.log("Building social graph from user:", login.publicKey);
        } else {
          console.log("No known user configuration method found");
        }
      }
    }
  }, [login?.publicKey, system]);

  return (
    <div className="container mx-auto">
      <FollowListLoader />
      <WoTDebugger />
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
