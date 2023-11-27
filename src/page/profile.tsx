import { useUserProfile } from "@snort/system-react";
import { Link, useParams } from "react-router-dom";
import { ProfileImage } from "../element/profile-image";
import { parseNostrLink } from "@snort/system";
import { LatestTorrents } from "../element/trending";
import { Text } from "../element/text";

export function ProfilePage() {
  const params = useParams();
  const id = params.id as string;
  const link = parseNostrLink(id);

  if (!link) return;
  return (
    <div className="flex flex-col gap-2">
      <ProfileSection pubkey={link.id} />
      <LatestTorrents author={link.id} />
    </div>
  );
}

export function ProfileSection({ pubkey }: { pubkey: string }) {
  const profile = useUserProfile(pubkey);
  return (
    <div className="flex items-center gap-3">
      <ProfileImage pubkey={pubkey} size={240} />
      <div className="flex flex-col gap-2">
        <h2>{profile?.name}</h2>
        <Text content={profile?.about ?? ""} tags={[]} />
        {profile?.website && (
          <Link to={profile.website} target="_blank">
            {new URL(profile.website).hostname}
          </Link>
        )}
      </div>
    </div>
  );
}
