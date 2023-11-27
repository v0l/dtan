import { EventKind } from "@snort/system";

/**
 * @constant {number} - Size of 1 kiB
 */
export const kiB = Math.pow(1024, 1);
/**
 * @constant {number} - Size of 1 MiB
 */
export const MiB = Math.pow(1024, 2);
/**
 * @constant {number} - Size of 1 GiB
 */
export const GiB = Math.pow(1024, 3);
/**
 * @constant {number} - Size of 1 TiB
 */
export const TiB = Math.pow(1024, 4);
/**
 * @constant {number} - Size of 1 PiB
 */
export const PiB = Math.pow(1024, 5);
/**
 * @constant {number} - Size of 1 EiB
 */
export const EiB = Math.pow(1024, 6);
/**
 * @constant {number} - Size of 1 ZiB
 */
export const ZiB = Math.pow(1024, 7);
/**
 * @constant {number} - Size of 1 YiB
 */
export const YiB = Math.pow(1024, 8);

export interface Category {
  name: string;
  tag: string;
  sub_category?: Array<Category>;
}

export const Categories = [
  {
    name: "Video",
    tag: "video",
    sub_category: [
      {
        name: "Movies",
        tag: "movie",
        sub_category: [
          {
            name: "Movies DVDR",
            tag: "dvdr",
          },
          {
            name: "HD Movies",
            tag: "hd",
          },
          {
            name: "4k Movies",
            tag: "4k",
          },
        ],
      },
      {
        name: "TV",
        tag: "tv",
        sub_category: [
          {
            name: "HD TV",
            tag: "hd",
          },
          {
            name: "4k TV",
            tag: "4k",
          },
        ],
      },
    ],
  },
  {
    name: "Audio",
    tag: "audio",
    sub_category: [
      {
        name: "Music",
        tag: "music",
        sub_category: [
          {
            name: "FLAC",
            tag: "flac",
          },
        ],
      },
      {
        name: "Audio Books",
        tag: "audio-book",
      },
    ],
  },
  {
    name: "Applications",
    tag: "application",
    sub_category: [
      {
        name: "Windows",
        tag: "windows",
      },
      {
        name: "Mac",
        tag: "mac",
      },
      {
        name: "UNIX",
        tag: "unix",
      },
      {
        name: "iOS",
        tag: "ios",
      },
      {
        name: "Android",
        tag: "android",
      },
    ],
  },
  {
    name: "Games",
    tag: "game",
    sub_category: [
      {
        name: "PC",
        tag: "pc",
      },
      {
        name: "Mac",
        tag: "mac",
      },
      {
        name: "PSx",
        tag: "psx",
      },
      {
        name: "XBOX",
        tag: "xbox",
      },
      {
        name: "Wii",
        tag: "wii",
      },
      {
        name: "iOS",
        tag: "ios",
      },
      {
        name: "Android",
        tag: "android",
      },
    ],
  },
  {
    name: "Porn",
    tag: "porn",
    sub_category: [
      {
        name: "Movies",
        tag: "movie",
        sub_category: [
          {
            name: "Movies DVDR",
            tag: "dvdr",
          },
          {
            name: "HD Movies",
            tag: "hd",
          },
          {
            name: "4k Movies",
            tag: "4k",
          },
        ],
      },
      {
        name: "Pictures",
        tag: "picture",
      },
      {
        name: "Games",
        tag: "game",
      },
    ],
  },
  {
    name: "Other",
    tag: "other",
    sub_category: [
      {
        name: "Archives",
        tag: "archive",
      },
      {
        name: "E-Books",
        tag: "e-book",
      },
      {
        name: "Comics",
        tag: "comic",
      },
      {
        name: "Pictures",
        tag: "picture",
      },
    ],
  },
] as Array<Category>;

export const TorrentKind = 2003 as EventKind;

export function FormatBytes(b: number, f?: number) {
  f ??= 2;
  if (b >= YiB) return (b / YiB).toFixed(f) + " YiB";
  if (b >= ZiB) return (b / ZiB).toFixed(f) + " ZiB";
  if (b >= EiB) return (b / EiB).toFixed(f) + " EiB";
  if (b >= PiB) return (b / PiB).toFixed(f) + " PiB";
  if (b >= TiB) return (b / TiB).toFixed(f) + " TiB";
  if (b >= GiB) return (b / GiB).toFixed(f) + " GiB";
  if (b >= MiB) return (b / MiB).toFixed(f) + " MiB";
  if (b >= kiB) return (b / kiB).toFixed(f) + " KiB";
  return b.toFixed(f) + " B";
}

export const Trackers = [
  "udp://tracker.coppersurfer.tk:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.opentrackr.org:1337",
];
