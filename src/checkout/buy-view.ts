// PRD-4 item 17: what the Buy screen shows about the last command's result, worked out from the CommandLog row
// and the read model. Display only: nothing here casts, decides or changes a rule.

type Result = { kind: string; status: string; code: string; payload: unknown };

const field = (payload: unknown, key: string): unknown =>
  payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;

/**
 * True when an accepted HOLD or PAY_START result names a hold that has since moved to another state: "Payment
 * started" once the order exists (UX-11, DES-11), "Held for you" once the hold expired. Such a banner is left off.
 */
export function movedOn(result: Result, holds: { hold: string; state: string }[]): boolean {
  if (result.status !== 'OK' || (result.kind !== 'HOLD' && result.kind !== 'PAY_START')) return false;
  const ref = field(result.payload, 'ref');
  const h = typeof ref === 'string' ? holds.find((x) => x.hold === ref) : undefined;
  return h !== undefined && h.state !== result.code;
}
