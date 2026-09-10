# Miku Companion for BB

![Miku Companion logo](assets/miku-logo.webp)

A small Hatsune Miku roams around every BB screen using the app-wide
`experimental_appOverlay` plugin API. She alternates idle animations and can
use a dedicated hidden BB thread to comment on real activity in the app.

- Uses the supplied pixel-art sprite sheet and removes its blue matte at runtime.
- Walks toward two-dimensional waypoints and pauses for varied idle loops.
- Reacts to thread activity, completion, failures, queued messages, questions,
  archived threads, task completion, and clicks.
- Batches activity for one second and steers later batches into an active
  hidden-thread response.
- Shows `…` while her agent is thinking, then speaks the agent's bounded
  one-line response.
- Keeps speech visible for 5–10 seconds and queues later messages without
  replacing the one already on screen; pending `…` indicators are discarded
  when the real response is ready.
- Centers pointerless bubbles over Miku's visible sprite pixels and clamps them
  to the viewport, including long wrapped text and positions near screen edges.
- Stabilizes the bubble against a shared walking/idle silhouette so differently
  cropped animation frames do not make it jitter vertically.
- Supports autonomous periodic check-ins, with a configurable interval.
- Lets you choose the brain project, hidden thread, provider, model, service
  tier, reasoning level, and permission mode from the plugin settings page.
- Uses prioritized reaction and speech queues so important events win.
- Can be dragged out of the way; she flails while carried and lands on release.
- Turns without resetting her animation clock or interrupting her stride.
- Finishes short reaction animations and resumes moving while speech lingers.
- Remembers her two-dimensional position between reloads.
- Can be persistently hidden or shown from the command palette with
  `Mod+Shift+P` → **Miku: toggle companion visibility**.
- Can stop roaming while keeping her animations and reactions; toggle **Stay in
  place** in settings or run **Miku: toggle walking** from the command palette.
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

## Agent-powered comments

Open **Settings → Extensions → Miku Companion**. Choose a Brain project,
select the provider/model/thinking combination, and create a hidden brain
thread. Then enable **Agent-powered comments**. Set the autonomous interval to
`0` if Miku should only respond to app events.

When no brain is enabled or selected, Miku keeps using her built-in scripted
reactions. Hidden brain threads stay out of the sidebar but can be opened from
the Miku settings page for inspection.

## Voice

Enable **Speak aloud** in Miku's settings to hear her text bubbles in a
musical synthesized voice. Voice runs locally and requires FFmpeg with Flite
and Rubber Band support on the BB server. Click in BB once to enable browser
audio. Mute her from settings or **Miku: toggle voice** in the command palette;
text bubbles keep working.

## Animation test bench

Open `/api/v1/plugins/miku/http/test-bench` on the BB server to preview every
production clip and its complete filmstrip. The bench validates that every crop
is tightly trimmed, non-empty, inside the 1180×497 source sheet, and small
enough for the shared 92×102 render canvas.
