import type { CSSProperties } from "react";
import type { SymbolName } from "@/lib/symbols";
import { cn } from "@/lib/utils";

export interface SymbolProps {
  readonly name: SymbolName;
  /** Glyph size in px; the boards draw 18–30. */
  readonly size?: number;
  /** Filled variant — SF Symbols' `.fill`, used for the selected tab. */
  readonly filled?: boolean;
  readonly weight?: 400 | 500 | 600 | 700;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * One glyph from the self-hosted Material Symbols Rounded subset — the face
 * the iOS27 boards are drawn in, standing in for SF Symbols. Decorative by
 * default: every control that carries one also carries a text label or an
 * aria-label, so screen readers never hear the ligature name.
 */
export function Symbol({
  name,
  size = 22,
  filled = false,
  weight = 500,
  className,
  style,
}: SymbolProps) {
  return (
    <span
      aria-hidden
      className={cn("sym", filled && "sym-fill", className)}
      style={{ fontSize: size, fontWeight: weight, width: size, height: size, ...style }}
    >
      {name}
    </span>
  );
}
