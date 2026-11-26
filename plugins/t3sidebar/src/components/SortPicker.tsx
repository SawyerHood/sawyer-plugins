import * as Popover from "@radix-ui/react-popover";
import { useId, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { usePortalScopeProps } from "../lib/portal-scope";
import {
  DEFAULT_SORT_MODE,
  SORT_GROUPS,
  SORT_LABELS,
  type SortMode,
} from "../sort";
import { Icon } from "./Icon";

/**
 * The inbox's sort control: one icon button opening a radiogroup of modes.
 *
 * "Newest first" is the default, so the list keeps its original static order
 * until the user asks for something else. Modes that read live fields re-order
 * as threads change; the label says what the current mode is.
 */
export function SortPicker({
  mode,
  onChange,
}: {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupName = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const portalScopeProps = usePortalScopeProps();

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-label={`Sort threads: ${SORT_LABELS[mode]}`}
          title={`Sort threads: ${SORT_LABELS[mode]}`}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            mode !== DEFAULT_SORT_MODE && "bg-sidebar-accent/60 text-foreground",
          )}
        >
          <Icon name="ArrowUpDown" className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...portalScopeProps}
          align="end"
          sideOffset={4}
          aria-label="Sort threads"
          className="z-50 min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onOpenAutoFocus={(event) => {
            // Land on the current choice, not the popover shell.
            event.preventDefault();
            contentRef.current
              ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
              ?.focus();
          }}
        >
          <div ref={contentRef} role="radiogroup" aria-label="Sort by">
            {SORT_GROUPS.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="px-2 pb-0.5 pt-1.5 text-2xs font-medium text-muted-foreground/70">
                  {group.label}
                </p>
                {group.modes.map((value) => (
                  <label
                    key={value}
                    className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-xs outline-none hover:bg-state-hover"
                  >
                    <input
                      type="radio"
                      name={groupName}
                      value={value}
                      checked={mode === value}
                      className="peer sr-only"
                      onChange={() => {
                        onChange(value);
                        setOpen(false);
                      }}
                    />
                    <span className="truncate peer-checked:text-foreground">
                      {SORT_LABELS[value]}
                    </span>
                    <span className="absolute right-2 flex size-3.5 items-center justify-center opacity-0 peer-checked:opacity-100">
                      <Icon name="Check" className="size-4" aria-hidden />
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
