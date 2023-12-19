import { Link, Outlet } from "react-router-dom";
import { Button } from "../element/button";
import { LoginSession, LoginState, useLogin } from "../login";
import { ProfileImage } from "../element/profile-image";
import { Search } from "../element/search";

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
      <header className="flex justify-between items-center pt-4 pb-6">
        <Link to={"/"} className="flex gap-2 items-center">
          <img src="/logo_256.jpg" className="rounded-full" height={40} width={40} />
          <h1 className="font-bold uppercase">dtan.xyz</h1>
        </Link>
        <div className="w-1/2"><Search /></div>
        {login ? <LoggedInHeader login={login} /> : <Button type="primary" onClick={DoLogin}>Login</Button>}
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
