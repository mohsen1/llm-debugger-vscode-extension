// Money helpers. The canonical unit across the checkout is integer cents.
// dollarsToCents is used at display boundaries; percentOf backs the
// percentage-based pricing rules (discounts, tax).
export function dollarsToCents(dollars) {
  return Math.round(dollars * 100);
}

export function percentOf(amountCents, rate) {
  const amountDollars = amountCents / 100;
  const resultDollars = amountDollars * rate;
  return Math.floor(resultDollars * 100);
}
