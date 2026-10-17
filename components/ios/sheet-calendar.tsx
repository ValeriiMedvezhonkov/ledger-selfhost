"use client";

import type { ComponentProps } from "react";
import { getDefaultClassNames } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

/**
 * The calendar as a sheet shows it: edge to edge across the sheet's content
 * width, like the full-width button under it, rather than the shadcn
 * default's content-sized grid centred in the middle. The seven columns
 * share the width; rows stay at the 44pt touch height so a stretched grid
 * does not make the sheet taller.
 */
export function SheetCalendar({
  className,
  classNames,
  ...props
}: ComponentProps<typeof Calendar>) {
  const defaults = getDefaultClassNames();
  return (
    <Calendar
      weekStartsOn={1}
      {...props}
      className={cn("w-full bg-transparent p-0 [--cell-size:--spacing(11)]", className)}
      classNames={{
        root: cn("w-full", defaults.root),
        day: cn(
          "group/day relative h-(--cell-size) w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius) [&>button]:aspect-auto [&>button]:h-full",
          defaults.day,
        ),
        ...classNames,
      }}
    />
  );
}
