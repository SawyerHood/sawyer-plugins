import * as Popover from "@radix-ui/react-popover";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Icon } from "./Icon";
import { cn } from "../lib/utils";
import { usePortalScopeProps } from "../lib/portal-scope";
import { searchProjects } from "../inbox";

/** Sentinel for "All projects" inside the option list; never a real project id. */
const ALL_PROJECTS = "__all__";

/**
 * The sidebar's project scope picker, with a search field of its own.
 *
 * The host already owns a search box for threads, so this one only appears
 * while the picker is open and only filters project names. Radix Select has no
 * search, so the picker is a Popover holding a proper combobox listbox: focus
 * stays in the input and the active option is announced via
 * `aria-activedescendant`.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: readonly { readonly id: string; readonly name: string }[];
  /** Chosen project id, or null for "All projects". */
  value: string | null;
  onChange: (projectId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(value ?? ALL_PROJECTS);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const listId = useId();
  const portalScopeProps = usePortalScopeProps();

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const options = useMemo(() => {
    const matches = searchProjects(projects, query);
    return [
      { id: ALL_PROJECTS, name: "All projects" },
      ...matches.map((project) => ({ id: project.id, name: project.name })),
    ];
  }, [projects, query]);

  const selectedId = value ?? ALL_PROJECTS;
  const activeIndex = options.findIndex((option) => option.id === activeId);
  const selectedName =
    value === null
      ? "All projects"
      : (projectNameById.get(value) ?? "All projects");

  // A filter can remove the option the cursor was on; fall back to the top.
  useEffect(() => {
    if (!options.some((option) => option.id === activeId)) {
      setActiveId(options[0]?.id ?? ALL_PROJECTS);
    }
  }, [activeId, options]);

  // Keep the active option visible when the arrow keys walk past the fold.
  useEffect(() => {
    if (!open) return;
    optionRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    setQuery("");
    if (next) setActiveId(selectedId);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    // Typing moves the cursor to the first real match, so Enter selects a
    // project rather than the always-present "All projects" row.
    setActiveId(searchProjects(projects, next)[0]?.id ?? ALL_PROJECTS);
  }

  function choose(optionId: string) {
    onChange(optionId === ALL_PROJECTS ? null : optionId);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length === 0) return;
      const next = activeIndex < 0 ? 0 : (activeIndex + 1) % options.length;
      setActiveId(options[next]!.id);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const next = activeIndex <= 0 ? options.length - 1 : activeIndex - 1;
      setActiveId(options[next]!.id);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveId(options[0]?.id ?? ALL_PROJECTS);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveId(options[options.length - 1]?.id ?? ALL_PROJECTS);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.id);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Project scope: ${selectedName}`}
          className="flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none transition-colors duration-150 hover:duration-0 hover:bg-sidebar-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="truncate">{selectedName}</span>
          <Icon name="ChevronDown" className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...portalScopeProps}
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => {
            // The search field is the point of opening; do not land on the
            // popover shell first.
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 max-h-96 w-[var(--radix-popover-trigger-width)] min-w-48 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <div className="flex items-center gap-1.5 border-b border-sidebar-border px-2">
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label="Search projects"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex < 0
                  ? undefined
                  : `${listId}-option-${options[activeIndex]!.id}`
              }
              autoComplete="off"
              spellCheck={false}
              placeholder="Search projects"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <div
            role="listbox"
            id={listId}
            aria-label="Projects"
            className="max-h-72 overflow-y-auto p-1"
          >
            {options.map((option) => (
              <div
                key={option.id}
                id={`${listId}-option-${option.id}`}
                ref={(element) => {
                  if (element) optionRefs.current.set(option.id, element);
                  else optionRefs.current.delete(option.id);
                }}
                role="option"
                aria-selected={option.id === selectedId}
                data-active={option.id === activeId ? "" : undefined}
                title={option.name}
                onMouseMove={() => setActiveId(option.id)}
                onClick={() => choose(option.id)}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-xs outline-none",
                  option.id === activeId && "bg-state-hover text-foreground",
                )}
              >
                <span className="truncate">{option.name}</span>
                {option.id === selectedId ? (
                  <span className="absolute right-2 flex size-3.5 items-center justify-center">
                    <Icon name="Check" className="size-4" />
                  </span>
                ) : null}
              </div>
            ))}
            {query.trim().length > 0 && options.length === 1 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No projects found
              </p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
