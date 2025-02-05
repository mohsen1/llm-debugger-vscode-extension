/**
 * Appends items to the end of an array.
 * @template T
 * @param {T} arr
 * @param  {T[]} other
 * @returns {T[]} The modified array
 */
export function appendArray(arr, other) {
  arr.push(...other);
  return arr;
}
