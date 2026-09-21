/**
 * Pure prompt helpers for the chat participant. No vscode import, so they stay
 * unit-testable.
 */

/**
 * `@debugger` alone hunts whatever is open or attached; if the prompt names a
 * runnable file anywhere in it — `@debugger debug validate.js`, a quoted path,
 * an attachment name — hunt that instead. Returns undefined when nothing in the
 * prompt looks like a file.
 */
export function programFromPrompt(prompt: string): string | undefined {
  for (const raw of prompt.split(/\s+/)) {
    const token = (raw || "").replace(/^["'`<([]*(.*?)["'`>.,)\]:;!?]*$/, "$1");
    if (/[\w\-./]+\.[cm]?[jt]sx?$/i.test(token)) return token;
  }
  return undefined;
}
