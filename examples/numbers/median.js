

function median(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('Invalid input');
    }
    const sorted = arr.slice().sort();
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

console.assert(median([3, 1, 2]) === 2, 'Odd length with single-digit numbers');
console.assert(median([1, 2, 3, 4]) === 2.5, 'Even length with single-digit numbers');
console.assert(median([1]) === 1, 'Single element');
console.assert(median([1, 2, 10, 4]) === 3, 'Even length with numbers larger than 10');
