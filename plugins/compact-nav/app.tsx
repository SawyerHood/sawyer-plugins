import { definePluginApp, type ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk/app";
import "./app.css";

function IconNavigation({ experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  return <div className="compact-icon-navigation"><Original /></div>;
}

export default definePluginApp(app => {
  app.contentScripts.register({
    id: "icon-labels",
    mount() {
      const owned = new Map<HTMLElement, string>();
      const labelButtons = () => {
        for (const [button, title] of owned) {
          if (!button.isConnected) { if (button.title === title) button.removeAttribute("title"); owned.delete(button); }
        }
        document.querySelectorAll<HTMLElement>(".compact-icon-navigation [data-sidebar-navigation-item] > button, .compact-icon-navigation [data-testid=sidebar-navigation-more-row] > button").forEach(button => {
          if (button.hasAttribute("title")) return;
          const title = button.getAttribute("aria-label") || button.textContent?.trim();
          if (title) { button.title = title; owned.set(button, title); }
        });
      };
      const observer = new MutationObserver(labelButtons);
      observer.observe(document.body, { childList: true, subtree: true });
      labelButtons();
      return () => {
        observer.disconnect();
        for (const [button, title] of owned) if (button.title === title) button.removeAttribute("title");
        owned.clear();
      };
    },
  });
  app.slots.experimental_sidebarNavigation({
    id: "icons",
    title: "Compact Nav",
    description: "Compact icons with BB's saved order, visibility, and customization controls.",
    component: IconNavigation,
  });
});
