type MergeResult =
  | { kind: "merged"; text: string }
  | { kind: "conflict"; text: string };

export function threeWayMerge(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { kind: "merged", text: local };
  if (local === base) return { kind: "merged", text: remote };
  if (remote === base) return { kind: "merged", text: local };

  // fallback conservador: marca conflito inteiro (MVP)
  const text =
`<<<<<<< LOCAL
${local}
=======
${remote}
>>>>>>> REMOTE`;

  return { kind: "conflict", text };
}
