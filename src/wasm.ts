import { DefaultOptimizer, Optimizer } from "@snort/system";
import { default as wasmInit, schnorr_verify_event } from "@snort/system-wasm";
import { WorkerRelayInterface } from "@snort/worker-relay";
import WorkerVite from "@snort/worker-relay/src/worker?worker";

import WasmPath from "@snort/system-wasm/pkg/system_wasm_bg.wasm?url";

const workerScript = import.meta.env.DEV
    ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
    : new WorkerVite();
export const workerRelay = new WorkerRelayInterface(workerScript);

export const WasmOptimizer = {
    ...DefaultOptimizer,
    schnorrVerify: (ev) => {
        return schnorr_verify_event(ev);
    },
} as Optimizer;

export async function initWasm() {
    await wasmInit(WasmPath);
    await workerRelay.init({
        databasePath: "dtan.db"
    });
    await workerRelay.configureSearchIndex({
        2003: ["title", "file"], // index torrent titles and filenames (content is always indexed)
    });
}
