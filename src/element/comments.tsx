import { useState } from "react";
import { NostrLink, NoteCollection, RequestBuilder } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { unwrap } from "@snort/shared";

import { ProfileImage } from "./profile-image";
import { Button } from "./button";
import { useLogin } from "../login";
import { Text } from "./text";
import { TorrentCommentKind } from "../const";

export function Comments({ link }: { link: NostrLink }) {
  const rb = new RequestBuilder(`replies:${link.encode()}`);
  rb.withFilter().kinds([TorrentCommentKind]).replyToLink([link]);
  const comments = useRequestBuilder(NoteCollection, rb);

  return (
    <div className="flex flex-col gap-2">
      <WriteComment link={link} />
      {comments.data
        ?.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
        .map((a) => (
          <div className="flex flex-col gap-2 rounded p-2 bg-slate-900">
            <ProfileImage pubkey={a.pubkey} withName={true}>
              <span className="text-slate-400 text-sm">{new Date(a.created_at * 1000).toLocaleString()}</span>
            </ProfileImage>
            <Text content={a.content} tags={a.tags} />
          </div>
        ))}
    </div>
  );
}

function WriteComment({ link }: { link: NostrLink }) {
  const login = useLogin();
  const [msg, setMsg] = useState("");
  if (!login) return;

  async function sendComment() {
    const ev = await login?.builder.generic((eb) => {
      return eb
        .kind(TorrentCommentKind)
        .content(msg)
        .tag([...unwrap(link.toEventTag()), "root"]);
    });
    console.debug(ev);
    if (ev) {
      await login?.system.BroadcastEvent(ev);
    }
  }

  return (
    <div className="rounded p-2 bg-slate-900">
      <h3>Write a Comment</h3>
      <textarea className="w-full" value={msg} onChange={(e) => setMsg(e.target.value)}></textarea>
      <Button onClick={sendComment}>Send</Button>
    </div>
  );
}
