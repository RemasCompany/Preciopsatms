import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';
import { PLANS } from './plans';
import { HttpError } from './tenant';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/** One credit = one AI request. Metered per org per billing period. */
async function spendCredit(org: { id: string; plan: keyof typeof PLANS; aiCreditsUsed: number }) {
  const limit = PLANS[org.plan].monthlyAiCredits;
  const updated = await db.organization.updateMany({ where: { id: org.id, aiCreditsUsed: { lt: limit } }, data: { aiCreditsUsed: { increment: 1 } } });
  if (updated.count === 0) throw new HttpError(402, 'You have used all AI credits for this billing period. Add a credit pack or upgrade.');
}

export async function aiText(org: Parameters<typeof spendCredit>[0], prompt: string, maxTokens = 1200) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'AI isn’t set up on this server yet (ANTHROPIC_API_KEY is missing).');
  await spendCredit(org);
  try {
    const res = await anthropic.messages.create({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  } catch (e) {
    // The request didn't produce anything useful, so give the credit back.
    await db.organization.updateMany({ where: { id: org.id, aiCreditsUsed: { gt: 0 } }, data: { aiCreditsUsed: { decrement: 1 } } });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, 'AI isn’t set up correctly on this server (the API key was rejected).');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI is busy right now. Wait a minute and try again.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, 'AI couldn’t finish that. Try again.');
    throw e;
  }
}

export async function aiJson<T>(org: Parameters<typeof spendCredit>[0], prompt: string, maxTokens = 1500): Promise<T> {
  const text = await aiText(org, `${prompt}\n\nReply with only valid JSON. No markdown fences, no commentary.`, maxTokens);
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean) as T; } catch { throw new HttpError(502, 'The AI reply could not be read. Try again.'); }
}
