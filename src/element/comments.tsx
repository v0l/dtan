import { useState } from "react";
import { NostrLink, RequestBuilder, TaggedNostrEvent } from "@snort/system";
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

// Helper function to extract sats amount from zap receipt
function getZapAmount(zapEvent: TaggedNostrEvent): number {
  // Look for the "bolt11" tag which contains the lightning invoice
  const bolt11Tag = zapEvent.tags.find((tag: string[]) => tag[0] === "bolt11");
  if (!bolt11Tag || !bolt11Tag[1]) return 0;
  
  try {
    // Decode the bolt11 invoice to get the amount
    // For now, let's try to extract from the description tag which often contains the amount
    const descriptionTag = zapEvent.tags.find((tag: string[]) => tag[0] === "description");
    if (descriptionTag && descriptionTag[1]) {
      try {
        const zapRequest = JSON.parse(descriptionTag[1]);
        const amountTag = zapRequest.tags?.find((tag: string[]) => tag[0] === "amount");
        if (amountTag && amountTag[1]) {
          return parseInt(amountTag[1]) / 1000; // Convert millisats to sats
        }
      } catch {
        // If JSON parsing fails, try to find amount in bolt11 directly
      }
    }
    
    // Fallback: try to extract amount from bolt11 invoice string
    const bolt11 = bolt11Tag[1];
    const amountMatch = bolt11.match(/(\d+)[nm]?$/); // Look for amount at end
    if (amountMatch) {
      const amount = parseInt(amountMatch[1]);
      // If ends with 'n', it's nanosats; if 'm', it's millisats; otherwise assume sats
      if (bolt11.endsWith('n')) return Math.floor(amount / 1000000000); 
      if (bolt11.endsWith('m')) return Math.floor(amount / 1000);
      return amount;
    }
  } catch (e) {
    console.warn("Failed to parse zap amount:", e);
  }
  
  return 0;
}

export function Comments({ link }: { link: NostrLink }) {
  // Fetch comments
  const commentRb = new RequestBuilder(`replies:${link.encode()}`);
  commentRb.withFilter().kinds([TorrentCommentKind]).replyToLink([link]);
  const comments = useRequestBuilder(commentRb);

  // Fetch zaps
  const zapRb = new RequestBuilder(`zaps:${link.encode()}`);
  zapRb.withFilter().kinds([ZapKind]).replyToLink([link]);
  const zaps = useRequestBuilder(zapRb);

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
