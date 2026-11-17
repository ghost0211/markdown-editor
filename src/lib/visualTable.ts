/**
 * Public entry point for the visual GFM table grid.
 *
 * The editor loads this extension only while `editorPresentation === 'visual'`;
 * source mode never imports/pushes it. Everything (state field, widget,
 * commands, labels) is re-exported here so callers and tests share one API.
 */
export * from '@/lib/visualTableExtension';
