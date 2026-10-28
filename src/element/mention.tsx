import { hexToBech32 } from "@snort/shared";
import { NostrLink } from "@snort/system";
import { useUserProfile } from "../hooks/nostr";
import { Link } from "react-router-dom";

export function Mention({ link }: { link: NostrLink }) {
  const profile = useUserProfile(link.id);
  const npub = hexToBech32("npub", link.id);

  return (
    <Link to={`/p/${link.encode()}`} state={profile}>
      {profile?.name ?? npub.slice(0, 12)}
    </Link>
  );
}
