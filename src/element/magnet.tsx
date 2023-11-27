import { TaggedNostrEvent } from "@snort/system";
import { Trackers } from "../const";
import { Link, LinkProps } from "react-router-dom";

type MagnetLinkProps = Omit<LinkProps, "to"> & {
  item: TaggedNostrEvent;
  size?: number;
};

export function MagnetLink({ item, size, ...props }: MagnetLinkProps) {
  const btih = item.tags.find((a) => a[0] === "btih")?.at(1);
  const name = item.tags.find((a) => a[0] === "title")?.at(1);
  const magnet = {
    xt: `urn:btih:${btih}`,
    dn: name,
    tr: Trackers,
  };
  const params = Object.entries(magnet)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return v.map((a) => `${k}=${encodeURIComponent(a)}`).join("&");
      } else {
        return `${k}=${v as string}`;
      }
    })
    .flat()
    .join("&");
  const link = `magnet:?${params}`;

  return (
    <Link {...props} to={link}>
      <svg width={size ?? 20} height={size ?? 20} version="1.1" viewBox="0 0 64 64" fill="currentColor">
        <path
          d="M54.5,9.5c-4.9-5-11.4-7.8-18.3-7.8c-6.5,0-12.6,2.4-17.2,7L3.6,24.3c-2.5,2.5-2.5,6.6,0,9.1l5.9,5.9c2.5,2.5,6.6,2.5,9.1,0
	l14.5-14.4c1.8-1.8,4.6-2.1,6.3-0.7c0.9,0.7,1.4,1.8,1.5,3c0.1,1.4-0.5,2.7-1.5,3.7L24.9,45.4c-2.5,2.5-2.5,6.6,0,9.1l5.9,5.9
	c1.2,1.2,2.9,1.9,4.5,1.9c1.6,0,3.3-0.6,4.5-1.9l15.5-15.5C64.8,35.4,64.5,19.6,54.5,9.5z M15.4,36c-0.7,0.7-2,0.7-2.7,0l-5.9-5.9
	c-0.7-0.7-0.7-2,0-2.7l5.1-5.1l8.6,8.6L15.4,36z M36.6,57.2c-0.7,0.7-2,0.7-2.7,0L28,51.3c-0.7-0.7-0.7-2,0-2.7l5.1-5.1l8.6,8.6
	L36.6,57.2z M52.2,41.7L45,48.9l-8.6-8.6l6.3-6.3c1.9-1.9,2.9-4.5,2.8-7.1c-0.1-2.5-1.3-4.7-3.2-6.3c-1.6-1.3-3.5-1.9-5.5-1.9
	c-2.5,0-5,1-6.9,2.9l-6.1,6.1l-8.6-8.6l7.2-7.2c3.7-3.6,8.6-5.7,13.9-5.7c0,0,0.1,0,0.1,0c5.7,0,11,2.3,15.1,6.5
	C59.5,21,59.9,34,52.2,41.7z"
        />
      </svg>

      {props.children}
    </Link>
  );
}
