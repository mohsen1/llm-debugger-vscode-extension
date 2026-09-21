// Stock reservations: checks live availability, holds units while the order
// prices and charges, and releases the hold when a later stage fails.
import { fetchStockAsync } from "./services.js";

const held = new Map();

function holdKey(reservationId) {
  return String(reservationId).split(":")[1];
}

export async function checkAvailability(lines) {
  const out = [];
  for (const line of lines) {
    const stock = await fetchStockAsync(line.id);
    out.push({ ...line, available: stock - (held.get(line.id) || 0) });
  }
  return out;
}

export async function takeReservation(lines) {
  const ids = [];
  for (const line of lines) {
    const [quote] = await checkAvailability([line]);
    if (quote.available < line.qty) throw new Error(`Insufficient stock: ${line.id}`);
    held.set(line.id, (held.get(line.id) || 0) + line.qty);
    ids.push(`${line.id}:${Date.now()}:${ids.length}`);
  }
  return ids;
}

export async function releaseReservation(reservationIds) {
  for (const rid of reservationIds) {
    held.delete(holdKey(rid));
  }
}

export function __resetReservations() {
  held.clear();
}
