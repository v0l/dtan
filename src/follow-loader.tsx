import { useEffect } from "react";
import { RequestBuilder } from "@snort/system";
import { useRequestBuilder } from "@snort/system-react";
import { ContactListKind } from "./const";
import useWoT from "./wot";
import { useLogin } from "./login";

export function useFollowListLoader() {
  const login = useLogin();
  const wot = useWoT();
  
  // Create subscription for the user's contact list  
  const sub = new RequestBuilder(`follow-list:${login?.publicKey ?? "none"}`);
  sub.withFilter().authors(login?.publicKey ? [login.publicKey] : []).kinds([ContactListKind]);
  
  const followEvents = useRequestBuilder(sub);
  
  useEffect(() => {
    if (login?.publicKey && followEvents && followEvents.length > 0 && wot.instance) {
      const latestFollowEvent = followEvents[followEvents.length - 1]; // Get the most recent
      console.log("Loading follow list for user:", login.publicKey, "with", latestFollowEvent.tags.length, "follows");
      
      // The social graph should automatically process these events since buildFollowGraph is true
      // But we might need to explicitly tell it who the root user is
      if (typeof wot.instance.setRoot === 'function') {
        wot.instance.setRoot(login.publicKey);
      }
    }
  }, [login?.publicKey, followEvents, wot.instance]);
  
  return followEvents;
}

// Component to load follow lists - can be included in Layout
export function FollowListLoader() {
  useFollowListLoader();
  return null; // This component doesn't render anything
}