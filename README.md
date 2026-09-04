# Miku Companion for BB

A small Hatsune Miku roams around every BB screen using the app-wide
`experimental_appOverlay` plugin API. She alternates idle animations, reacts
to BB and Tasks events, and says a few words in a speech bubble.

- Uses the supplied pixel-art sprite sheet and removes its blue matte at runtime.
- Walks toward two-dimensional waypoints and pauses for varied idle loops.
- Reacts to thread activity, completion, failures, queued messages, questions,
  archived threads, task completion, and clicks.
- Uses prioritized reaction and speech queues so important events win.
- Can be dragged out of the way; she flails while carried and lands on release.
- Turns without resetting her animation clock or interrupting her stride.
- Remembers her two-dimensional position between reloads.
- Can be persistently hidden or shown from the command palette with
  `Mod+Shift+P` → **Miku: toggle companion visibility**.
- Stops walking and uses static reaction poses when the operating system
  requests reduced motion.
- Keeps the overlay click-through everywhere except Miku herself; click her to
  say hello.

## Install

Install directly from GitHub:

```sh
bb plugin install git:https://github.com/SawyerHood/bb-plugin-miku.git
```

Or install from a local checkout:

```sh
npm install
npm run build
bb plugin install .
```

The sprite is served by the plugin's local authenticated HTTP route. Disabling,
reloading, or uninstalling the plugin cleanly removes the overlay.

## Animation test bench

Open `/api/v1/plugins/miku/http/test-bench` on the BB server to preview every
production clip and its complete filmstrip. The bench validates that every crop
is tightly trimmed, non-empty, inside the 1180×497 source sheet, and small
enough for the shared 92×102 render canvas.
