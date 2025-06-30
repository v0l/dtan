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
  
  // Create subscription for second-degree follows (follows of follows)
  const userFollows = followEvents.length > 0 
    ? followEvents[followEvents.length - 1].tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1])
        .slice(0, 100) // Limit to first 100 follows to avoid too many requests
    : [];
    
  const secondDegreeSub = new RequestBuilder(`follow-list-2nd:${login?.publicKey ?? "none"}`);
  secondDegreeSub.withFilter().authors(userFollows).kinds([ContactListKind]);
  
  const secondDegreeFollows = useRequestBuilder(secondDegreeSub);
  
  useEffect(() => {
    if (login?.publicKey && followEvents && followEvents.length > 0) {
      const latestFollowEvent = followEvents[followEvents.length - 1]; // Get the most recent
      console.log("Loading follow list for user:", login.publicKey, "with", latestFollowEvent.tags.length, "follows");
      
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
      
      // Test distance to self (should be 0)
      const selfDistance = wot.followDistance(login.publicKey);
      console.log("Follow distance to self:", selfDistance);
    }
    
    if (secondDegreeFollows.length > 0) {
      console.log("Loaded", secondDegreeFollows.length, "second-degree follow lists");
    }
  }, [login?.publicKey, followEvents, secondDegreeFollows, wot]);
  
  return { followEvents, secondDegreeFollows };
}

// Component to load follow lists - can be included in Layout
export function FollowListLoader() {
  useFollowListLoader();
  return null; // This component doesn't render anything
}