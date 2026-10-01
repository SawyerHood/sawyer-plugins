import {
  definePluginApp,
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarHeaderProps,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import "./app.css";

const INSET_ATTRIBUTE = "data-nav-rail-inset";
const COLUMN_ATTRIBUTE = "data-nav-rail-column";
const TINT_TOP_PROPERTY = "--nav-rail-tint-top";
const TINT_WIDTH_PROPERTY = "--nav-rail-tint-width";
const SIDEBAR_TOGGLE_SELECTOR = '[data-sidebar="trigger"]';
const HEADER_LABEL_MIN_WIDTH = 120;
// Where bb's sidebar rows start inside the column beside the rail.
const ROW_INSET = 8;

let headerMounted = false;
const headerListeners = new Set<() => void>();

function subscribeHeader(listener: () => void) {
  headerListeners.add(listener);
  return () => {
    headerListeners.delete(listener);
  };
}

function setHeaderMounted(next: boolean) {
  headerMounted = next;
  for (const listener of headerListeners) listener();
}

let dockedRail: HTMLElement | null = null;
const dockListeners = new Set<() => void>();

function setDockedRail(next: HTMLElement | null) {
  dockedRail = next;
  for (const listener of dockListeners) listener();
}

/**
 * Pins the rail to the left edge of the sidebar column and insets the
 * navigation, thread list, and footer beside it. The rail starts under the
 * sidebar toggle when the toggle sits above it, and at the navigation region
 * otherwise. Returns false when the column cannot be found, so the rail stays
 * in flow.
 */
function useRailDock(railRef: RefObject<HTMLDivElement | null>) {
  const [isDocked, setDocked] = useState(false);
  useLayoutEffect(() => {
    const rail = railRef.current;
    const region = rail?.closest("nav") ?? null;
    const column = region?.parentElement ?? null;
    if (!rail || !region || !column) return;

    const inset = new Set<Element>();
    const undock = () => {
      for (const element of inset) element.removeAttribute(INSET_ATTRIBUTE);
      inset.clear();
      column.removeAttribute(COLUMN_ATTRIBUTE);
      column.style.removeProperty(TINT_TOP_PROPERTY);
      column.style.removeProperty(TINT_WIDTH_PROPERTY);
      setDockedRail(null);
    };
    const sync = () => {
      const block = rail.offsetParent;
      // bb hides this component while its customize editor is open.
      if (block === null) {
        undock();
        return;
      }
      for (const element of inset) {
        if (element.parentElement !== column) {
          element.removeAttribute(INSET_ATTRIBUTE);
          inset.delete(element);
        }
      }
      for (
        let element: Element | null = region;
        element !== null;
        element = element.nextElementSibling
      ) {
        if (inset.has(element)) continue;
        const { position } = getComputedStyle(element);
        if (position === "absolute" || position === "fixed") continue;
        element.setAttribute(INSET_ATTRIBUTE, "");
        inset.add(element);
      }
      const blockRect = block.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const columnStyle = getComputedStyle(column);
      const bottom = columnRect.bottom - parseFloat(columnStyle.paddingBottom);
      const left = columnRect.left + parseFloat(columnStyle.paddingLeft);
      const right = left + rail.offsetWidth;
      const regionTop = region.getBoundingClientRect().top;
      let top = regionTop;
      let tintTop = regionTop - columnRect.top;
      for (const toggle of Array.from(
        document.querySelectorAll(SIDEBAR_TOGGLE_SELECTOR),
      )) {
        const rect = toggle.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        if (rect.height === 0 || rect.bottom > regionTop) continue;
        if (center <= left || center >= right) continue;
        top = rect.bottom;
        tintTop = 0;
      }
      column.setAttribute(COLUMN_ATTRIBUTE, "");
      column.style.setProperty(TINT_TOP_PROPERTY, `${tintTop}px`);
      column.style.setProperty(
        TINT_WIDTH_PROPERTY,
        `${right - columnRect.left}px`,
      );
      rail.style.top = `${top - blockRect.top - block.clientTop}px`;
      rail.style.left = `${left - blockRect.left - block.clientLeft}px`;
      rail.style.height = `${Math.max(0, bottom - top)}px`;
      setDocked(true);
      setDockedRail(rail);
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(column);
    resizeObserver.observe(rail);
    for (
      let element = region.previousElementSibling;
      element !== null;
      element = element.previousElementSibling
    ) {
      resizeObserver.observe(element);
    }
    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(column, { childList: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      undock();
    };
  }, [railRef]);
  return isDocked;
}

function ItemContextMenu({
  item,
  children,
}: {
  item: ExperimentalSidebarNavigationItem;
  children: ReactNode;
}) {
  const { actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="nav-rail-menu">
          {split.isAvailable ? (
            <ContextMenu.Item
              className="nav-rail-menu-item"
              onSelect={() => actions.activate(item.id, { openInSplit: true })}
            >
              Open in split
            </ContextMenu.Item>
          ) : null}
          {item.pluginId ? (
            <ContextMenu.Item
              className="nav-rail-menu-item"
              onSelect={() => actions.openDetails(item.id)}
            >
              View details
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item
            className="nav-rail-menu-item"
            onSelect={() => actions.setVisible(item.id, false)}
          >
            Hide from sidebar
          </ContextMenu.Item>
          <ContextMenu.Separator className="nav-rail-menu-separator" />
          <ContextMenu.Item
            className="nav-rail-menu-item"
            onSelect={() => actions.openCustomize()}
          >
            Customize sidebar
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function NewThreadRow({
  item,
  showLabel = true,
}: {
  item: ExperimentalSidebarNavigationItem;
  showLabel?: boolean;
}) {
  const { actions, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const shortcut = showLabel && isShortcutModifierHeld ? item.shortcut : null;
  const title = item.shortcut
    ? `${item.label} (${item.shortcut.label})`
    : item.label;
  return (
    <ItemContextMenu item={item}>
      <button
        type="button"
        className="nav-rail-row"
        data-compact={showLabel ? undefined : ""}
        title={showLabel ? undefined : title}
        aria-label={showLabel && !item.shortcut ? undefined : title}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        disabled={item.isDisabled || item.isLoading}
        {...split.splitProps}
        onClick={(event) =>
          actions.activate(item.id, {
            openInSplit: event.metaKey || event.ctrlKey,
          })
        }
      >
        <NavigationIcon icon={item.icon} className="nav-rail-row-icon" />
        {showLabel ? (
          <span className="nav-rail-row-label">{item.label}</span>
        ) : null}
        {shortcut ? (
          <kbd aria-hidden="true" className="nav-rail-shortcut">
            {shortcut.label}
          </kbd>
        ) : null}
      </button>
    </ItemContextMenu>
  );
}

function RailButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const Accessory = item.experimental_Accessory;
  return (
    <ItemContextMenu item={item}>
      <button
        type="button"
        className="nav-rail-button"
        title={
          item.shortcut ? `${item.label} (${item.shortcut.label})` : item.label
        }
        aria-label={item.label}
        aria-current={item.id === activeItemId ? "page" : undefined}
        aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
        disabled={item.isDisabled || item.isLoading}
        {...split.splitProps}
        onClick={(event) =>
          actions.activate(item.id, {
            openInSplit: event.metaKey || event.ctrlKey,
          })
        }
      >
        <NavigationIcon icon={item.icon} className="nav-rail-icon" />
        {Accessory ? (
          <span className="nav-rail-badge">
            <Accessory />
          </span>
        ) : null}
      </button>
    </ItemContextMenu>
  );
}

function MoreMenu({
  hidden,
  side,
}: {
  hidden: readonly ExperimentalSidebarNavigationItem[];
  side: "right" | "bottom";
}) {
  const { actions } = experimental_useSidebarNavigation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="nav-rail-button"
          title="More"
          aria-label="More sidebar navigation"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="nav-rail-icon">
            <circle cx="3" cy="8" r="1.25" fill="currentColor" />
            <circle cx="8" cy="8" r="1.25" fill="currentColor" />
            <circle cx="13" cy="8" r="1.25" fill="currentColor" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="nav-rail-menu"
          side={side}
          align="start"
          sideOffset={4}
        >
          {hidden.length > 0 ? (
            <>
              <DropdownMenu.Label className="nav-rail-menu-label">
                Hidden
              </DropdownMenu.Label>
              {hidden.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  className="nav-rail-menu-item"
                  disabled={item.isDisabled || item.isLoading}
                  onSelect={() =>
                    actions.activate(item.id, { openInSplit: false })
                  }
                >
                  <NavigationIcon icon={item.icon} className="nav-rail-icon" />
                  {item.label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="nav-rail-menu-separator" />
            </>
          ) : null}
          <DropdownMenu.Item
            className="nav-rail-menu-item"
            onSelect={() => actions.openCustomize()}
          >
            Customize sidebar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function findNewThread(items: readonly ExperimentalSidebarNavigationItem[]) {
  return items.find(
    (item) => item.isVisible && item.action.kind === "new-thread",
  );
}

function RailHeader({ width }: ExperimentalSidebarHeaderProps) {
  const { items } = experimental_useSidebarNavigation();
  const headerRef = useRef<HTMLDivElement>(null);
  const newThread = findNewThread(items);
  const hasNewThread = newThread !== undefined;
  useLayoutEffect(() => {
    setHeaderMounted(true);
    return () => setHeaderMounted(false);
  }, []);
  // Starts the row where the rows under it start, whatever the header's inset.
  useLayoutEffect(() => {
    const align = () => {
      const header = headerRef.current;
      if (header === null) return;
      if (dockedRail === null) {
        header.style.marginLeft = "";
        return;
      }
      const margin = parseFloat(header.style.marginLeft) || 0;
      const start = header.getBoundingClientRect().left - margin;
      const target = dockedRail.getBoundingClientRect().right + ROW_INSET;
      header.style.marginLeft = `${Math.max(0, target - start)}px`;
    };
    align();
    dockListeners.add(align);
    return () => {
      dockListeners.delete(align);
    };
  }, [width, hasNewThread]);
  if (!newThread) return null;
  return (
    <div ref={headerRef} className="nav-rail-header">
      <NewThreadRow
        item={newThread}
        showLabel={width >= HEADER_LABEL_MIN_WIDTH}
      />
    </div>
  );
}

function RailNavigation(_props: ExperimentalSidebarNavigationProps) {
  const { items } = experimental_useSidebarNavigation();
  const railRef = useRef<HTMLDivElement>(null);
  const isDocked = useRailDock(railRef);
  const inHeader = useSyncExternalStore(
    subscribeHeader,
    () => headerMounted,
    () => false,
  );
  const newThread = inHeader ? undefined : findNewThread(items);
  const railItems = items.filter(
    (item) => item.isVisible && item.action.kind !== "new-thread",
  );
  const hidden = items.filter((item) => !item.isVisible);
  return (
    <>
      {newThread ? (
        <div className="nav-rail-primary">
          <NewThreadRow item={newThread} />
        </div>
      ) : null}
      <div
        ref={railRef}
        className="nav-rail"
        data-docked={isDocked ? "" : undefined}
      >
        {railItems.map((item) => (
          <RailButton key={item.id} item={item} />
        ))}
        <MoreMenu hidden={hidden} side={isDocked ? "right" : "bottom"} />
      </div>
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarHeader({
    id: "rail",
    title: "Nav Rail",
    description: "New thread beside the back and forward buttons.",
    component: RailHeader,
  });
  app.slots.experimental_sidebarNavigation({
    id: "rail",
    title: "Nav Rail",
    description:
      "Navigation icons in a rail on the left of the sidebar, under the sidebar toggle.",
    component: RailNavigation,
  });
});
