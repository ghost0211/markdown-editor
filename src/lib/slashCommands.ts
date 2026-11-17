/**
 * Public entry point for the `/` slash-command feature.
 *
 * The implementation is split in two layers so the pure parts stay importable
 * without the CodeMirror view layer:
 *
 * - `slashCommandsCore` — command metadata, query parsing, search and the
 *   single-transaction insertion builder (all pure functions).
 * - `slashMenu` — the state field, key bindings and tooltip listbox.
 *
 * Both are re-exported here so hosts have one import for labels, types and the
 * `createSlashCommandExtension` factory.
 */
export * from '@/lib/slashCommandsCore';
export * from '@/lib/slashMenu';
