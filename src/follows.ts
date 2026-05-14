import { EventKind, RequestBuilder } from "@snort/system";
import { useLogin } from "./login";
import { useRequestBuilder } from "@snort/system-react";
import { SSRKeepAlive } from "./const";

export function useFollowList() {
  const login = useLogin();
  const rb = new RequestBuilder("follow-list").withOptions({ keepAlive: SSRKeepAlive });
  if (login?.publicKey) {
    rb.withFilter().authors([login.publicKey]).kinds([EventKind.ContactList]);
  }
  const followList = useRequestBuilder(rb);
  const list = followList.find((a) => a.kind === EventKind.ContactList);
  const pTags = list?.tags.filter((t) => t[0] === "p").map((t) => t[1]) ?? [];

  const rbFollows = new RequestBuilder("follow-lists").withOptions({ keepAlive: SSRKeepAlive });
  if (pTags.length > 0) {
    rbFollows.withFilter().authors(pTags).kinds([EventKind.ContactList]);
  }
  return useRequestBuilder(rbFollows);
}
