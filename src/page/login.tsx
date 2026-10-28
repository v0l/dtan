import { Nip46Signer, Nip7Signer, PrivateKeySigner } from "@snort/system";
import { Button } from "../element/button";
import { LoginState } from "../login";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { bech32ToHex } from "@snort/shared";
import { useHead } from "../ssr";

export default function LoginPage() {
  const [key, setKey] = useState("");
  const navigate = useNavigate();
  useHead({ title: "Login", noindex: true });

  return (
    <>
      <div className="flex flex-col gap-8">
        <h2>Login</h2>
        <hr />
        <div className="flex flex-col gap-4">
          <input type="password" placeholder="nsec/bunker" value={key} onChange={(e) => setKey(e.target.value)} />
          <Button
            type="primary"
            onClick={async () => {
              if (key.startsWith("nsec1")) {
                LoginState.loginPrivateKey(bech32ToHex(key));
                navigate("/");
              } else if (key.startsWith("bunker://")) {
                const signer = new Nip46Signer(key);
                await signer.init();
                const pubkey = await signer.getPubKey();
                LoginState.loginBunker(key, signer.privateKey!, pubkey);
                navigate("/");
              }
            }}
          >
            Login
          </Button>
        </div>
        {typeof window !== "undefined" && window.nostr && (
          <div className="flex flex-col gap-4">
            Browser Extension:
            <Button
              type="primary"
              onClick={async () => {
                const pk = await new Nip7Signer().getPubKey();
                LoginState.login(pk);
                navigate("/");
              }}
            >
              Nostr Extension
            </Button>
          </div>
        )}

        <h2>Create Account</h2>
        <hr />
        <Button
          type="primary"
          onClick={async () => {
            const s = PrivateKeySigner.random();
            LoginState.loginPrivateKey(s.privateKey);
            navigate("/");
          }}
        >
          Generate Account
        </Button>
      </div>
    </>
  );
}
