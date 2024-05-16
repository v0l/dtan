import { FlatReqFilter, NostrEvent, NostrSystem, Optimizer, PowMiner, ReqFilter } from "@snort/system";
import {
  default as wasmInit,
  expand_filter,
  get_diff,
  flat_merge,
  compress,
  schnorr_verify_event,
  pow,
} from "@snort/system-wasm";
import { WorkerRelayInterface } from "@snort/worker-relay";
import WorkerVite from "@snort/worker-relay/src/worker?worker";

import WasmPath from "@snort/system-wasm/pkg/system_wasm_bg.wasm?url";

const workerScript = import.meta.env.DEV
  ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
  : new WorkerVite();
const workerRelay = new WorkerRelayInterface(workerScript);

export const WasmOptimizer = {
  expandFilter: (f: ReqFilter) => {
    return expand_filter(f) as Array<FlatReqFilter>;
  },
  getDiff: (prev: Array<ReqFilter>, next: Array<ReqFilter>) => {
    return get_diff(prev, next) as Array<FlatReqFilter>;
  },
  flatMerge: (all: Array<FlatReqFilter>) => {
    return flat_merge(all) as Array<ReqFilter>;
  },
  compress: (all: Array<ReqFilter>) => {
    return compress(all) as Array<ReqFilter>;
  },
  schnorrVerify: (ev) => {
    return schnorr_verify_event(ev);
  },
} as Optimizer;

export class WasmPowWorker implements PowMiner {
  minePow(ev: NostrEvent, target: number): Promise<NostrEvent> {
    const res = pow(ev, target);
    return Promise.resolve(res);
  }
}

export const System = new NostrSystem({
  cachingRelay: workerRelay,
  optimizer: WasmOptimizer,
});

let didInit = false;
export async function initSystem() {
  if (didInit) return;
  didInit = true;

  const tasks = [
    wasmInit(WasmPath),
    workerRelay.init({
      databasePath: "dtan.db",
      insertBatchSize: 100,
    }),
    System.Init(),
  ];

  await Promise.all(tasks);
}
