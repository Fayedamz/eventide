export function redact(value: unknown): string {
  const s =
    value instanceof Error
      ? `${value.name}: ${value.message}\n${value.stack ?? ''}`
      : String(value);
  return s
    .replace(
      /(https?:\/\/[^\s/?#]+)([^\s]*)/gi,
      (_m, h: string, t: string) =>
        h + t.replace(/([?&](?:api[_-]?key|token|key|secret|auth)=)[^&\s]*/gi, '$1[REDACTED]'),
    )
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key|token|secret)=[^\s&]+/gi, '$1=[REDACTED]');
}
