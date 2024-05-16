import "./new.css";
import { ReactNode, useState } from "react";
import { Categories, Category } from "../const";
import { Button } from "../element/button";
import { useLogin } from "../login";
import { dedupe, unixNow } from "@snort/shared";
import * as bencode from "../bencode";
import { sha1 } from "@noble/hashes/sha1";
import { bytesToHex } from "@noble/hashes/utils";
import { Link, useNavigate } from "react-router-dom";
import { NostrLink } from "@snort/system";
import { NostrTorrent, TorrentTag } from "../nostr-torrent";

async function openFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const elm = document.createElement("input");
    let lock = false;
    elm.type = "file";
    elm.accept = ".torrent";
    const handleInput = (e: Event) => {
      lock = true;
      const elm = e.target as HTMLInputElement;
      if ((elm.files?.length ?? 0) > 0) {
        resolve(elm.files![0]);
      } else {
        resolve(undefined);
      }
    };

    elm.onchange = (e) => handleInput(e);
    elm.click();
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => {
          if (!lock) {
            console.debug("FOCUS WINDOW UPLOAD");
            resolve(undefined);
          }
        }, 300);
      },
      { once: true },
    );
  });
}

type TorrentEntry = {
  name: string;
  desc: string;
  btih: string;
  tcat: string;
  files: Array<{
    name: string;
    size: number;
  }>;
  trackers: Array<string>;
  externalLabels: Array<TorrentTag>;
};

function entryIsValid(entry: TorrentEntry) {
  return (
    entry.name &&
    entry.btih &&
    entry.files.length > 0 &&
    entry.tcat.length > 0 &&
    entry.files.every((f) => f.name.length > 0)
  );
}

export function NewPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [newLabelType, setNewLabelType] = useState<TorrentTag["type"]>("imdb");
  const [newLabelSubType, setNewLabelSubType] = useState("");
  const [newLabelValue, setNewLabelValue] = useState("");

  const [obj, setObj] = useState<TorrentEntry>({
    name: "",
    desc: "",
    btih: "",
    tcat: "",
    files: [],
    trackers: [],
    externalLabels: [],
  });

  async function loadTorrent() {
    const f = await openFile();
    if (f) {
      const buf = await f.arrayBuffer();
      const torrent = bencode.decode(new Uint8Array(buf)) as Record<string, bencode.BencodeValue>;
      const infoBuf = bencode.encode(torrent["info"]);
      console.debug(torrent);
      const dec = new TextDecoder();
      const info = torrent["info"] as {
        files?: Array<{ length: number; path: Array<Uint8Array> }>;
        length: number;
        name: Uint8Array;
      };
      const annouce = dec.decode(torrent["announce"] as Uint8Array | undefined);
      const announceList = (torrent["announce-list"] as Array<Array<Uint8Array>> | undefined)?.map((a) =>
        dec.decode(a[0]),
      );

      setObj({
        name: dec.decode(info.name),
        desc: dec.decode(torrent["comment"] as Uint8Array | undefined) ?? "",
        btih: bytesToHex(sha1(infoBuf)),
        tcat: "",
        files: (info.files ?? [{ length: info.length, path: [info.name] }]).map((a) => ({
          size: a.length,
          name: a.path.map((b) => dec.decode(b)).join("/"),
        })),
        trackers: dedupe([annouce, ...(announceList ?? [])]),
        externalLabels: [],
      });
    }
  }

  async function publish() {
    if (!login) return;
    const torrent = new NostrTorrent(
      undefined,
      obj.name,
      obj.desc,
      obj.btih,
      unixNow(),
      obj.files,
      obj.trackers,
      obj.externalLabels.concat([
        {
          type: "tcat",
          value: obj.tcat,
        },
      ]),
    );
    const ev = torrent.toEvent(login.publicKey);
    ev.tags.push(["alt", `${obj.name}\nTorrent published on https://dtan.xyz`]);
    console.debug(ev);

    if (ev) {
      const evSigned = await login.builder.signer.sign(ev);
      login.system.BroadcastEvent(evSigned);
      navigate(`/e/${NostrLink.fromEvent(evSigned).encode()}`);
    }
  }

  function renderCategories(a: Category, tags: Array<string>): ReactNode {
    const tcat = tags.join(",");
    return (
      <>
        <label className="category">
          <input
            type="radio"
            value={tcat}
            name="category"
            checked={obj.tcat === tcat}
            onChange={(e) =>
              setObj((o) => ({
                ...o,
                tcat: e.target.value,
              }))
            }
          />
          <div data-checked={obj.tcat === tcat}>{a?.name}</div>
        </label>

        {a.sub_category?.map((b) => renderCategories(b, [...tags, b.tag]))}
      </>
    );
  }

  function externalDbLogo(type: TorrentTag["type"]) {
    switch (type) {
      case "imdb":
        return (
          <img
            className="h-8"
            title="IMDB"
            src="https://m.media-amazon.com/images/G/01/imdb/images-ANDW73HA/favicon_desktop_32x32._CB1582158068_.png"
          />
        );
      case "tmdb":
        return (
          <img
            className="h-8"
            title="TheMovieDatabase"
            src="https://www.themoviedb.org/assets/2/favicon-32x32-543a21832c8931d3494a68881f6afcafc58e96c5d324345377f3197a37b367b5.png"
          />
        );
      case "ttvdb":
        return <img className="h-8" title="TheTVDatabase" src="https://thetvdb.com/images/icon.png" />;
      case "mal":
        return (
          <img
            className="h-8"
            title="MyAnimeList"
            src="https://myanimelist.net/img/common/pwa/launcher-icon-0-75x.png"
          />
        );
      case "anilist":
        return <img className="h-8" title="AniList" src="https://anilist.co/img/icons/favicon-32x32.png" />;
      case "newznab":
        return <img className="h-8" title="newznab" src="https://www.newznab.com/favicon.ico" />;
    }
    return <div className="border border-neutral-600 rounded-xl px-2">{type}</div>;
  }

  return (
    <>
      <h2>New Torrent</h2>
      <div className="flex gap-4 my-4">
        <Button onClick={loadTorrent} type="primary">
          Import from Torrent
        </Button>
        {/*<Button>Import from Magnet</Button>*/}
      </div>
      <form className="flex flex-col gap-2 bg-neutral-900 rounded-2xl p-6 mb-8">
        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-indigo-300">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="px-4 py-2 rounded-xl bg-neutral-800 focus-visible:outline-none"
              placeholder="Title of the torrent..."
              value={obj.name}
              onChange={(e) => setObj((o) => ({ ...o, name: e.target.value }))}
            />
            <label className=" text-indigo-300 mt-2 ">
              Info Hash <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="px-4 py-2 rounded-xl bg-neutral-800 focus-visible:outline-none"
              placeholder="Hash in hex format..."
              value={obj.btih}
              onChange={(e) => setObj((o) => ({ ...o, btih: e.target.value }))}
            />
            <label className=" text-indigo-300 mt-2">
              Category <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col gap-2">
              {Categories.map((a) => (
                <div className="flex flex-col gap-1">
                  <div className="font-bold">{a.name}</div>
                  <div className="flex gap-1 flex-wrap">{renderCategories(a, [a.tag])}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <label className="text-indigo-300">Description</label>
            <textarea
              rows={30}
              className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none font-mono text-sm"
              value={obj.desc}
              onChange={(e) => setObj((o) => ({ ...o, desc: e.target.value }))}
            ></textarea>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-indigo-300">External Ids</label>
          <div className="flex gap-2">
            <select
              value={newLabelType}
              onChange={(e) => setNewLabelType(e.target.value as TorrentTag["type"])}
              className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none"
            >
              <option value="imdb">IMDB</option>
              <option value="newznab">newznab</option>
              <option value="tmdb">TMDB (TheMovieDatabase)</option>
              <option value="ttvdb">TTVDB (TheTVDatabase)</option>
              <option value="mal">MAL (MyAnimeList)</option>
              <option value="anilist">AniList</option>
            </select>
            {(() => {
              switch (newLabelType) {
                case "mal":
                case "anilist": {
                  if (newLabelSubType !== "anime" && newLabelSubType !== "manga") {
                    setNewLabelSubType("anime");
                  }
                  return (
                    <select
                      className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none"
                      value={newLabelSubType}
                      onChange={(e) => setNewLabelSubType(e.target.value)}
                    >
                      <option value="anime">Anime</option>
                      <option value="manga">Manga</option>
                    </select>
                  );
                }
                case "tmdb": {
                  if (newLabelSubType !== "tv" && newLabelSubType !== "movie") {
                    setNewLabelSubType("tv");
                  }
                  return (
                    <select
                      className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none"
                      value={newLabelSubType}
                      onChange={(e) => setNewLabelSubType(e.target.value)}
                    >
                      <option value="tv">TV</option>
                      <option value="movie">Movie</option>
                    </select>
                  );
                }
                case "ttvdb": {
                  if (newLabelSubType !== "series" && newLabelSubType !== "movies") {
                    setNewLabelSubType("series");
                  }
                  return (
                    <select
                      className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none"
                      value={newLabelSubType}
                      onChange={(e) => setNewLabelSubType(e.target.value)}
                    >
                      <option value="series">Series</option>
                      <option value="movies">Movie</option>
                    </select>
                  );
                }
                default: {
                  if (newLabelSubType != "") {
                    setNewLabelSubType("");
                  }
                }
              }
            })()}
            <input
              type="text"
              className="p-4 rounded-xl bg-neutral-800 focus-visible:outline-none font-mono text-sm"
              value={newLabelValue}
              onChange={(e) => setNewLabelValue(e.target.value)}
            />
            <Button
              type="secondary"
              onClick={() => {
                const existing = obj.externalLabels.find((a) => a.type === newLabelType);
                if (!existing) {
                  obj.externalLabels.push({
                    type: newLabelType as TorrentTag["type"],
                    value: `${newLabelSubType ? `${newLabelSubType}:` : ""}${newLabelValue}`,
                  });
                  setObj({ ...obj });
                  setNewLabelValue("");
                }
              }}
            >
              Add
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {obj.externalLabels.map((a) => {
              const link = NostrTorrent.externalDbLink(a);
              return (
                <div className="flex justify-between bg-neutral-800 px-3 py-1 rounded-xl">
                  <div className="flex gap-2 items-center">
                    {externalDbLogo(a.type)}
                    {link && (
                      <>
                        <Link to={link} target="_blank" className="text-indigo-400 hover:underline">
                          {a.value}
                        </Link>
                      </>
                    )}
                    {!link && a.value}
                  </div>
                  <Button
                    type="danger"
                    small={true}
                    onClick={() =>
                      setObj((o) => {
                        const idx = o.externalLabels.findIndex((b) => b.type === a.type);
                        if (idx !== -1) {
                          o.externalLabels.splice(idx, 1);
                        }
                        return { ...o };
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-indigo-300">
            Files <span className="text-red-500">*</span>
          </label>
          {obj.files.map((a, i) => (
            <div className="flex gap-2">
              <input
                type="text"
                value={a.name}
                className="flex-1 px-3 py-1 bg-neutral-800 rounded-xl focus-visible:outline-none"
                placeholder="collection1/IMG_00001.jpg"
                onChange={(e) =>
                  setObj((o) => ({
                    ...o,
                    files: o.files.map((f, ii) => {
                      if (ii === i) {
                        return { ...f, name: e.target.value };
                      }
                      return f;
                    }),
                  }))
                }
              />
              <input
                type="number"
                className="px-3 py-1 bg-neutral-800 rounded-xl focus-visible:outline-none"
                value={a.size}
                min={0}
                placeholder="69000"
                onChange={(e) =>
                  setObj((o) => ({
                    ...o,
                    files: o.files.map((f, ii) => {
                      if (ii === i) {
                        return { ...f, size: Number(e.target.value) };
                      }
                      return f;
                    }),
                  }))
                }
              />
              <Button
                small
                type="danger"
                onClick={() =>
                  setObj((o) => ({
                    ...o,
                    files: o.files.filter((_, ii) => i !== ii),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="secondary"
          onClick={() =>
            setObj((o) => ({
              ...o,
              files: [...o.files, { name: "", size: 0 }],
            }))
          }
        >
          Add File
        </Button>
        <div className="flex flex-col gap-2">
          <label className="text-indigo-300">Trackers</label>
          {obj.trackers.map((a, i) => (
            <div className="flex gap-2">
              <input
                type="text"
                value={a}
                className="flex-1 px-3 py-1 bg-neutral-800 rounded-xl focus-visible:outline-none"
                placeholder="udp://mytracker.net:3333"
                onChange={(e) =>
                  setObj((o) => ({
                    ...o,
                    trackers: o.trackers.map((f, ii) => {
                      if (ii === i) {
                        return e.target.value;
                      }
                      return f;
                    }),
                  }))
                }
              />
              <Button
                small
                type="secondary"
                onClick={() =>
                  setObj((o) => ({
                    ...o,
                    trackers: o.trackers.filter((_, ii) => i !== ii),
                  }))
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="secondary"
          onClick={() =>
            setObj((o) => ({
              ...o,
              trackers: [...o.trackers, ""],
            }))
          }
        >
          Add Tracker
        </Button>
        <Button className="mt-4" type="primary" disabled={!entryIsValid(obj)} onClick={publish}>
          Publish
        </Button>
      </form>
    </>
  );
}
