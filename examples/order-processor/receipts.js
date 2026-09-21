// Receipts: renders the priced lines and totals for the customer record.
export function renderReceipt({ lines, priceOf, subtotal, discount, tax, shipping, total, chargeId }) {
  const rendered = lines.map((l) => ({
    id: l.id,
    qty: l.qty,
    unitCents: priceOf(l.id),
    lineCents: priceOf(l.id) * l.qty,
  }));
  return { lines: rendered, subtotal, discount, tax, shipping, total, chargeId };
}
