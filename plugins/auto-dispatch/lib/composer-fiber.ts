// The plugin SDK cannot set the New thread composer's pickers, so Auto-fill
// calls the composer's own setters, the ones its pickers call, which it finds
// on BB's components through React's fiber tree. Every React internal and BB
// prop name trusted for that lives here. A BB or React release that moves them
// makes Auto-fill say it cannot reach the pickers; it cannot set a wrong value.
import type { ReasoningLevel } from "./reasoning";

/** The parts of a React fiber read here. */
interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: unknown;
  stateNode: unknown;
}

export interface ComposerSelection {
  /** BB's personal project id means "No project". */
  projectId: string;
  environmentProviderId: string;
  hostId: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

/** The root New thread composer's setters, as of the latest render. */
interface ComposerControls {
  projectId: string;
  changeProject(projectId: string): unknown;
  setEnvironment(selectionValue: string, hostId: string): void;
  setProviderModelReasoning(selection: {
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
  }): void;
}

const PROJECT_SWITCH_TIMEOUT_MS = 5_000;
const PROJECT_SWITCH_POLL_MS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The fiber of `node`, or of its nearest ancestor that React rendered. */
function fiberOf(node: Element): Fiber | null {
  // The editor's own elements are built by its rich text library, not React.
  for (let element: Element | null = node; element !== null; element = element.parentElement) {
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    if (key === undefined) continue;
    const fiber = (element as unknown as Record<string, unknown>)[key];
    if (isRecord(fiber)) return fiber as unknown as Fiber;
  }
  return null;
}

/**
 * The fibers from the root down to `node`, as of the latest commit. React keeps
 * two copies of each fiber and a DOM node may hold either, so the path is
 * retraced from the root's live copy, which holds the latest props.
 */
function livePath(node: Element): Fiber[] {
  const upward: Fiber[] = [];
  for (let fiber = fiberOf(node); fiber !== null; fiber = fiber.return) upward.push(fiber);
  const top = upward.pop();
  const root = isRecord(top?.stateNode) ? top.stateNode.current : null;
  if (!isRecord(root)) return [];
  let live = root as unknown as Fiber;
  const path = [live];
  for (const wanted of upward.reverse()) {
    let child = live.child;
    while (child !== null && child !== wanted && child !== wanted.alternate) child = child.sibling;
    if (child === null) return [];
    path.push(child);
    live = child;
  }
  return path;
}

/** Null when `node` is not inside the root New thread composer, or BB has changed. */
function readControls(node: Element): ComposerControls | null {
  let changeProject: ComposerControls["changeProject"] | null = null;
  // Deepest first: the prompt box that owns the project picker sits inside the
  // compose screen that owns the rest.
  for (const fiber of livePath(node).reverse()) {
    const props = fiber.memoizedProps;
    if (!isRecord(props)) continue;
    if (changeProject === null && isRecord(props.project)) {
      const onChange = props.project.onChange;
      if (typeof onChange === "function") {
        changeProject = (projectId) => onChange(projectId) as unknown;
      }
    }
    const composer = props.composer;
    if (
      changeProject !== null &&
      isRecord(composer) &&
      typeof composer.projectId === "string" &&
      typeof composer.setEnvironmentSelectionValue === "function" &&
      typeof composer.setProviderModelReasoning === "function"
    ) {
      return {
        projectId: composer.projectId,
        changeProject,
        setEnvironment: composer.setEnvironmentSelectionValue as ComposerControls["setEnvironment"],
        setProviderModelReasoning:
          composer.setProviderModelReasoning as ComposerControls["setProviderModelReasoning"],
      };
    }
  }
  return null;
}

/** Whether Auto-fill can set the pickers of the composer containing `node`. */
export function canFillComposer(node: Element): boolean {
  return readControls(node) !== null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Set the composer's project, environment, machine, model, and reasoning level
 * as if each had been picked by hand. The project goes first and is awaited,
 * because BB remembers the environment and machine per project: set any
 * earlier, they would land on the project being left.
 *
 * `anchor` returns an element inside the composer. It is asked again after the
 * project changes, because BB rebuilds the composer for the new project and
 * the element from before is gone.
 */
export async function fillComposer(
  anchor: () => Element | null,
  selection: ComposerSelection,
): Promise<void> {
  const read = () => {
    const node = anchor();
    return node === null ? null : readControls(node);
  };
  const unreachable = new Error("Auto-fill could not reach this composer's pickers.");
  let controls = read();
  if (controls === null) throw unreachable;

  if (controls.projectId !== selection.projectId) {
    await controls.changeProject(selection.projectId);
    const deadline = Date.now() + PROJECT_SWITCH_TIMEOUT_MS;
    for (;;) {
      controls = read();
      if (controls?.projectId === selection.projectId) break;
      if (Date.now() > deadline) {
        throw controls === null ? unreachable : new Error("The composer did not switch projects.");
      }
      await wait(PROJECT_SWITCH_POLL_MS);
    }
  }

  controls.setEnvironment(`provider:${selection.environmentProviderId}`, selection.hostId);
  controls.setProviderModelReasoning({
    providerId: selection.providerId,
    model: selection.model,
    reasoningLevel: selection.reasoningLevel,
  });
}
