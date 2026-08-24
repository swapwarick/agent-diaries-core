import * as msgpack from 'msgpack-lite';

/**
 * Encode a JavaScript value to MessagePack binary format.
 * Returns a Uint8Array which is suitable for storage or network transmission.
 */
export function encode(value: any): Uint8Array {
  // msgpack-lite returns a Buffer (Node.js). Convert to Uint8Array for consistency.
  const buffer: Buffer = msgpack.encode(value);
  return new Uint8Array(buffer);
}

/**
 * Decode a MessagePack Uint8Array back to a JavaScript value.
 */
export function decode<T = any>(data: Uint8Array): T {
  // Convert Uint8Array to Buffer for msgpack-lite.
  const buffer = Buffer.from(data);
  return msgpack.decode(buffer) as T;
}
