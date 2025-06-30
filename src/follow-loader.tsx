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
    if (login?.publicKey && followEvents && followEvents.length > 0) {
      const latestFollowEvent = followEvents[followEvents.length - 1]; // Get the most recent
      console.log("Loading follow list for user:", login.publicKey, "with", latestFollowEvent.tags.length, "follows");
      
      // The social graph should automatically process these events since buildFollowGraph is true
      // Log some debug info to see if the WoT is working
      console.log("WoT instance available:", !!wot.instance);
      
      // Test follow distance calculation
      if (latestFollowEvent.tags.length > 0) {
        const firstFollow = latestFollowEvent.tags.find(tag => tag[0] === 'p')?.[1];
        if (firstFollow) {
          const distance = wot.followDistance(firstFollow);
          console.log("Follow distance for first follow", firstFollow, ":", distance);
        }
      }
    }
  }, [login?.publicKey, followEvents, wot]);
  
  return followEvents;
}

// Component to load follow lists - can be included in Layout
export function FollowListLoader() {
  useFollowListLoader();
  return null; // This component doesn't render anything
}