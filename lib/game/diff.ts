/** Minimal line-based unified diff (LCS) for showing an intervention's change. */
export function unifiedDiff(a: string, b: string, opts: { context?: number; fromLabel?: string; toLabel?: string } = {}): string {
  const context = opts.context ?? 3;
  const A = a.split('\n');
  const B = b.split('\n');
  // Trim common prefix/suffix to keep the LCS table small.
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  const n = a2.length, m = b2.length;
  if (n * m > 4_000_000) return `--- ${opts.fromLabel ?? 'a'}\n+++ ${opts.toLabel ?? 'b'}\n@@ diff too large to display @@\n`;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  type Op = { t: ' ' | '-' | '+'; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  for (let k = 0; k < pre; k++) ops.push({ t: ' ', line: A[k], ai: k, bi: k });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a2[i] === b2[j]) { ops.push({ t: ' ', line: a2[i], ai: pre + i, bi: pre + j }); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: '+', line: b2[j], ai: pre + i, bi: pre + j }); j++; }
    else { ops.push({ t: '-', line: a2[i], ai: pre + i, bi: pre + j }); i++; }
  }
  for (let k = 0; k < suf; k++) ops.push({ t: ' ', line: A[A.length - suf + k], ai: A.length - suf + k, bi: B.length - suf + k });

  const out: string[] = [`--- ${opts.fromLabel ?? 'a'}`, `+++ ${opts.toLabel ?? 'b'}`];
  let k = 0;
  while (k < ops.length) {
    while (k < ops.length && ops[k].t === ' ') k++;
    if (k >= ops.length) break;
    let start = Math.max(0, k - context);
    let end = k;
    // Extend hunk while changes are within 2*context of each other.
    while (end < ops.length) {
      if (ops[end].t !== ' ') { end++; continue; }
      let look = end;
      while (look < ops.length && ops[look].t === ' ' && look - end < context * 2) look++;
      if (look < ops.length && ops[look].t !== ' ' && look - end < context * 2) { end = look; continue; }
      end = Math.min(ops.length, end + context);
      break;
    }
    const hunk = ops.slice(start, end);
    const aStart = hunk[0].ai + 1, bStart = hunk[0].bi + 1;
    const aLen = hunk.filter((o) => o.t !== '+').length, bLen = hunk.filter((o) => o.t !== '-').length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk) out.push(`${o.t}${o.line}`);
    k = end;
  }
  return out.join('\n') + '\n';
}
