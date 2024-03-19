import { NostrSystem } from "@snort/system";
import { WorkerRelayInterface } from "@snort/worker-relay";
import WorkerVite from "@snort/worker-relay/src/worker?worker";

const workerScript = import.meta.env.DEV
  ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
  : new WorkerVite();
const workerRelay = new WorkerRelayInterface(workerScript);

export const System = new NostrSystem({
  cachingRelay: workerRelay,
});

let didInit = false;
export async function initSystem() {
  if (didInit) return;
  didInit = true;

  await workerRelay.init("dtan.db");
  await System.Init();
  for (const r of ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.nostr.band"]) {
    await System.ConnectToRelay(r, { read: true, write: true });
  }
}
