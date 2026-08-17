export function calculateInternalUps(rapcForSingleBox: unknown) {
  const rapcValue = Number(rapcForSingleBox);
  if (!Number.isFinite(rapcValue) || rapcValue <= 0) return undefined;
  return Math.floor(1320 / rapcValue);
}

