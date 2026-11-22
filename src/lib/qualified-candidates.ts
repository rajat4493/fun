// Preserve ranking while replacing rejected candidates from the existing pool.
// Only verify as many candidates as still needed; a valid first pick costs no extra checks.
export async function selectQualifiedCandidates<T>(
  candidates: T[], count: number, verify: (candidate: T) => Promise<T | null>,
): Promise<T[]> {
  const accepted: T[] = [];
  let index = 0;
  while (index < candidates.length && accepted.length < count) {
    const next = candidates.slice(index, index + count - accepted.length);
    index += next.length;
    const checked = await Promise.all(next.map(candidate => verify(candidate)));
    for (const candidate of checked) if (candidate !== null) accepted.push(candidate);
  }
  return accepted;
}
