export type DiffOp = "equal" | "add" | "del";

export type DiffChunk = {
  op: DiffOp;
  lines: string[];
};

function lcsTable(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

export function diffLines(oldText: string, newText: string): DiffChunk[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const dp = lcsTable(a, b);

  const chunks: DiffChunk[] = [];
  let i = 0;
  let j = 0;

  const push = (op: DiffOp, line: string) => {
    const last = chunks[chunks.length - 1];
    if (last && last.op === op) last.lines.push(line);
    else chunks.push({ op, lines: [line] });
  };

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++; j++;
      continue;
    }
    // caminha na tabela LCS
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }

  while (i < a.length) { push("del", a[i]); i++; }
  while (j < b.length) { push("add", b[j]); j++; }

  return chunks;
}
