/* eslint-disable no-console */
import { appendArray } from './array.js'

console.log('should append the given numbers to the array')
const arr = [1, 2, 3]
const largeArray = Array.from({ length: 1_000_000 }, (_, i) => i)
const result = appendArray(arr, ...largeArray)
console.assert(result.length === 1_000_003, 'Result length is incorrect')
console.log('Test passed')
