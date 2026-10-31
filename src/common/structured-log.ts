export function structuredLog(
  fields: Record<string, string | number | boolean | null>,
): string {
  return JSON.stringify(fields);
}
