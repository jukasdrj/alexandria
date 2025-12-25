// Type declarations for WASM modules used by jSquash

declare module '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '@jsquash/png/codec/pkg/squoosh_png_bg.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '@jsquash/webp/codec/enc/webp_enc.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
