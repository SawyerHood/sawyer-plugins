# Compact Nav

A BB plugin that turns the main sidebar navigation into compact, borderless icon buttons.

- Icons sized to BB's header controls (`--bb-sidebar-control-size`), with 4px gaps.
- Optional header placement: icons sit between the sidebar toggle and the back/forward arrows. Items that do not fit go into More.
- BB's saved order and hidden items, split drags, plugin accessories, and the customize editor.
- Accessible labels, hover titles, and selected states.

## Install

```sh
bb plugin install https://github.com/SawyerHood/bb-plugin-compact-nav.git
```

Under **Settings → Appearance**, click **Use** next to **Compact Nav** to put the icons beside the sidebar toggle. To keep them in a row above the thread list instead, set only **Navigation** to **Compact Nav**. If the header plugin is not picked or stops working, the row above the thread list comes back on its own.

## Customize

Open **More (…) → Customize sidebar** to reorder items or change visibility. Right-click an item for **Open in split**, **View details**, **Hide from sidebar**, and **Customize sidebar**.

Choose **bb (built-in)** under Navigation and Header, or disable this plugin, to restore the original navigation.

## Development

```sh
npm install
npm run typecheck
npm run build
bb plugin install . --yes
```

Requires Plugin SDK >=0.5.11. The plugin uses only the public navigation API (`experimental_useSidebarNavigation`, `experimental_sidebarHeader`); it does not depend on BB's markup.

## License

MIT
