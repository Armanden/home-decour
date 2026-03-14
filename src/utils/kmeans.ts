// Very small k-means for RGB pixel arrays.
// pixels: number[][] where each item is [r,g,b] (0..255)
// returns cluster centroids as integer RGB arrays
export function extractDominantColors(pixels: number[][], k = 3, iter = 12) {
  if (pixels.length === 0) return [];
  // init centroids randomly
  const centroids: number[][] = [];
  const used = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * pixels.length);
    if (used.has(idx)) continue;
    used.add(idx);
    centroids.push(pixels[idx].slice());
  }
  const assignments = new Array(pixels.length).fill(0);
  for (let it = 0; it < iter; it++) {
    // assign
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      const p = pixels[i];
      for (let c = 0; c < centroids.length; c++) {
        const q = centroids[c];
        const d =
          (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assignments[i] = best;
    }
    // recompute centroids
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < pixels.length; i++) {
      const c = assignments[i];
      sums[c][0] += pixels[i][0];
      sums[c][1] += pixels[i][1];
      sums[c][2] += pixels[i][2];
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // reinitialize
        centroids[c] = pixels[Math.floor(Math.random() * pixels.length)].slice();
      } else {
        centroids[c] = [
          Math.round(sums[c][0] / counts[c]),
          Math.round(sums[c][1] / counts[c]),
          Math.round(sums[c][2] / counts[c]),
        ];
      }
    }
  }
  // sort by brightness descending
  centroids.sort((a, b) => {
    const la = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    const lb = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2];
    return lb - la;
  });
  return centroids;
}