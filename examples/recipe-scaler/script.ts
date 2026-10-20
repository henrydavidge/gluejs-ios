// Scale Recipe: multiply every ingredient amount in a recipe
//
// Input: first line is how much to scale ("2", "1/2", "1.5", "half", "double", or
// "6 servings" when the recipe says how many it serves); the rest is the recipe: text shared
// from any app or copied first, or a recipe page link shared from Safari (most recipe sites
// publish their ingredients as schema.org data, which is used when present).
// Output: the scaled recipe. Lines that start with an amount ("1 ½ cups flour", "2-3 cloves
// garlic", "200 g butter") are scaled; numbered steps and other text are left alone.

const FRACTIONS: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const VULGAR = Object.keys(FRACTIONS).join('');
// One amount: "1 1/2", "1½", "1 ½", "3/4", "¾", "0.5", "1,5", "2".
const AMOUNT = `(?:\\d+(?:[.,]\\d+)?(?:\\s*[${VULGAR}]|\\s+\\d+/\\d+)?|\\d+/\\d+|[${VULGAR}])`;
// An ingredient line: optional bullet, an amount, optionally a range to a second amount.
const INGREDIENT = new RegExp(`^(\\s*(?:[-•*▢]\\s*)?)(${AMOUNT})(?:(\\s*(?:-|–|to)\\s*)(${AMOUNT}))?(?=\\s|[a-zA-Z]|$)`);
const SERVES = /\b(?:serves|servings?:?|yield:?|makes)\s*(\d+)|(\d+)\s*(?:servings|portions)\b/i;

function parseAmount(text: string): number {
  let total = 0;
  for (const part of text.trim().split(/\s+|(?=[¼½¾⅓⅔⅛⅜⅝⅞])/)) {
    if (FRACTIONS[part] !== undefined) total += FRACTIONS[part];
    else if (part.includes('/')) {
      const [n, d] = part.split('/').map(Number);
      total += n / d;
    } else total += Number(part.replace(',', '.'));
  }
  return total;
}

// Kitchen-friendly numbers: ½, 1⅓, 2¾ under 10; whole numbers above.
function formatAmount(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const whole = Math.floor(value);
  const rest = value - whole;
  const candidates: [number, string][] = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];
  const [fraction, glyph] = candidates.reduce((best, c) => (Math.abs(c[0] - rest) < Math.abs(best[0] - rest) ? c : best));
  const wholePart = whole + (fraction === 1 ? 1 : 0);
  if (!glyph) return String(wholePart || (value > 0 ? '⅛' : 0));
  return wholePart ? `${wholePart}${glyph}` : glyph;
}

function parseScale(text: string, recipe: string): { factor: number; servings?: number } {
  const t = text.trim().toLowerCase().replace(/^x\s*|\s*x$/g, '');
  const words: Record<string, number> = { half: 0.5, double: 2, triple: 3, quadruple: 4, third: 1 / 3, quarter: 0.25 };
  if (words[t]) return { factor: words[t] };
  // "6 servings", "4 people", "36 cookies": a target for the recipe's "Serves 4" / "Makes 24".
  const wanted = /^(\d+)\s+[a-z]+$/.exec(t);
  if (wanted) {
    const match = SERVES.exec(recipe);
    const original = Number(match?.[1] ?? match?.[2]);
    if (!original) throw new Error(`The recipe doesn't say how many it serves, so "${text.trim()}" can't be worked out. Use a number like 2 or 1/2.`);
    return { factor: Number(wanted[1]) / original, servings: Number(wanted[1]) };
  }
  const factor = parseAmount(t);
  if (!Number.isFinite(factor) || factor <= 0 || !new RegExp(`^${AMOUNT}$`).test(t)) {
    throw new Error(`"${text.trim()}" isn't a scale. Use a number like 2, 1/2 or 1.5, "half", "double", or "6 servings".`);
  }
  return { factor };
}

// Most recipe sites describe the recipe as schema.org JSON-LD for search engines; use that
// when a web page is shared.
async function recipeFromPage(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Couldn't open ${new URL(url).hostname} (HTTP ${response.status}).`);
  const html = await response.text();
  type Node = { '@type'?: string | string[]; '@graph'?: Node[]; name?: string; recipeYield?: unknown; recipeIngredient?: string[] };
  const nodes: Node[] = [];
  for (const [, json] of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(json);
      for (const item of [data].flat()) nodes.push(item, ...(item['@graph'] ?? []));
    } catch { /* ignore malformed blocks */ }
  }
  const recipe = nodes.find((n) => [n['@type']].flat().includes('Recipe') && n.recipeIngredient?.length);
  if (!recipe) throw new Error("This page doesn't list its ingredients in a standard way. Select the ingredients and share them instead.");
  const yields = [recipe.recipeYield].flat().find((y) => /\d/.test(String(y ?? '')));
  return [recipe.name ?? '', yields ? `Makes ${String(yields).match(/\d+/)![0]}` : '', ...recipe.recipeIngredient!.map((i) => `- ${i}`)]
    .filter(Boolean).join('\n');
}

export default async function main(): Promise<string> {
  const text = String(rawInput ?? '').replace(/\r\n?/g, '\n');
  const newline = text.indexOf('\n');
  let recipe = newline < 0 ? '' : text.slice(newline + 1).trim();
  if (!recipe) return 'Share a recipe (or copy one first), then run Scale Recipe again.';
  if (/^https?:\/\/\S+$/.test(recipe)) recipe = await recipeFromPage(recipe);
  const { factor, servings } = parseScale(text.slice(0, newline), recipe);

  let scaled = 0;
  const lines = recipe.split('\n').map((line) => {
    if (/^\s*\d+[.)]\s/.test(line)) return line; // numbered step, not an amount
    const servesMatch = SERVES.exec(line);
    if (servesMatch) {
      const n = Number(servesMatch[1] ?? servesMatch[2]);
      return line.replace(String(n), formatAmount(servings ?? n * factor));
    }
    const m = INGREDIENT.exec(line);
    if (!m) return line;
    scaled++;
    const [whole, bullet, first, dash, second] = m;
    const range = second ? `${dash}${formatAmount(parseAmount(second) * factor)}` : '';
    // Also amounts in parentheses: "1 cup (2 sticks) butter".
    const rest = line.slice(whole.length).replace(new RegExp(`\\((${AMOUNT})(?=\\s)`, 'g'),
      (_, amount: string) => `(${formatAmount(parseAmount(amount) * factor)}`);
    return bullet + formatAmount(parseAmount(first) * factor) + range + rest;
  });
  console.log(`factor ${factor}, ${scaled} ingredient lines scaled`);
  if (!scaled) return `No ingredient amounts found to scale. Share just the ingredients list, one per line.`;
  return `Scaled × ${formatAmount(factor)}\n\n${lines.join('\n')}`;
}
