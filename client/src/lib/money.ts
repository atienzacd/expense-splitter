/**
 * Money is whole centavos everywhere in the app (₱150.75 → 15075), exactly
 * like the server. Pesos only exist at the edges: what people type and see.
 */

/** The largest amount the server's 32-bit column can hold. */
export const MAX_CENTAVOS = 2_147_483_647;

const formatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

/** 15075 → "₱150.75" */
export function formatPesos(centavos: number): string {
  return formatter.format(centavos / 100);
}

/**
 * Reads a peso amount typed by a person ("150.75", "1,500", "₱20.5") into
 * centavos, without floating-point rounding. Returns null when it isn't a
 * positive amount with at most two decimal places.
 */
export function parsePesos(input: string): number | null {
  const cleaned = input.trim().replace(/^₱/, "").replaceAll(",", "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const centavos = whole * 100 + fraction;
  return centavos > 0 && centavos <= MAX_CENTAVOS ? centavos : null;
}

/** Same rule as the server: everyone gets an equal share and the first people listed absorb the leftover centavos. */
export function splitEvenly(total: number, people: number): number[] {
  if (people <= 0) return [];
  const base = Math.floor(total / people);
  const leftover = total % people;
  return Array.from({ length: people }, (_, i) => base + (i < leftover ? 1 : 0));
}
