import { NostrSystem } from "@snort/system";
import { IsSSR } from "./const";

const hasWasm = import.meta.env.VITE_DISABLE_WASM ? false : "WebAssembly" in globalThis;

export const System = new NostrSystem({
  buildFollowGraph: true,
});

let didInit = false;
export async function initSystem() {
  if (didInit) return;
  didInit = true;

  if (hasWasm && !IsSSR) {
    const { initWasm, WasmOptimizer, workerRelay } = await import("./wasm");
    await initWasm();
    System.config.optimizer = WasmOptimizer;
    System.config.cachingRelay = workerRelay;
  }

  await System.Init();
}
