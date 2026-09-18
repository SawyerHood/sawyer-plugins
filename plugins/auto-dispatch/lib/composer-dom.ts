// The plugin SDK can neither hide the New thread composer's pickers nor take
// over its send, so Auto mode does both against the composer's DOM. Every
// selector BB's markup is trusted for lives here.

const COMPOSER_ROOT = "[data-app-composer]";
/** Only the root New thread screen's editor carries this id. */
const ROOT_COMPOSE_EDITOR = "#root-compose-prompt";
const EDITOR = "[data-promptbox-editor-content]";
const TYPEAHEAD_MENU = "[data-promptbox-typeahead-menu]";
const SUBMIT_BUTTON = 'button[type="submit"][data-promptbox-submit-action]';
/** Wraps the submit button while BB has it disabled, and receives its clicks. */
const DISABLED_SUBMIT = "[data-promptbox-submit-disabled-reason]";

/** Set on the composer root while Auto is on; app.css hides the pickers under it. */
export const AUTO_ATTRIBUTE = "data-auto-dispatch";

/** The root New thread composer containing `element`, or null in any other composer. */
export function findRootComposer(element: Element): HTMLElement | null {
  const root = element.closest<HTMLElement>(COMPOSER_ROOT);
  return root !== null && root.querySelector(ROOT_COMPOSE_EDITOR) !== null ? root : null;
}

/** The root New thread screen's editor, wherever BB has currently mounted it. */
export function findRootComposeEditor(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ROOT_COMPOSE_EDITOR);
}

/**
 * Report the root New thread composer containing `element` once it can be
 * recognized. The banner mounts before the editor does on a return visit, so
 * the editor's id is not there yet at mount; watch until it is. Returns a disposer.
 */
export function watchRootComposer(
  element: Element,
  onFound: (root: HTMLElement) => void,
): () => void {
  const found = findRootComposer(element);
  if (found !== null) {
    onFound(found);
    return () => {};
  }
  const scope = element.closest(COMPOSER_ROOT) ?? document.body;
  const observer = new MutationObserver(() => {
    const root = findRootComposer(element);
    if (root === null) return;
    observer.disconnect();
    onFound(root);
  });
  observer.observe(scope, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id"],
  });
  return () => observer.disconnect();
}

function within(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Route every way of sending the draft to `onSubmit` instead of BB's own send.
 * Listeners sit on the composer root in the capture phase, ahead of the
 * editor's keymap and React's form handler. Returns a disposer.
 */
export function interceptSubmit(root: HTMLElement, onSubmit: () => void): () => void {
  const take = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (!within(event.target, EDITOR)) return;
    // Enter picks the highlighted @-mention or slash command.
    if (document.querySelector(TYPEAHEAD_MENU) !== null) return;
    // On touch keyboards Enter is a newline; sending is the button's job.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    take(event);
  };

  const onFormSubmit = (event: Event) => take(event);

  // BB sends on touch from pointerup, before any click or form submit.
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (within(event.target, SUBMIT_BUTTON) || within(event.target, DISABLED_SUBMIT)) take(event);
  };

  // BB disables its button while its own hidden pickers are unresolved; Auto
  // does not need them.
  const onClick = (event: MouseEvent) => {
    if (within(event.target, DISABLED_SUBMIT)) take(event);
  };

  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("submit", onFormSubmit, true);
  root.addEventListener("pointerup", onPointerUp, true);
  root.addEventListener("click", onClick, true);
  return () => {
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("submit", onFormSubmit, true);
    root.removeEventListener("pointerup", onPointerUp, true);
    root.removeEventListener("click", onClick, true);
  };
}
