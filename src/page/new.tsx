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

export function NewPage() {
  const login = useLogin();
  const navigate = useNavigate();

  const [obj, setObj] = useState({
    name: "",
    desc: "",
    btih: "",
    tags: [] as Array<string>,
    files: [] as Array<{
      name: string;
      size: number;
    }>,
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
        <div className="flex gap-1 bg-slate-500 p-1 rounded">
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
          <label>{a?.name}</label>
        </div>
        {a.sub_category?.map((b) => renderCategories(b, [...tags, b.tag]))}
      </>
    );
  }

  return (
    <>
      <h1>New</h1>
      <div className="flex gap-1">
        <Button onClick={loadTorrent}>Import from Torrent</Button>
        <Button>Import from Magnet</Button>
      </div>
      <h2>Torrent Info</h2>
      <form className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex-1 flex flex-col gap-1">
            <label>Title</label>
            <input
              type="text"
              placeholder="raw noods"
              value={obj.name}
              onChange={(e) => setObj((o) => ({ ...o, name: e.target.value }))}
            />
            <label>Info Hash</label>
            <input
              type="text"
              placeholder="hex"
              value={obj.btih}
              onChange={(e) => setObj((o) => ({ ...o, btih: e.target.value }))}
            />
            <label>Category</label>
            <div className="flex flex-col gap-1">
              {Categories.map((a) => (
                <div className="flex flex-col gap-1">
                  <div className="font-bold bg-slate-800 p-1">{a.name}</div>
                  <div className="flex gap-1 flex-wrap">{renderCategories(a, [a.tag])}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <label>Description</label>
            <textarea
              rows={20}
              className="font-mono text-xs"
              value={obj.desc}
              onChange={(e) => setObj((o) => ({ ...o, desc: e.target.value }))}
            ></textarea>
          </div>
        </div>
        <h2>Files</h2>
        <div className="flex flex-col gap-2">
          {obj.files.map((a, i) => (
            <div className="flex gap-1">
              <input
                type="text"
                value={a.name}
                className="flex-1"
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
          onClick={() =>
            setObj((o) => ({
              ...o,
              files: [...o.files, { name: "", size: 0 }],
            }))
          }
        >
          Add File
        </Button>
        <Button onClick={publish}>Publish</Button>
      </form>
    </>
  );
}
