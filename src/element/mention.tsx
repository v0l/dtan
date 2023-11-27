import { hexToBech32 } from "@snort/shared";
import { NostrLink } from "@snort/system";
import { useUserProfile } from "@snort/system-react";
import { Link } from "react-router-dom";

export function Mention({ link }: { link: NostrLink }) {
  const profile = useUserProfile(link.id);
  const npub = hexToBech32("npub", link.id);

  return <Link to={`/p/${link.encode()}`}>{profile?.name ?? npub.slice(0, 12)}</Link>;
}
