// WCAG relative luminance and source-over alpha, for local QA only.
export function rgba(value) {
  const m = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(
    value,
  );
  if (!m) throw Error('Unsupported computed color');
  const a = m.slice(1, 4).map(Number),
    alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (
    a.some((n) => !Number.isFinite(n) || n < 0 || n > 255) ||
    !Number.isFinite(alpha) ||
    alpha < 0 ||
    alpha > 1
  )
    throw Error('Invalid color');
  return [...a, alpha];
}
export function over(f, b) {
  const a = f[3] + b[3] * (1 - f[3]);
  return a
    ? [...f.slice(0, 3).map((n, i) => (n * f[3] + b[i] * b[3] * (1 - f[3])) / a), a]
    : [0, 0, 0, 0];
}
export function contrast(f, b) {
  const lum = (c) =>
      c
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0),
    x = lum(f),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
