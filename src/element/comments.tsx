import { useState } from "react";
import { NostrLink, ParsedZap, RequestBuilder, TaggedNostrEvent, parseZap } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";

import { ProfileImage } from "./profile-image";
import { Button } from "./button";
import { useLogin } from "../login";
import { Text } from "./text";
import { SSRKeepAlive, TorrentCommentKind, ZapKind, formatSats } from "../const";

// Types for combined interactions
type CommentInteraction = TaggedNostrEvent & { type: "comment" };
type ZapInteraction = TaggedNostrEvent & { type: "zap"; zap: ParsedZap };
type Interaction = CommentInteraction | ZapInteraction;

export function Comments({ ev }: { ev: TaggedNostrEvent }) {
  const link = NostrLink.fromEvent(ev);

  // Fetch both comments and zaps in a single filter
  const rb = new RequestBuilder(`interactions:${link.encode()}`).withOptions({ keepAlive: SSRKeepAlive });
  rb.withFilter().kinds([TorrentCommentKind, ZapKind]).replyToLink([link]);
  const interactions = useRequestBuilder(rb);

  // Separate comments and zaps
  const comments = interactions.filter((event) => event.kind === TorrentCommentKind);
  const zaps = interactions
    .filter((event) => event.kind === ZapKind)
    .map((z) => {
      return {
        zap: parseZap(z),
        event: z,
      };
    });

  // Calculate total zaps
  const totalZaps = zaps.reduce((total, zap) => total + (zap.zap.amount ?? 0), 0);

  // Combine and sort all interactions by timestamp
  const allInteractions: Interaction[] = [
    ...comments.map((c) => ({ ...c, type: "comment" as const })),
    ...zaps.map((z) => ({ ...z.event, type: "zap" as const, zap: z.zap })),
  ].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

  return (
    <div className="flex flex-col gap-2">
      <WriteComment ev={ev} />
      {totalZaps > 0 && (
        <div className="flex items-center gap-2 text-orange-400 font-semibold p-2 bg-neutral-800 rounded-lg">
          <span>⚡</span>
          <span>Total Zaps: {formatSats(totalZaps)} sats</span>
        </div>
      )}
      {allInteractions.length === 0 && <small>No comments found.</small>}
      {allInteractions.map((item, i) => (
        <div
          key={i}
          className={`flex flex-col gap-2 rounded-lg p-4 ${item.type === "zap" ? "bg-orange-900/20 border border-orange-500/30" : "bg-neutral-900"}`}
        >
          <ProfileImage pubkey={item.type === "zap" ? (item.zap.sender ?? item.pubkey) : item.pubkey} withName={true}>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 text-sm">{new Date(item.created_at * 1000).toLocaleString()}</span>
              {item.type === "zap" && (
                <span className="text-orange-400 text-sm font-semibold">
                  ⚡ {formatSats((item as ZapInteraction).zap.amount)} sats
                </span>
              )}
            </div>
          </ProfileImage>
          {item.type === "comment" && <Text content={item.content} tags={item.tags} />}
          {item.type === "zap" && item.content && <Text content={item.content} tags={item.tags} />}
        </div>
      ))}
    </div>
  );
}

function WriteComment({ ev }: { ev: TaggedNostrEvent }) {
  const login = useLogin();
  const [msg, setMsg] = useState("");
  if (!login) return;

  async function sendComment() {
    const e = await login?.builder.reply(ev, msg);
    console.debug(e);
    setMsg("");
    if (e) {
      await login?.system.BroadcastEvent(e);
    }
  }

  return (
    <div className="rounded-lg p-4 bg-neutral-900 flex flex-row gap-4">
      <div className="flex-shrink">
        <ProfileImage pubkey={login.publicKey} />
      </div>
      <div className="flex-grow">
        <textarea
          className="px-4 py-2 rounded-xl bg-neutral-800 focus-visible:outline-none w-full"
          placeholder="Write a comment..."
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
        ></textarea>
      </div>
      <div>
        <Button type="primary" onClick={sendComment}>
          Send
        </Button>
      </div>
    </div>
  );
}
