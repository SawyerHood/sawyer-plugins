import type {
  ProjectThreadItem,
} from "../../vendor/client-core/sidebar/projectThreadGroups.js";

export function getSidebarItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "section":
      return `section:${item.group.key}`;
  }
}
