import type { S3Client } from '@aws-sdk/client-s3';
import type { Writable } from 'node:stream';
import type { RemoteReference, RemoteSource } from './remote-archive.mjs';

export function captureRemoteObjects(client: S3Client, source: RemoteSource, references: Iterable<RemoteReference>, output: Writable): Promise<{ contract: 2; kind: 's3-copy-v1'; objectCount: number; payloadBytes: number; inventorySha256: string }>;
export function reconcileReferences(client: S3Client, source: RemoteSource, entries: Array<{ ref: RemoteReference; readMarker: () => Promise<Uint8Array>; openPayload: () => import('node:stream').Readable }>): Promise<{ uploaded: number; markersCreated: number }>;
export function checkRemoteReferences(client: S3Client, source: RemoteSource, references: Iterable<RemoteReference>, expectedMimeTypes?: ReadonlyMap<string, string>): Promise<{ checked: number; missing: string[]; mismatched: string[] }>;
