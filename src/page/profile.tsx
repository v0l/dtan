import { useUserProfile } from "../hooks/nostr";
import { Link, useParams } from "react-router-dom";
import { ProfileImage } from "../element/profile-image";
import { CachedMetadata, parseNostrLink } from "@snort/system";
import { LatestTorrents } from "../element/latest";
import { Text } from "../element/text";
import { LoginState, useLogin } from "../login";
import { Button } from "../element/button";
import { NotFoundPage } from "./not-found";
import { hexToBech32 } from "@snort/shared";
import { setStatus, useHead } from "../ssr";

export function ProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const link = parseNostrLink(id);

  if (!link) {
    setStatus(404);
    return <NotFoundPage />;
  }
  return (
    <div className="flex flex-col gap-4">
      <ProfileSection pubkey={link.id} />
      <LatestTorrents author={link.id} />
    </div>
  );
}

export function ProfileSection({ pubkey }: { pubkey: string }) {
  const profile = useUserProfile(pubkey);
  useHead({
    title: profile?.name || hexToBech32("npub", pubkey).slice(0, 12),
    description: profile?.about?.slice(0, 200),
    image: profile?.picture,
    path: `/p/${hexToBech32("npub", pubkey)}`,
  });
  const login = useLogin();

  return (
    <div className="flex items-center gap-4 mb-4">
      <ProfileImage pubkey={pubkey} size={200} />
      <div className="flex flex-col gap-4 grow">
        <h2>{(profile?.name?.length ?? 0) > 0 ? profile?.name : hexToBech32("npub", pubkey).slice(0, 12)}</h2>
        {(profile?.about?.length ?? 0) > 0 && <Text content={profile?.about ?? ""} tags={[]} />}
        <WebSiteLink profile={profile} />
        {login?.publicKey === pubkey && (
          <Button
            type="primary"
            onClick={() => {
              LoginState.logout();
            }}
          >
            Logout
          </Button>
        )}
      </div>
    </div>
  );
}

function WebSiteLink({ profile }: { profile?: CachedMetadata }) {
  const website = profile?.website;
  if (!website) return;

  const hostname = website.startsWith("http") ? new URL(website).hostname : website;
  const url = website.startsWith("http") ? website : `https://${website}`;

  return (
    <Link to={url} target="_blank">
      {hostname}
    </Link>
  );
}
