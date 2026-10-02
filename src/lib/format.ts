// Fixed to en-US regardless of the viewer's locale — every amount
// elsewhere in this app (the textarea, the recipient inputs, the raw CSV
// format) is period-decimal, so a locale like tr-TR rendering this as
// "23,7" would silently disagree with everything else on the page.
export function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 7 });
}

export function sumAmounts(rows: { amount: string }[]): number {
  return rows.reduce((sum, r) => {
    const n = Number(r.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}
