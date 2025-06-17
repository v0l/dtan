import { useState } from "react";
import { NostrLink, RequestBuilder, TaggedNostrEvent, parseZap } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { unwrap } from "@snort/shared";

import { ProfileImage } from "./profile-image";
import { Button } from "./button";
import { useLogin } from "../login";
import { Text } from "./text";
import { TorrentCommentKind, ZapKind, formatSats } from "../const";

// Types for combined interactions
type CommentInteraction = TaggedNostrEvent & { type: 'comment' };
type ZapInteraction = TaggedNostrEvent & { type: 'zap'; amount: number };
type Interaction = CommentInteraction | ZapInteraction;

// Helper function to extract sats amount from zap receipt using parseZap
function getZapAmount(zapEvent: TaggedNostrEvent): number {
  try {
    const zapInfo = parseZap(zapEvent);
    return zapInfo?.amount ?? 0;
  } catch (e) {
    console.warn("Failed to parse zap amount:", e);
    return 0;
  }
}

export function Comments({ link }: { link: NostrLink }) {
  // Fetch both comments and zaps in a single filter
  const rb = new RequestBuilder(`interactions:${link.encode()}`);
  rb.withFilter().kinds([TorrentCommentKind, ZapKind]).replyToLink([link]);
  const interactions = useRequestBuilder(rb);

  // Separate comments and zaps
  const comments = interactions.filter(event => event.kind === TorrentCommentKind);
  const zaps = interactions.filter(event => event.kind === ZapKind);

  // Calculate total zaps
  const totalZaps = zaps.reduce((total, zap) => total + getZapAmount(zap), 0);

  // Combine and sort all interactions by timestamp
  const allInteractions: Interaction[] = [
    ...comments.map(c => ({ ...c, type: 'comment' as const })),
    ...zaps.map(z => ({ ...z, type: 'zap' as const, amount: getZapAmount(z) }))
  ].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

  return (
    <div className="flex flex-col gap-2">
      <WriteComment link={link} />
      {totalZaps > 0 && (
        <div className="flex items-center gap-2 text-orange-400 font-semibold p-2 bg-neutral-800 rounded-lg">
          <span>⚡</span>
          <span>Total Zaps: {formatSats(totalZaps)} sats</span>
        </div>
      )}
      {allInteractions.map((item, i) => (
        <div key={i} className={`flex flex-col gap-2 rounded-lg p-4 ${item.type === 'zap' ? 'bg-orange-900/20 border border-orange-500/30' : 'bg-neutral-900'}`}>
          <ProfileImage pubkey={item.pubkey} withName={true}>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 text-sm">{new Date(item.created_at * 1000).toLocaleString()}</span>
              {item.type === 'zap' && (
                <span className="text-orange-400 text-sm font-semibold">
                  ⚡ {formatSats((item as ZapInteraction).amount)} sats
                </span>
              )}
            </div>
          </ProfileImage>
          {item.type === 'comment' && <Text content={item.content} tags={item.tags} />}
          {item.type === 'zap' && item.content && <Text content={item.content} tags={item.tags} />}
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
