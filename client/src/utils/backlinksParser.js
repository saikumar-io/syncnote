/**
 * SyncNote Backlinks Parser Utility
 * 
 * Scans notes for [[Target Note Title]] references pointing to a target note.
 */

export function getBacklinksForNote(targetNote, allNotes = []) {
  if (!targetNote || !targetNote.title || !Array.isArray(allNotes)) {
    return [];
  }

  const targetTitleNorm = targetNote.title.trim().toLowerCase();
  const backlinks = [];

  const wikiLinkRegex = /\[\[(.*?)\]\]/g;

  allNotes.forEach((sourceNote) => {
    // Exclude self-references and draft notes
    if (sourceNote.id === targetNote.id || sourceNote.id === 'draft' || !sourceNote.content) {
      return;
    }

    wikiLinkRegex.lastIndex = 0;
    let match;
    let isLinked = false;
    let matchingContextSnippet = '';

    while ((match = wikiLinkRegex.exec(sourceNote.content)) !== null) {
      const linkedTitle = match[1].trim().toLowerCase();
      if (linkedTitle === targetTitleNorm) {
        isLinked = true;
        // Extract 1-line snippet context around the wiki link
        const linkIndex = match.index;
        const start = Math.max(0, linkIndex - 40);
        const end = Math.min(sourceNote.content.length, linkIndex + match[0].length + 40);
        matchingContextSnippet = sourceNote.content.substring(start, end).replace(/\n/g, ' ');
        break;
      }
    }

    if (isLinked) {
      backlinks.push({
        id: sourceNote.id,
        title: sourceNote.title || 'Untitled Note',
        snippet: matchingContextSnippet || sourceNote.content.substring(0, 80),
        file_path: sourceNote.file_path,
        updated_at: sourceNote.updated_at
      });
    }
  });

  return backlinks;
}
