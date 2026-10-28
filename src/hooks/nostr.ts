import { CachedMetadata, NoteCollection, RequestBuilder, TaggedNostrEvent, mapEventToProfile } from "@snort/system";
import { useRequestBuilder as useSnortRequestBuilder, useUserProfile as useSnortUserProfile } from "@snort/system-react";
import { IsSSR } from "../const";
import { hydratedEvents, hydratedProfile, ssrState } from "../ssr";

function queryRelay(filters: Array<unknown>): Array<TaggedNostrEvent> {
  return JSON.parse(relayQuery(JSON.stringify(filters))) as Array<TaggedNostrEvent>;
}

function serverQuery(rb: RequestBuilder): Array<TaggedNostrEvent> {
  const state = ssrState();
  const found = queryRelay(rb.buildRaw());
  const merged = new Map<string, TaggedNostrEvent>();
  for (const ev of [...(state?.queries[rb.id] ?? []), ...found]) merged.set(ev.id, ev);
  const feed = new NoteCollection();
  feed.add([...merged.values()]);
  const snapshot = feed.snapshot;
  if (state) state.queries[rb.id] = snapshot;
  return snapshot;
}

export function useRequestBuilder(rb: RequestBuilder): Array<TaggedNostrEvent> {
  if (IsSSR) return serverQuery(rb);
  const seeded = hydratedEvents(rb.id);
  if (seeded) rb.withOptions({ extraEvents: seeded });
  return useSnortRequestBuilder(rb);
}

function serverProfile(pubkey?: string): CachedMetadata | undefined {
  const state = ssrState();
  if (!pubkey || !state) return undefined;
  if (pubkey in state.profiles) return state.profiles[pubkey];
  const ev = queryRelay([{ kinds: [0], authors: [pubkey], limit: 1 }]).at(0);
  const profile = ev ? mapEventToProfile(ev) : undefined;
  if (profile) state.profiles[pubkey] = profile;
  return profile;
}

export function useUserProfile(pubkey?: string): CachedMetadata | undefined {
  if (IsSSR) return serverProfile(pubkey);
  const live = useSnortUserProfile(pubkey);
  return live ?? (pubkey ? hydratedProfile(pubkey) : undefined);
}
