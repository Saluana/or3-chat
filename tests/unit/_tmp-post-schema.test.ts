import { describe, it, expect } from 'vitest';
import { toClientFormat } from '../../shared/sync/field-mappings';
import { PostPayloadSchema } from '../../shared/sync/schemas';

describe('tmp post schema check', () => {
  it('shows parse result', () => {
    const payload = {
      id: '1',
      title: 't',
      content: 'c',
      post_type: 'markdown',
      deleted: false,
      created_at: 1,
      updated_at: 1,
      clock: 1,
    };
    const mapped = toClientFormat('posts', payload);
    const parsed = PostPayloadSchema.safeParse(mapped);
    expect(parsed.success).toBe(false);
  });
});
