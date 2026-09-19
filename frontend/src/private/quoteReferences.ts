/** Encode existing, grounded quote enums as short references during inference.
 * Saved output still contains the exact source quote and passes normal validation.
 * Mark the original prompt in place, rather than duplicating source in a legend.
 */
export function quoteReferences(schema: object, prompt: string) {
  const quotes = new Map<string, string>();
  const collect = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'quote' && value && typeof value === 'object' && 'enum' in value && Array.isArray(value.enum)) {
        for (const quote of value.enum) {
          if (typeof quote === 'string' && quote && prompt.includes(quote)) quotes.set(quote, '');
        }
      } else collect(value);
    }
  };
  collect(schema);
  // Overlapping quotation candidates are retained verbatim: no ambiguous labels.
  const spans: {start: number; end: number; id: string; quote: string}[] = [];
  for (const quote of quotes.keys()) {
    const start = prompt.lastIndexOf(quote), end = start + quote.length;
    if (spans.some(s => start < s.end && end > s.start)) continue;
    const id = `Q${spans.length + 1}`;
    spans.push({start, end, id, quote});
    quotes.set(quote, id);
  }
  if (!spans.length) return {schema, prompt, restore: (value: unknown) => value};
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => {
      if (key === 'quote' && value && typeof value === 'object' && 'enum' in value && Array.isArray(value.enum)) {
        return [key, {...value, enum: value.enum.map((q: unknown) => typeof q === 'string' ? quotes.get(q) || q : q)}];
      }
      return [key, walk(value)];
    }));
  };
  const byId = new Map(spans.map(s => [s.id, s.quote]));
  const restore = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(restore);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) =>
      [key, key === 'quote' && typeof value === 'string' ? byId.get(value) || value : restore(value)]));
  };
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    prompt = prompt.slice(0, span.start) + `[${span.id}] ` + prompt.slice(span.start);
  }
  return {schema: walk(schema) as object, prompt, restore};
}
