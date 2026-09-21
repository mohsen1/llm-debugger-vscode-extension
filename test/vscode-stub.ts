/**
 * Minimal `vscode` stand-in for unit tests. The loop under test never touches
 * the editor API — it reaches this only through the logger's import chain — so
 * the stub just has to exist and be quiet.
 */
export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    dispose: () => {},
  }),
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  activeTextEditor: undefined,
};
/** Settings the tests pretend a user has chosen. */
export const __settings: Record<string, unknown> = {};
/** Defaults the manifest declares, which must NOT win over the environment. */
export const __declaredDefaults: Record<string, unknown> = {};

export const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({
    get: (key: string) => __settings[key] ?? __declaredDefaults[key],
    inspect: (key: string) => ({
      defaultValue: __declaredDefaults[key],
      globalValue: __settings[key],
      workspaceValue: undefined,
      workspaceFolderValue: undefined,
    }),
  }),
};
export const debug = { breakpoints: [] as unknown[] };
export default { window, workspace, debug };
