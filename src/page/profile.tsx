import { useUserProfile } from "@snort/system-react";
import { Link, useParams } from "react-router-dom";
import { ProfileImage } from "../element/profile-image";
import { CachedMetadata, parseNostrLink } from "@snort/system";
import { LatestTorrents } from "../element/trending";
import { Text } from "../element/text";

export function ProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const link = parseNostrLink(id);

  if (!link) return;
  return (
    <div className="flex flex-col gap-4">
      <ProfileSection pubkey={link.id} />
      <LatestTorrents author={link.id} />
    </div>
  );
}

export function ProfileSection({ pubkey }: { pubkey: string }) {
  const profile = useUserProfile(pubkey);

  return (
    <div className="flex items-center gap-4 mb-4">
      <ProfileImage pubkey={pubkey} size={200} />
      <div className="flex flex-col gap-4">
        <h2>{profile?.name}</h2>
        <Text content={profile?.about ?? ""} tags={[]} />
        <WebSiteLink profile={profile} />
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
