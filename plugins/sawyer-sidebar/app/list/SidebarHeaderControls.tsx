import { createContext, useContext, useState, type ReactNode } from "react";
import type {
  SidebarSectionId,
} from "../../vendor/client-core/sidebar/sidebarSectionId.js";
import { Button } from "../../vendor/shared-ui/components/ui/button.js";
import { Icon } from "../../vendor/shared-ui/components/ui/icon.js";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "../../vendor/shared-ui/components/ui/coarse-pointer-sizing.js";
import {
  useIsCompactViewport,
} from "../../vendor/shared-ui/components/ui/hooks/use-compact-viewport.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../vendor/shared-ui/components/ui/dropdown-menu.js";
import {
  SidebarControlButton,
  SidebarRowControls,
} from "../rows/SidebarRowControls.js";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { ThreadListVisibilityMenuItems } from "./ThreadListVisibility.js";
import { SidebarHeaderMenuContents } from "./SidebarViewItems.js";

export interface HeaderCreationActions {
  onNewSection?: (anchorSectionId?: SidebarSectionId) => void;
  isCreatingSection?: boolean;
}

const HeaderCreationContext = createContext<HeaderCreationActions>({});
export const SidebarHeaderActionsProvider = HeaderCreationContext.Provider;

export function SidebarHeaderControls({
  label,
  sectionId,
  onNewThread,
  showNewThread = true,
  children,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  label: string;
  sectionId?: SidebarSectionId;
  onNewThread?: () => void;
  showNewThread?: boolean;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const creation = useContext(HeaderCreationContext);
  const compact = useIsCompactViewport();
  const [page, setPage] = useState<"organize" | "sort" | "filter" | null>(null);
  const changeOpen = (next: boolean) => {
    if (!next) setPage(null);
    onOpenChange?.(next);
  };
  return (
    <SidebarRowControls
      primaryAction={
        showNewThread ? (
          <SidebarControlButton
            label={`New thread in ${label}`}
            icon="MessageSquarePlus"
            onClick={() => onNewThread?.()}
            disabled={!onNewThread}
          />
        ) : null
      }
    >
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label} actions`}
            data-sidebar-rename-anchor=""
            className={SIDEBAR_CONTROL_BUTTON_CLASS}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={onCloseAutoFocus}
          mobileTitle={
            page === "organize"
              ? "Organize"
              : page === "sort"
                ? "Sort by"
                : page === "filter"
                  ? "Filter"
                  : `${label} actions`
          }
        >
          <SidebarHeaderMenuContents
            creation={creation}
            anchorSectionId={sectionId}
            compact={compact}
            page={page}
            onPageChange={setPage}
          >
            {children}
          </SidebarHeaderMenuContents>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowControls>
  );
}

export function SidebarSectionMenuItems({
  onRename,
  onRemove,
}: {
  onRename?: () => void;
  onRemove?: () => void;
}) {
  return (
    <>
      {onRename && (
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="Edit" />
          Rename
        </DropdownMenuItem>
      )}
      <ThreadListVisibilityMenuItems />
      {onRemove && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Icon name="Trash2" />
            Remove
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
