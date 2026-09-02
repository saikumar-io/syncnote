/**
 * Shared Path Helper Utilities for SyncNote
 * Derived folder & note path strings used across all UI components
 */

/**
 * Returns formatted note path: "Notes / [Notebook Name] / [Note Title].md"
 */
export function getNotePath(note, notebooks = []) {
  if (!note) return 'Notes / Unassigned / Untitled.md';

  const notebook = (notebooks || []).find((nb) => nb.id === note.notebook_id);
  const folderName = notebook ? notebook.name : 'Unassigned';

  const title = note.title || 'Untitled Note';
  const cleanTitle = title.toLowerCase().endsWith('.md') ? title : `${title}.md`;

  return `Notes / ${folderName} / ${cleanTitle}`;
}

/**
 * Returns formatted notebook folder path: "Notes / [Notebook Name]"
 */
export function getNotebookPath(notebook) {
  if (!notebook) return 'Notes / Unassigned';
  return `Notes / ${notebook.name}`;
}
