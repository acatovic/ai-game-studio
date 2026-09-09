export const MAX_PROMPT_LENGTH = 20_000;

export function validatePrompt(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  if (value.length > MAX_PROMPT_LENGTH) {
    throw new Error(`${label} must be ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters or fewer (received ${value.length.toLocaleString("en-US")})`);
  }
  if (!allowEmpty && !value.trim()) throw new Error(`${label} is required`);
  return allowEmpty ? value : value.trim();
}
