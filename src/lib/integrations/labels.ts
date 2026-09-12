export function labelsInclude(labels: string[], required: string): boolean {
  if (!required.trim()) return true;
  const want = required.trim().toLowerCase();
  return labels.some((l) => l.toLowerCase() === want);
}
