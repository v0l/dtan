import { Link, Outlet } from "react-router-dom";
import { Button } from "../element/button";
import { LoginSession, LoginState, useLogin } from "../login";
import { ProfileImage } from "../element/profile-image";

export function Layout() {
  const login = useLogin();

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
      <header className="flex justify-between items-center p-1">
        <Link to={"/"} className="flex gap-1 items-center">
          <img src="/logo_256.jpg" className="rounded-full" height={40} width={40} />
          <h1 className="font-bold uppercase">dtan.xyz</h1>
        </Link>
        {login ? <LoggedInHeader login={login} /> : <Button onClick={DoLogin}>Login</Button>}
      </header>
      <div className="p-1">
        <Outlet />
      </div>
    </div>
  );
}

function LoggedInHeader({ login }: { login: LoginSession }) {
  return (
    <div className="flex items-center gap-3">
      <ProfileImage pubkey={login.publicKey} />
      <Link to="/new">
        <Button>+ Create</Button>
      </Link>
    </div>
  );
}
