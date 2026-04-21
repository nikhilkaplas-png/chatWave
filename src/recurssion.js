


function findSum(n) {
    if (n === 0) {
        return 0;
    }
    return n + findSum(n - 1);
}

console.log(`function run here:`, findSum(3))