"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

/** Shared so the mobile trigger is pixel-identical to the Radix one. */
const TRIGGER_CLASS =
  "hover:bg-accent/50 flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/**
 * A dropdown is a desktop shape. On a phone the panel opens over the field it
 * belongs to, its rows are mouse-sized, and it sits wherever there happens to
 * be room. Below md the same options are a bottom sheet instead: thumb-height
 * rows, in reach, covering nothing you were reading.
 *
 * Swapped inside the primitive rather than at the call sites so that every
 * Select in the app gets it without eight near-identical edits, and so nobody
 * has to remember which variant to reach for.
 */
function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const isMobile = useIsMobile()

  if (isMobile) return <MobileSelect {...props} />

  return <SelectPrimitive.Root data-slot="select" {...props} />
}

interface MobileOption {
  readonly value: string
  readonly label: React.ReactNode
  readonly disabled: boolean
}

/**
 * Reads the options straight out of the JSX the caller already wrote.
 *
 * The compound API puts the options inside <SelectContent> as elements, so on
 * mobile they have to be read back out rather than re-declared. Recursive
 * because call sites wrap them in fragments, maps and conditionals; matched on
 * component identity rather than a marker prop, which cannot be faked by a
 * caller passing a lookalike.
 */
function collectOptions(node: React.ReactNode, out: MobileOption[]): void {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return

    if (child.type === SelectItem) {
      const props = child.props as React.ComponentProps<typeof SelectItem>
      if (typeof props.value === "string") {
        out.push({
          value: props.value,
          label: props.children,
          disabled: props.disabled === true,
        })
      }
      return
    }

    const props = child.props as { children?: React.ReactNode }
    if (props.children !== undefined) collectOptions(props.children, out)
  })
}

function findPart(
  node: React.ReactNode,
  part: React.ElementType,
): React.ReactElement | null {
  let found: React.ReactElement | null = null
  React.Children.forEach(node, (child) => {
    if (found !== null || !React.isValidElement(child)) return
    if (child.type === part) {
      found = child
      return
    }
    const props = child.props as { children?: React.ReactNode }
    if (props.children !== undefined) found = findPart(props.children, part)
  })
  return found
}

function MobileSelect(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const { value, defaultValue, disabled, children } = props
  const t = useTranslations("common")
  const [open, setOpen] = React.useState(false)
  const [ownValue, setOwnValue] = React.useState(defaultValue)

  // Controlled and uncontrolled both work, as with the Radix root.
  const current = value ?? ownValue

  const trigger = findPart(children, SelectTrigger)
  const content = findPart(children, SelectContent)

  const options: MobileOption[] = []
  if (content !== null) {
    collectOptions((content.props as { children?: React.ReactNode }).children, options)
  }

  const {
    className: triggerClass,
    size = "default",
    children: triggerChildren,
    ...triggerRest
  } = (trigger?.props ?? {}) as React.ComponentProps<typeof SelectTrigger>

  const valuePart = findPart(triggerChildren, SelectValue)
  const placeholder = (valuePart?.props as { placeholder?: React.ReactNode } | undefined)
    ?.placeholder

  /*
   * The sheet needs a heading where the popper needed none — it is a panel in
   * its own right rather than something visibly hanging off the field. The
   * control's own accessible name is the honest answer; the placeholder is the
   * next best, and only then a generic fallback.
   */
  const heading =
    (triggerRest as { "aria-label"?: string })["aria-label"] ??
    placeholder ??
    t("choose")

  const selected = options.find((option) => option.value === current)

  function choose(next: string): void {
    setOwnValue(next)
    /*
     * Called through `props` rather than destructured: Radix declares
     * onValueChange with a method signature, and pulling it off the object
     * first reads to unbound-method as tearing a method from its receiver.
     */
    props.onValueChange?.(next)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        data-slot="select-trigger"
        data-size={size}
        // Drives the same muted-text rule the Radix trigger uses.
        data-placeholder={selected === undefined ? "" : undefined}
        disabled={disabled}
        onClick={() => { setOpen(true) }}
        className={cn(TRIGGER_CLASS, "min-h-11", triggerClass)}
        {...triggerRest}
      >
        <span data-slot="select-value">
          {selected?.label ?? placeholder}
        </span>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </button>

      <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
        <DrawerContent className="max-h-[80dvh]">
          <DrawerHeader className="shrink-0 text-left">
            <DrawerTitle>{heading}</DrawerTitle>
          </DrawerHeader>
          {/* listbox/option rather than ul/li: aria-selected is what marks the
              current choice, and it is only meaningful on a real option.
              Tiles rather than rows: a handful of options reads as a set of
              equal choices, and a 2-up grid puts them all on screen at once. */}
          <div
            role="listbox"
            className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            {options.map((option) => {
              const active = option.value === current
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  disabled={option.disabled}
                  aria-selected={active}
                  onClick={() => { choose(option.value) }}
                  className={cn(
                    "flex min-h-14 items-center justify-center gap-2 rounded-xl px-3 text-center text-sm font-medium transition-colors disabled:opacity-50",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary hover:bg-accent",
                  )}
                >
                  <span className="flex min-w-0 items-center justify-center gap-2">
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(TRIGGER_CLASS, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  // Defaults changed from the shadcn output: "item-aligned" places the selected
  // option on top of the trigger and sizes the panel to its content, so the
  // list covers the field it belongs to and juts sideways. "popper" + "start"
  // opens it below the trigger, left edges aligned, at least trigger width.
  position = "popper",
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        sideOffset={sideOffset}
        className={cn("relative z-50 max-h-(--radix-select-content-available-height) min-w-36 max-w-[calc(100vw-1.5rem)] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", position ==="popper"&&"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1", className )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            position === "popper" && ""
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
