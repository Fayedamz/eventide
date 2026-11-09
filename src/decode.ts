import { xdr } from '@stellar/stellar-sdk';
export type Decoded = { raw: string | null; json: unknown | null; error: boolean };
export function decodeScVal(value: string | { xdr?: string } | undefined): Decoded {
  const raw = typeof value === 'string' ? value : (value?.xdr ?? null);
  if (!raw) return { raw, json: null, error: true };
  try {
    return { raw, json: xdr.ScVal.fromXdr(Buffer.from(raw, 'base64')).toJSON(), error: false };
  } catch {
    return { raw, json: null, error: true };
  }
}
export function decodeTopics(topics: string[] | undefined): {
  raw: string[];
  decoded: unknown[];
  eventName: string | null;
  error: boolean;
} {
  const raw = topics ?? [];
  const decoded: unknown[] = [];
  let error = false;
  for (const topic of raw) {
    const d = decodeScVal(topic);
    decoded.push(d.json);
    if (d.error) error = true;
  }
  const first = decoded[0] as { symbol?: string } | null;
  return {
    raw,
    decoded,
    eventName: typeof first?.symbol === 'string' ? first.symbol : null,
    error,
  };
}
