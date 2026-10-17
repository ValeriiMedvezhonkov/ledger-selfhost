"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

/**
 * Below md the panel is a bottom sheet rather than a popper.
 *
 * A popover is anchored to its trigger, which on a phone means a fixed-width
 * panel pinned next to a control that is often near an edge — so it either
 * overflows the viewport or is nudged somewhere with no visible relationship
 * to what opened it. The date pickers are the ones that matter here: a
 * calendar is wider than most phones have room for beside anything.
 */
function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const isMobile = useIsMobile()

  if (isMobile) return <MobilePopover {...props} />

  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function MobilePopover(
  props: React.ComponentProps<typeof PopoverPrimitive.Root>,
) {
  const { open, defaultOpen, children, ...rest } = props
  const [ownOpen, setOwnOpen] = React.useState(defaultOpen ?? false)

  const isOpen = open ?? ownOpen

  function setOpen(next: boolean): void {
    setOwnOpen(next)
    // Through props for the same unbound-method reason as MobileSelect.
    props.onOpenChange?.(next)
  }

  const trigger = findChild(children, PopoverTrigger)
  const content = findChild(children, PopoverContent)

  const triggerProps = (trigger?.props ?? {}) as {
    children?: React.ReactNode
    asChild?: boolean
  }

  /*
   * asChild means the caller supplied the real control — a Button, usually —
   * so it is cloned with an onClick rather than wrapped, which would leave two
   * nested buttons and the caller's styling on the wrong one.
   */
  const inner = triggerProps.children
  const triggerNode =
    triggerProps.asChild === true && React.isValidElement(inner)
      ? React.cloneElement(inner as React.ReactElement<{ onClick?: () => void }>, {
          onClick: () => { setOpen(true) },
        })
      : (
          <button type="button" onClick={() => { setOpen(true) }} {...rest}>
            {inner}
          </button>
        )

  const contentProps = (content?.props ?? {}) as {
    children?: React.ReactNode
    "aria-label"?: string
  }

  return (
    <>
      {triggerNode}
      <Drawer open={isOpen} onOpenChange={setOpen} repositionInputs={false}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{contentProps["aria-label"] ?? ""}</DrawerTitle>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {contentProps.children}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function findChild(
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
    if (props.children !== undefined) found = findChild(props.children, part)
  })
  return found
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
