import { describe, it, expect } from 'vitest';
import { normalizeSyncPayload } from '../../app/core/sync/sync-payload-normalizer';
import { TABLE_PAYLOAD_SCHEMAS, PostPayloadSchema } from '../../shared/sync/schemas';
import { toClientFormat } from '../../shared/sync/field-mappings';

describe('tmp normalizer post check', () => {
  it('checks isValid', () => {
    const raw = {
      id: 'p1',
      title: 't',
      content: 'c',
      post_type: 'markdown',
      deleted: false,
      created_at: 1,
      updated_at: 1,
      clock: 1,
    };
    const mapped = toClientFormat('posts', raw);
    const direct = PostPayloadSchema.safeParse(mapped);
    const fromTable = TABLE_PAYLOAD_SCHEMAS['posts']?.safeParse(mapped as any);
    const result = normalizeSyncPayload('posts', 'p1', raw, { clock: 1, hlc: 'h' });
    console.log({ mapped, direct: direct.success, fromTable: fromTable?.success, result });
    expect(result.isValid).toBe(true);
  });
});
