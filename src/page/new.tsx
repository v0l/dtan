import "./new.css";
import { ReactNode, useState } from "react";
import { Categories, Category, TorrentKind } from "../const";
import { Button } from "../element/button";
import { useLogin } from "../login";
import { dedupe } from "@snort/shared";
import * as bencode from "../bencode";
import { sha1 } from "@noble/hashes/sha1";
import { bytesToHex } from "@noble/hashes/utils";
import { useNavigate } from "react-router-dom";
import { NostrLink } from "@snort/system";

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
  tags: string[];
  files: Array<{
    name: string;
    size: number;
  }>;
};

function entryIsValid(entry: TorrentEntry) {
  return (
    entry.name &&
    entry.btih &&
    entry.files.length > 0 &&
    entry.tags.length > 0 &&
    entry.files.every((f) => f.name.length > 0)
  );
}

export function NewPage() {
  const login = useLogin();
  const navigate = useNavigate();

  const [obj, setObj] = useState<TorrentEntry>({
    name: "",
    desc: "",
    btih: "",
    tags: [],
    files: [],
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

      setObj({
        name: dec.decode(info.name),
        desc: dec.decode(torrent["comment"] as Uint8Array | undefined) ?? "",
        btih: bytesToHex(sha1(infoBuf)),
        tags: [],
        files: (info.files ?? [{ length: info.length, path: [info.name] }]).map((a) => ({
          size: a.length,
          name: a.path.map((b) => dec.decode(b)).join("/"),
        })),
      });
    }
  }

  async function publish() {
    if (!login) return;
    const ev = await login.builder.generic((eb) => {
      const v = eb
        .kind(TorrentKind)
        .content(obj.desc)
        .tag(["title", obj.name])
        .tag(["btih", obj.btih])
        .tag(["alt", `${obj.name}\nTorrent published on https://dtan.xyz`]);

      obj.tags.forEach((t) => v.tag(["t", t]));
      obj.files.forEach((f) => v.tag(["file", f.name, String(f.size)]));

      return v;
    });
    console.debug(ev);

    if (ev) {
      await login.system.BroadcastEvent(ev);
    }
    navigate(`/e/${NostrLink.fromEvent(ev).encode()}`);
  }

  function renderCategories(a: Category, tags: Array<string>): ReactNode {
    return (
      <>
        <label className="category">
          <input
            type="radio"
            value={tags.join(",")}
            name="category"
            checked={obj.tags.join(",") === tags.join(",")}
            onChange={(e) =>
              setObj((o) => ({
                ...o,
                tags: e.target.checked ? dedupe(e.target.value.split(",")) : [],
              }))
            }
          />
          <div data-checked={obj.tags.join(",") === tags.join(",")}>{a?.name}</div>
        </label>

        {a.sub_category?.map((b) => renderCategories(b, [...tags, b.tag]))}
      </>
    );
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
                type="secondary"
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
        <Button className="mt-4" type="primary" disabled={!entryIsValid(obj)} onClick={publish}>
          Publish
        </Button>
      </form>
    </>
  );
}
