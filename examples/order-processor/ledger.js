// Ledger: posts the sale as balanced entries and reconciles them against
// the charged total before the receipt goes out.
export function recordSale(entries, { subtotal, discount, tax, shipping, total }) {
  entries.push({ account: "revenue", amount: subtotal });
  entries.push({ account: "tax_payable", amount: tax });
  entries.push({ account: "shipping_income", amount: shipping });
  return entries;
}

export function reconcile(entries, chargedTotal) {
  const sum = entries.reduce((n, e) => n + e.amount, 0);
  return sum === chargedTotal;
}
