function walk(
  error: unknown,
): { code?: number; message?: string; name?: string }[] {
  const chain: { code?: number; message?: string; name?: string }[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === 'object';
    depth++
  ) {
    const candidate = current as {
      code?: number;
      message?: string;
      name?: string;
      cause?: unknown;
    };
    chain.push(candidate);
    current = candidate.cause;
  }
  return chain;
}

export function isDuplicateKey(error: unknown): boolean {
  return walk(error).some(
    (item) => item.code === 11000 || item.message?.includes('E11000') === true,
  );
}

export function isMongoUnavailable(error: unknown): boolean {
  return walk(error).some((item) =>
    [
      'MongoServerSelectionError',
      'MongoNetworkError',
      'MongoNotConnectedError',
    ].includes(item.name ?? ''),
  );
}
