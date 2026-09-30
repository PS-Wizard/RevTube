/**
 * Statistics utilities for analytics algorithms.
 *
 * Pure-JS implementations (no external dependencies) of median,
 * winsorized z-scores, bootstrap confidence intervals, Kruskal-Wallis
 * test, and chi-square CDF.
 */

/**
 * Compute the median of an array of numbers.
 * Returns NaN for empty arrays.
 */
function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Z-scores clipped to ±clipLimit. Zero-variance input returns all zeros.
 */
function computeWinsorizedZScore(values, clipLimit = 3) {
  const n = values.length;
  if (n === 0) return [];

  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  if (std === 0 || !isFinite(std)) {
    return new Array(n).fill(0);
  }

  return values.map((v) => {
    const z = (v - mean) / std;
    return Math.max(-clipLimit, Math.min(clipLimit, z));
  });
}

/**
 * Bootstrap confidence interval for the mean.
 * Resamples `iterations` times with replacement, returns the
 * (alpha/2) and (1-alpha/2) percentiles.
 *
 * Returns { lower: null, upper: null } when n < 4 (too few for
 * meaningful bootstrap).
 */
function bootstrapMeanCI(values, iterations = 2000, alpha = 0.05) {
  const n = values.length;
  if (n < 4) return { lower: null, upper: null };

  const means = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += values[Math.floor(Math.random() * n)];
    }
    means[i] = sum / n;
  }

  // Sort and pick percentiles
  const sorted = Array.from(means).sort((a, b) => a - b);
  const lowerIdx = Math.floor(iterations * alpha / 2);
  const upperIdx = Math.ceil(iterations * (1 - alpha / 2)) - 1;

  return {
    lower: sorted[Math.max(0, lowerIdx)],
    upper: sorted[Math.min(sorted.length - 1, upperIdx)],
  };
}

/**
 * Kruskal-Wallis one-way analysis of variance by ranks (non-parametric).
 *
 * @param {Array<{ label: string, scores: number[] }>} groups
 * @returns {{ H: number, df: number, p: number }}
 *   H = test statistic, df = degrees of freedom, p = significance.
 *   p=1 when not enough data to run the test.
 */
function kruskalWallis(groups) {
  // Collect all values with group labels
  const all = [];
  groups.forEach((group, gi) => {
    (group.scores || []).forEach((score) => {
      all.push({ score, group: gi });
    });
  });

  if (all.length < 3) return { H: 0, df: groups.length - 1, p: 1.0 };

  // Rank all values (handling ties with average rank)
  all.sort((a, b) => a.score - b.score);
  let rank = 1;
  for (let i = 0; i < all.length; ) {
    let tieCount = 1;
    while (i + tieCount < all.length && all[i + tieCount].score === all[i].score) {
      tieCount++;
    }
    const avgRank = rank + (tieCount - 1) / 2;
    for (let j = 0; j < tieCount; j++) {
      all[i + j].rank = avgRank;
    }
    rank += tieCount;
    i += tieCount;
  }

  const N = all.length;
  const groupRankSums = new Array(groups.length).fill(0);
  const groupCounts = new Array(groups.length).fill(0);
  all.forEach((item) => {
    groupRankSums[item.group] += item.rank;
    groupCounts[item.group]++;
  });

  // H = (12 / (N*(N+1))) * sum(R_i^2 / n_i) - 3*(N+1)
  const sumTerm = groupRankSums.reduce(
    (sum, ri, i) => sum + (groupCounts[i] > 0 ? (ri * ri) / groupCounts[i] : 0),
    0,
  );
  const H = (12 / (N * (N + 1))) * sumTerm - 3 * (N + 1);

  // Tie correction factor
  // C = 1 - sum(t^3 - t) / (N^3 - N)  where t = number of tied values per rank
  // We compute tie counts from the sorted+ranked data
  let tieCorrection = 1;
  let t = 1;
  for (let i = 1; i < all.length; i++) {
    if (all[i].score === all[i - 1].score) {
      t++;
    } else {
      if (t > 1) {
        tieCorrection -= (t ** 3 - t) / (N ** 3 - N);
      }
      t = 1;
    }
  }
  if (t > 1) {
    tieCorrection -= (t ** 3 - t) / (N ** 3 - N);
  }

  const Hc = tieCorrection > 0 ? H / tieCorrection : H;
  const df = groups.length - 1;
  const p = chiSquareCDF(Hc, df);

  return { H: Hc, df, p: 1 - p };
}

/**
 * Chi-square cumulative distribution function.
 * P(χ² ≤ x) for df degrees of freedom.
 *
 * Uses the regularized lower incomplete gamma function via series
 * expansion (Abramowitz & Stegun 6.5.29).
 */
function chiSquareCDF(x, df) {
  if (x <= 0) return 0;
  const a = df / 2;
  const b = x / 2;
  return regularizedLowerIncompleteGamma(a, b);
}

/**
 * Regularized lower incomplete gamma function P(a, x) = γ(a, x) / Γ(a).
 *
 * Series representation (Abramowitz & Stegun 6.5.29):
 *   γ(a, x) = e^{-x} * x^a * sum_{n=0}^{∞} Γ(a) / Γ(a + n + 1) * x^n
 *
 * For our use case (chi-square with small df), the series converges
 * rapidly. For large a when x > a+1, we switch to the continued
 * fraction representation (Lentz's method) for better convergence.
 */
function regularizedLowerIncompleteGamma(a, x) {
  if (x === 0) return 0;

  // Use series expansion for small x or small a
  if (x < a + 1 || a <= 6) {
    return _gammaPSeries(a, x);
  }

  // Use continued fraction for x > a+1
  return 1 - _gammaQCF(a, x);
}

/**
 * Series expansion for γ(a, x) / Γ(a).
 * Converges quickly when x < a+1.
 */
function _gammaPSeries(a, x, maxIter = 200, tolerance = 1e-10) {
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= maxIter; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < tolerance * Math.abs(sum)) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/**
 * Continued fraction representation (Lentz's method) for
 * the upper incomplete gamma function Γ(a, x) / Γ(a) = Q(a, x).
 * Used when x > a+1 for better convergence.
 */
function _gammaQCF(a, x, maxIter = 200, tolerance = 1e-10) {
  // Lentz's continued fraction for the complementary incomplete gamma
  // function. See Numerical Recipes §6.2.
  const b = x + 1 - a;
  const c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < tolerance) break;
  }

  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/**
 * Natural log of the Gamma function (Lanczos approximation).
 * Accurate to ~2.2e-10.
 */
function logGamma(z) {
  if (z < 0.5) {
    // Reflection formula
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * z)) -
      logGamma(1 - z)
    );
  }

  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }

  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

module.exports = {
  computeMedian,
  computeWinsorizedZScore,
  bootstrapMeanCI,
  kruskalWallis,
  chiSquareCDF,
  logGamma,
};
