import type { SystemInterface, TaggedNostrEvent } from "@snort/system";

declare global {
  interface Window {
    __SNORT_HYDRATION__?: Record<string, Array<TaggedNostrEvent>>;
  }
}

export function hydrateSnort(system: SystemInterface) {
  if (typeof window !== "undefined" && window.__SNORT_HYDRATION__) {
    for (const [id, events] of Object.entries(window.__SNORT_HYDRATION__)) {
      system.hydrateQuery(id, events);
    }
    delete window.__SNORT_HYDRATION__;
  }
}

export function getHydrationScript(system: SystemInterface): string {
  const data = system.getHydrationData();
  const keys = Object.keys(data);
  if (keys.length === 0) return "";

  return `<script>window.__SNORT_HYDRATION__ = ${JSON.stringify(data)}</script>`;
}
