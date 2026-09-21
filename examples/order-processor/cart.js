// Cart normalization: trims ids, drops non-positive quantities, merges
// duplicate lines for the same product, and validates against the catalog.
import { getPriceCents } from "./catalog.js";

export function validateLines(rawLines) {
  const out = [];
  for (const line of rawLines) {
    const id = String(line.id ?? "").trim();
    const qty = Math.floor(Number(line.qty));
    if (!id || !(qty > 0)) continue;
    getPriceCents(id);
    out.push({ id, qty });
  }
  return out;
}

export function normalizeLines(rawLines) {
  const valid = validateLines(rawLines);
  const merged = new Map();
  for (const line of valid) {
    if (merged.has(line.id)) {
      const prev = merged.get(line.id);
      prev.qty = line.qty;
    } else {
      merged.set(line.id, { id: line.id, qty: line.qty });
    }
  }
  return [...merged.values()];
}

export function cartQuantity(lines) {
  return lines.reduce((n, l) => n + l.qty, 0);
}
