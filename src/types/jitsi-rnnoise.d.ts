/**
 * Minimal declarations for the `@jitsi/rnnoise-wasm` package, which ships
 * Emscripten-built WASM with no bundled types. We only consume the C API
 * we call directly.
 */
declare module '@jitsi/rnnoise-wasm' {
  export interface RnnoiseModule {
    _rnnoise_create(): number;
    _rnnoise_destroy(state: number): void;
    _rnnoise_process_frame(state: number, output: number, input: number): number;
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPF32: Float32Array;
    HEAP16: Int16Array;
  }
  export function createRNNWasmModule(overrides?: unknown): Promise<RnnoiseModule>;
  export function createRNNWasmModuleSync(overrides?: unknown): RnnoiseModule;
}
