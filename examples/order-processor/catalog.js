// Product catalog. Prices are stored as integer cents; weights in grams.
// Stock counts back the async availability checks in services.js.
export const PRODUCTS = [
  { id: "book", name: "Book", priceCents: 1299, category: "media", weightGrams: 400, stock: 50 },
  { id: "pen", name: "Pen", priceCents: 199, category: "office", weightGrams: 20, stock: 200 },
  { id: "lamp", name: "Lamp", priceCents: 5499, category: "home", weightGrams: 1200, stock: 10 },
  { id: "mug", name: "Mug", priceCents: 899, category: "home", weightGrams: 350, stock: 100 },
  { id: "keyboard", name: "Keyboard", priceCents: 7499, category: "office", weightGrams: 900, stock: 25 },
  { id: "notebook", name: "Notebook", priceCents: 649, category: "office", weightGrams: 300, stock: 120 },
  { id: "headphones", name: "Headphones", priceCents: 12999, category: "media", weightGrams: 600, stock: 15 },
];

export function getProduct(productId) {
  const p = PRODUCTS.find((x) => x.id === productId);
  if (!p) throw new Error(`Unknown product: ${productId}`);
  return p;
}

export function getPriceCents(productId) {
  return getProduct(productId).priceCents;
}

export function getWeightGrams(productId) {
  return getProduct(productId).weightGrams;
}
