export const PREVIEW_DIRECTIVE_ID = "agent-browser-preview";

export function previewDirective(sessionId: string): string {
  return `::${PREVIEW_DIRECTIVE_ID}{session="${sessionId}"}`;
}
