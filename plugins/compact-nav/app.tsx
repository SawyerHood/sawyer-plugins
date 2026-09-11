import { definePluginApp, useSettings, type ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef } from "react";
import "./app.css";

function IconNavigation({ experimental_Original: Original }: ExperimentalSidebarNavigationProps) {
  const root = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const inlineHeader = settings.values?.inlineHeader === true;

  useLayoutEffect(() => {
    if (!inlineHeader) return;
    const element = root.current;
    const region = element?.closest('[data-testid="sidebar-navigation-region"]');
    const header = region?.previousElementSibling;
    const trigger = document.querySelector<HTMLElement>('[data-sidebar="trigger"]');
    const history = header?.firstElementChild;
    if (!element || !header?.matches('[data-testid="app-sidebar-top-reserve-row"]') || !trigger || !history) return;

    // Measure the host controls so desktop chrome, touch targets, and sidebar
    // resizing all leave the actual available space for navigation.
    const update = () => {
      const row = header.getBoundingClientRect();
      const toggle = trigger.getBoundingClientRect();
      const arrows = history.getBoundingClientRect();
      const button = element.querySelector('[data-sidebar-navigation-item] > button');
      const size = button?.getBoundingClientRect().width || 28;
      const start = Math.max(12, toggle.right - row.left + 4);
      const end = Math.max(8, row.right - arrows.left + 4);
      if (!row.height || !toggle.width || row.width - start - end < size) {
        delete element.dataset.headerPlacement;
        return;
      }
      element.style.setProperty('--compact-nav-header-height', `${row.height}px`);
      element.style.setProperty('--compact-nav-button-size', `${size}px`);
      element.style.setProperty('--compact-nav-start', `${start}px`);
      element.style.setProperty('--compact-nav-end', `${end}px`);
      element.style.setProperty('--compact-nav-top', `${Math.max(0, toggle.top - row.top + (toggle.height - size) / 2)}px`);
      element.dataset.headerPlacement = '';
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(trigger);
    observer.observe(history);
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target instanceof Element && (event.target.contains(header) || event.target.contains(trigger))) update();
    };
    window.addEventListener('resize', update);
    document.addEventListener('transitionend', onTransitionEnd);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('transitionend', onTransitionEnd);
      delete element.dataset.headerPlacement;
    };
  }, [inlineHeader]);

  return <div ref={root} className="compact-icon-navigation"><Original /></div>;
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
