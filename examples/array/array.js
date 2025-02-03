/**
 * Appends items to the end of an array.
 * @template T
 * @param {T} arr
 * @param  {...T} args
 * @returns {T[]} The modified array
 */
export function appendArray(arr, ...args) {
  arr.push(...args)
  return arr
}
