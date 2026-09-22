import {
  definePluginApp,
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarHeaderProps,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useSyncExternalStore } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import "./app.css";

const GAP = 4;

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

function IconButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const Accessory = item.experimental_Accessory;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          className="compact-nav-button"
          title={item.shortcut ? `${item.label} (${item.shortcut.label})` : item.label}
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
          <NavigationIcon icon={item.icon} className="compact-nav-icon" />
          {Accessory ? (
            <span className="compact-nav-badge">
              <Accessory />
            </span>
          ) : null}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="compact-nav-menu">
          {split.isAvailable ? (
            <ContextMenu.Item
              className="compact-nav-menu-item"
              onSelect={() => actions.activate(item.id, { openInSplit: true })}
            >
              Open in split
            </ContextMenu.Item>
          ) : null}
          {item.pluginId ? (
            <ContextMenu.Item
              className="compact-nav-menu-item"
              onSelect={() => actions.openDetails(item.id)}
            >
              View details
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item
            className="compact-nav-menu-item"
            onSelect={() => actions.setVisible(item.id, false)}
          >
            Hide from sidebar
          </ContextMenu.Item>
          <ContextMenu.Separator className="compact-nav-menu-separator" />
          <ContextMenu.Item
            className="compact-nav-menu-item"
            onSelect={() => actions.openCustomize()}
          >
            Customize sidebar
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MoreMenu({
  overflow,
  hidden,
}: {
  overflow: readonly ExperimentalSidebarNavigationItem[];
  hidden: readonly ExperimentalSidebarNavigationItem[];
}) {
  const { actions } = experimental_useSidebarNavigation();
  const entry = (item: ExperimentalSidebarNavigationItem) => (
    <DropdownMenu.Item
      key={item.id}
      className="compact-nav-menu-item"
      disabled={item.isDisabled || item.isLoading}
      onSelect={() => actions.activate(item.id, { openInSplit: false })}
    >
      <NavigationIcon icon={item.icon} className="compact-nav-icon" />
      {item.label}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="compact-nav-button"
          title="More"
          aria-label="More sidebar navigation"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="compact-nav-icon">
            <circle cx="3" cy="8" r="1.25" fill="currentColor" />
            <circle cx="8" cy="8" r="1.25" fill="currentColor" />
            <circle cx="13" cy="8" r="1.25" fill="currentColor" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="compact-nav-menu" align="start">
          {overflow.map(entry)}
          {hidden.length > 0 ? (
            <>
              {overflow.length > 0 ? (
                <DropdownMenu.Separator className="compact-nav-menu-separator" />
              ) : null}
              <DropdownMenu.Label className="compact-nav-menu-label">
                Hidden
              </DropdownMenu.Label>
              {hidden.map(entry)}
            </>
          ) : null}
          <DropdownMenu.Separator className="compact-nav-menu-separator" />
          <DropdownMenu.Item
            className="compact-nav-menu-item"
            onSelect={() => actions.openCustomize()}
          >
            Customize sidebar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function IconRow({
  capacity,
  singleLine = false,
}: {
  capacity: number;
  singleLine?: boolean;
}) {
  const { items } = experimental_useSidebarNavigation();
  const visible = items.filter((item) => item.isVisible);
  const hidden = items.filter((item) => !item.isVisible);
  const needsMore = hidden.length > 0 || visible.length > capacity;
  const shown = needsMore
    ? visible.slice(0, Math.max(0, capacity - 1))
    : visible;
  return (
    <div className={singleLine ? "compact-nav-row compact-nav-row-single" : "compact-nav-row"}>
      {shown.map((item) => (
        <IconButton key={item.id} item={item} />
      ))}
      {needsMore ? (
        <MoreMenu overflow={visible.slice(shown.length)} hidden={hidden} />
      ) : null}
    </div>
  );
}

function CompactHeader({ width, controlSize }: ExperimentalSidebarHeaderProps) {
  useLayoutEffect(() => {
    setHeaderMounted(true);
    return () => setHeaderMounted(false);
  }, []);
  return (
    <IconRow
      capacity={Math.floor((width + GAP) / (controlSize + GAP))}
      singleLine
    />
  );
}

function CompactNavigation(_props: ExperimentalSidebarNavigationProps) {
  const inHeader = useSyncExternalStore(
    subscribeHeader,
    () => headerMounted,
    () => false,
  );
  if (inHeader) return null;
  return (
    <div className="compact-nav-region">
      <IconRow capacity={Number.POSITIVE_INFINITY} />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarHeader({
    id: "icons",
    title: "Compact Nav",
    description: "Navigation icons beside the sidebar toggle.",
    component: CompactHeader,
  });
  app.slots.experimental_sidebarNavigation({
    id: "icons",
    title: "Compact Nav",
    description: "Compact icons with bb's saved order, visibility, and customization.",
    component: CompactNavigation,
  });
});
