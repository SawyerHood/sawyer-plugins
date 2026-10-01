# Nav Rail

A BB plugin that moves the sidebar navigation into a vertical icon rail along the sidebar's left edge. **New thread** moves into the header row, left-aligned with the thread rows under it.

- Rail icons sized to BB's header controls (`--bb-sidebar-control-size`), stacked under the sidebar toggle with the same gap between every control.
- A slightly darker strip behind the rail, running the full height of the sidebar. The thread list and footer sit beside it.
- BB's saved order and hidden items, split drags, plugin accessories, and the customize editor.
- Accessible labels, hover titles, and selected states.

## Install

```sh
bb plugin install git:https://github.com/SawyerHood/sawyer-plugins.git --plugin nav-rail
```

Installing Nav Rail picks it for both **Navigation** and **Header** under **Settings → Appearance**. To keep New thread as a row above the thread list instead, set **Header** back to **bb (built-in)**; the row also comes back on its own if the header is not picked or stops working.

## Customize

Open **More (…) → Customize sidebar** to reorder items or change visibility. Hidden items stay reachable from the More menu. Right-click an item for **Open in split**, **View details**, **Hide from sidebar**, and **Customize sidebar**.

Choose **Navigation** under Navigation and **bb (built-in)** under Header, or disable this plugin, to restore BB's rows.

## Development

```sh
npm install
npm run typecheck
npm run build
bb plugin install . --yes
```

Requires Plugin SDK >=0.5.15. Items, order, visibility, and actions come from the public navigation API (`experimental_useSidebarNavigation`), and New thread uses `experimental_sidebarHeader`. BB has no slot beside the thread list, so the rail positions itself: it finds the sidebar column that holds the navigation region, adds a left margin to the navigation, thread list, and footer, and paints the strip as a background on that column. It looks up the sidebar toggle (`[data-sidebar="trigger"]`) to start under it; when the toggle is not above the rail, as with the macOS window controls, the rail and strip start below the header row. If the column cannot be found, the icons fall back to a row above the thread list.

## License

MIT
