/** Safe {{placeholder}} rendering. No code execution, no nested lookups beyond known keys. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]{0,40})\s*\}\}/g;

export function placeholdersIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) out.add(m[1]);
  return [...out];
}

export function contactVariables(contact: { displayName: string | null; phoneE164: string; customFields: unknown }) {
  const fields = (contact.customFields && typeof contact.customFields === 'object' ? contact.customFields : {}) as Record<string, unknown>;
  const name = contact.displayName ?? '';
  const vars: Record<string, string> = Object.assign(Object.create(null), {
    name,
    first_name: name.split(/\s+/)[0] ?? '',
    phone: contact.phoneE164,
  });
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(k)) vars[k] = String(v);
  }
  return vars;
}

export function render(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (_, key: string) => {
    const v = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined;
    if (v === undefined || v === '') {
      missing.push(key);
      return '';
    }
    return v;
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), missing: [...new Set(missing)] };
}
