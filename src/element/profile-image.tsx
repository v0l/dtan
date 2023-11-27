import { NostrLink, NostrPrefix } from "@snort/system";
import { useUserProfile } from "@snort/system-react";
import { CSSProperties, HTMLProps } from "react";
import { Link } from "react-router-dom";

type ProfileImageProps = HTMLProps<HTMLDivElement> & {
  pubkey?: string;
  size?: number;
};

export function ProfileImage({ pubkey, size, ...props }: ProfileImageProps) {
  const profile = useUserProfile(pubkey);
  const v = {
    backgroundImage: `url(${profile?.picture})`,
  } as CSSProperties;
  if (size) {
    v.width = `${size}px`;
    v.height = `${size}px`;
  }
  return (
    <Link to={pubkey ? `/p/${new NostrLink(NostrPrefix.Profile, pubkey).encode()}` : ""}>
      <div
        {...props}
        className="rounded-full aspect-square w-12 bg-slate-800 border border-slate-200 bg-cover bg-center"
        style={v}
      ></div>
    </Link>
  );
}
