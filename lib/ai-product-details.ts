/**
 * Writes a product name and description from a product photo, using a vision
 * model on OpenRouter. Server only: needs OPENROUTER_API_KEY.
 *
 * OPENROUTER_MODEL may name another vision model; the default is a fast,
 * low-cost one. If the chosen model is refused, the fallback model is tried.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const FALLBACK_MODEL = 'openai/gpt-4o-mini';
const TIMEOUT_MS = 45_000;

/** Longest name and description the product form accepts. */
export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 480;

export class ProductDetailsError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You write product listings for Discount Discovery Zone, a department store in Accra, Ghana, that sells household items, bags, clothes, shoes, kitchenware, kids' items and beauty products.

Look at the photo and return JSON only, in this exact shape:
{"name": "...", "description": "..."}

Name: what the item is, the way a shopper would search for it, in sentence case, at most 8 words. Add the colour, size or count only when the photo shows it clearly (for example "3 tier storage rack", "Men cross body bag"). No brand unless the brand is printed on the item.

Description: 2 or 3 short sentences in plain English, at most 450 characters. Say what it is, what it is for, and features you can actually see (colour, material, compartments, pieces in a set). Do not invent measurements, materials, capacities, brands or prices. No exclamation marks, no emojis, no hashtags.

If the photo shows several different items, describe the main one. If you cannot tell what the item is, use {"name": "", "description": ""}.`;

function clean(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .slice(0, max)
    .trim();
}

function parseReply(content: string): { name: string; description: string } {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new ProductDetailsError('The writer did not return a name and description. Try again.');
  let data: any;
  try {
    data = JSON.parse(match[0]);
  } catch {
    throw new ProductDetailsError('The writer did not return a name and description. Try again.');
  }
  return { name: clean(data?.name, NAME_MAX), description: clean(data?.description, DESCRIPTION_MAX) };
}

async function ask(model: string, apiKey: string, imageDataUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Write the name and description for this product.' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Name and description for the product in the photo. Throws ProductDetailsError. */
export async function writeProductDetails(image: { bytes: Buffer; contentType: string }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProductDetailsError('Writing from a photo is not set up yet (no OpenRouter key on the server).', 503);
  }
  const imageDataUrl = `data:${image.contentType};base64,${image.bytes.toString('base64')}`;
  const primary = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const models = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];

  let lastProblem = 'The writer is not answering. Try again in a moment.';
  for (const model of models) {
    let res: Response;
    try {
      res = await ask(model, apiKey, imageDataUrl);
    } catch (err: any) {
      lastProblem = err?.name === 'AbortError' ? 'The writer took too long. Try again.' : lastProblem;
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProductDetailsError('The OpenRouter key on the server was refused.', 503);
    }
    if (res.status === 402) {
      throw new ProductDetailsError('The OpenRouter account has no credit left.', 503);
    }
    if (res.status === 429) {
      throw new ProductDetailsError('Too many requests to the writer. Wait a minute and try again.', 429);
    }
    if (!res.ok) {
      // Unknown or unavailable model, or a provider error: try the next model.
      lastProblem = `The writer could not read this photo (${res.status}). Try again.`;
      continue;
    }
    const body: any = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    const text = Array.isArray(content)
      ? content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('')
      : typeof content === 'string'
        ? content
        : '';
    if (!text) {
      lastProblem = 'The writer returned nothing for this photo. Try again.';
      continue;
    }
    return { ...parseReply(text), model };
  }
  throw new ProductDetailsError(lastProblem);
}
