// A status as a glyph and a word, so colour is never the only signal (docs/DESIGN_SYSTEM.md). The glyph is CSS.
export type PillKind = 'good' | 'risk' | 'hold' | 'info' | 'done';

export function Pill({ k, children }: { k: PillKind; children: React.ReactNode }) {
  return <span className="pill" data-k={k}>{children}</span>;
}
