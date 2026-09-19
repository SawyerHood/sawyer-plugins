# Compact Nav

A BB plugin that turns the main sidebar navigation into compact, borderless icon buttons.

- 28px buttons with 16px icons and 4px gaps. Mobile touch controls match BB's header: 36px buttons with 20px icons; larger touch screens use 40px buttons.
- Header layout places icons beside the sidebar toggle by default, wrapping extra icons below.
- Native BB icons, saved order, hidden items, navigation, and split gestures.
- Accessible labels, hover titles, and selected states.
- No divider beneath the navigation, with tighter spacing above the thread list.

## Install

```sh
bb plugin install https://github.com/SawyerHood/bb-plugin-compact-nav.git
```

Select **Settings → Appearance → Navigation → Compact Nav**. Automatic also selects this plugin if no other replacement takes precedence.

## Customize

Icons fit between the sidebar toggle and back/forward arrows by default. Extra icons wrap below; layouts without room in the header retain a separate row. Disable **Place icons beside sidebar toggle** in **Settings → Installed plugins → Compact Nav** to always use a separate row. An explicitly saved preference is preserved when updating.

Open **More (…) → Customize sidebar** to reorder items or change visibility. Right-click an item for **Hide from sidebar** and **Customize sidebar**. The customization editor retains its full labels and controls.

Choose **bb (built-in)** under the Navigation setting, or disable this plugin, to restore the original navigation.

## Development

```sh
npm install
npm run typecheck
npm run build
bb plugin install . --yes
```

Requires BB >=0.42 and Plugin SDK >=0.4.53. Builds use the installed BB CLI. This plugin renders the SDK's original-navigation component and applies scoped CSS. Its styles depend on host DOM attributes and may need adjustment after BB UI changes.

## License

MIT
