/**
 * Typographic minus, as the boards set amounts («−52,10 €»). Intl renders a
 * hyphen-minus, which sits too low and too short beside tabular figures.
 */
export function minus(value: string): string {
  return value.replace("-", "−");
}
