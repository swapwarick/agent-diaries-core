// src/types/msgpack-lite.d.ts
declare module 'msgpack-lite' {
  // Encode a JavaScript value to a Buffer (Node.js Buffer)
  export function encode(value: unknown): Buffer;

  // Decode a Buffer back to a value, generic for convenience
  export function decode<T = any>(buffer: Buffer): T;
}
