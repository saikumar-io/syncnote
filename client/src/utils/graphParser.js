/**
 * SyncNote Knowledge Graph Parser Utility
 * 
 * Extracts explicit wiki-links [[Note Title]] from Markdown contents
 * and builds a graph data structure of nodes and edges.
 */

export function parseKnowledgeGraph(notes = []) {
  if (!Array.isArray(notes) || notes.length === 0) {
    return { nodes: [], edges: [], adjacencyMap: {} };
  }

  // 1. Build a lookup map of normalized note title -> note object
  const titleToNoteMap = new Map();
  notes.forEach((note) => {
    if (note.title) {
      // Normalize title (lowercase & trimmed) for robust matching
      const normalizedTitle = note.title.trim().toLowerCase();
      titleToNoteMap.set(normalizedTitle, note);
    }
  });

  // 2. Initialize Nodes map
  const nodeMap = new Map();
  notes.forEach((note) => {
    nodeMap.set(note.id, {
      id: note.id,
      title: note.title || 'Untitled Note',
      notebook_id: note.notebook_id,
      file_path: note.file_path,
      degree: 0,
      // Initial random placement in canvas viewport
      x: (Math.random() - 0.5) * 500,
      y: (Math.random() - 0.5) * 400,
      vx: 0,
      vy: 0
    });
  });

  const edges = [];
  const edgeSet = new Set();
  const adjacencyMap = {};

  notes.forEach((n) => {
    adjacencyMap[n.id] = new Set();
  });

  // 3. Scan Markdown content for [[Note Title]] wiki-links using Regex
  const wikiLinkRegex = /\[\[(.*?)\]\]/g;

  notes.forEach((sourceNote) => {
    if (!sourceNote.content) return;

    let match;
    // Reset regex index
    wikiLinkRegex.lastIndex = 0;

    while ((match = wikiLinkRegex.exec(sourceNote.content)) !== null) {
      const targetTitleRaw = match[1];
      if (!targetTitleRaw) continue;

      const targetTitleNormalized = targetTitleRaw.trim().toLowerCase();
      const targetNote = titleToNoteMap.get(targetTitleNormalized);

      // Create edge if target note exists and is not a self-link
      if (targetNote && targetNote.id !== sourceNote.id) {
        const edgeId = `${sourceNote.id}->${targetNote.id}`;
        const reverseEdgeId = `${targetNote.id}->${sourceNote.id}`;

        // Deduplicate edges
        if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
          edgeSet.add(edgeId);
          edges.push({
            id: edgeId,
            source: sourceNote.id,
            target: targetNote.id,
            type: 'wiki_link' // Extensible: future AI semantic links can use 'ai_semantic'
          });

          // Track connection degrees
          const sourceNode = nodeMap.get(sourceNote.id);
          const targetNode = nodeMap.get(targetNote.id);
          if (sourceNode) sourceNode.degree += 1;
          if (targetNode) targetNode.degree += 1;

          if (adjacencyMap[sourceNote.id]) adjacencyMap[sourceNote.id].add(targetNote.id);
          if (adjacencyMap[targetNote.id]) adjacencyMap[targetNote.id].add(sourceNote.id);
        }
      }
    }
  });

  const nodes = Array.from(nodeMap.values());

  return { nodes, edges, adjacencyMap };
}
