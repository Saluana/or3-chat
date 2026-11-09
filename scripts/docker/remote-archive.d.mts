import type { Readable, Writable } from 'node:stream';

export type RemoteReference = { workspaceId: string; hash: string; storageId: string; sizeBytes: number };
export type RemoteSource = { endpointOrigin: string; bucket: string; keyPrefix: string };
export function assertRemoteSource(source: RemoteSource): void;
export type RemoteInventory = {
  version: 1;
  source: RemoteSource;
  entries: (RemoteReference & { mimeType: string; markerSha256: string; markerBytes: number })[];
};
export function validateMarker(bytes: Uint8Array, ref: RemoteReference): { mimeType: string };
export function createArchiveWriter(out: Writable): {
  addFile(name: string, size: number, source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<{ sha256: string; md5: string }>;
  finish(inventory: RemoteInventory): Promise<string>;
};
export function verifyArchive(input: Readable, references: Iterable<RemoteReference>, source: RemoteSource): Promise<{ contract: 2; kind: 's3-copy-v1'; objectCount: number; payloadBytes: number; inventorySha256: string }>;
export function withVerifiedArchive<T>(path: string, references: Iterable<RemoteReference>, source: RemoteSource, expectedSha256: string, use: (entries: Array<{ ref: RemoteReference; readMarker: () => Promise<Uint8Array>; openPayload: () => Readable }>) => Promise<T>): Promise<T>;
export function verifyReferenceInventory(json: string, references: Iterable<RemoteReference>, source: RemoteSource): Promise<{ contract: 2; kind: 's3-reference-v1'; objectCount: number; payloadBytes: number; inventorySha256: string }>;
