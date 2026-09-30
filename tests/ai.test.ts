import { describe, expect, it, vi } from 'vitest';

const updateMany = vi.hoisted(() => vi.fn(async (_args: unknown) => ({ count: 1 })));
const create = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const real = (await orig<{ default: typeof import('@anthropic-ai/sdk').default }>()).default;
  class Fake { messages = { create }; static AuthenticationError = real.AuthenticationError; static PermissionDeniedError = real.PermissionDeniedError; static RateLimitError = real.RateLimitError; static APIError = real.APIError; static InternalServerError = real.InternalServerError; }
  return { default: Fake };
});
vi.mock('@/lib/db', () => ({ db: { organization: { updateMany } } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import { aiText } from '@/lib/ai';

describe('aiText', () => {
  it('fails with a clear message, without spending a credit, when no API key is configured', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(aiText({ id: 'o', plan: 'growth', aiCreditsUsed: 0 }, 'hi')).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/ANTHROPIC_API_KEY/) });
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it.each([
    ['rejected key', () => new Anthropic.AuthenticationError(401, { error: {} }, 'bad key', new Headers()), 503],
    ['rate limit', () => new Anthropic.RateLimitError(429, { error: {} }, 'slow down', new Headers()), 429],
    ['server error', () => new Anthropic.InternalServerError(500, { error: {} }, 'oops', new Headers()), 502],
  ])('maps a %s to a friendly error and refunds the credit', async (_n, err, status) => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    updateMany.mockClear(); create.mockRejectedValueOnce(err());
    await expect(aiText({ id: 'o', plan: 'growth', aiCreditsUsed: 0 }, 'hi')).rejects.toMatchObject({ status });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1]![0]).toMatchObject({ data: { aiCreditsUsed: { decrement: 1 } } });
    delete process.env.ANTHROPIC_API_KEY;
  });
});
