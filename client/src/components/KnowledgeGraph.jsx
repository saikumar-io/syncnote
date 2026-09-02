import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import GraphControls from './GraphControls';
import { parseKnowledgeGraph } from '../utils/graphParser';
import { Share2, Plus, Sparkles } from 'lucide-react';

export default function KnowledgeGraph({ 
  notes = [], 
  selectedNoteId, 
  onSelectNote, 
  onCreateNote,
  focusNoteId = null 
}) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  // Transform / Camera View State
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [searchQuery, setSearchQuery] = useState('');

  // Synchronized Refs to avoid recreating animation frames / re-renders
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const searchQueryRef = useRef(searchQuery);
  const selectedNoteIdRef = useRef(selectedNoteId);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { selectedNoteIdRef.current = selectedNoteId; }, [selectedNoteId]);

  // Interactive Graph Data State
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const adjacencyRef = useRef({});

  // Hover & Drag Interactions
  const hoveredNodeRef = useRef(null);
  const draggedNodeRef = useRef(null);
  const isDraggingCanvasRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // Memoize persistent notes to maintain stable reference across renders
  const persistentNotes = useMemo(() => notes.filter((n) => n.id !== 'draft'), [notes]);

  // Base graph parsing (single source of truth)
  const baseGraphData = useMemo(() => {
    return parseKnowledgeGraph(persistentNotes);
  }, [persistentNotes]);

  // Filtered visible nodes & edges (search/filtering)
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const { nodes, edges } = baseGraphData;
    if (!searchQuery.trim()) {
      return { visibleNodes: nodes, visibleEdges: edges };
    }
    const q = searchQuery.trim().toLowerCase();
    const matchedNodes = nodes.filter((n) => n.title.toLowerCase().includes(q));
    const matchedNodeIds = new Set(matchedNodes.map((n) => n.id));
    const matchedEdges = edges.filter(
      (e) => matchedNodeIds.has(e.source) && matchedNodeIds.has(e.target)
    );
    return { visibleNodes: matchedNodes, visibleEdges: matchedEdges };
  }, [baseGraphData, searchQuery]);

  // Synchronize canvas animation physics data with derived visible graph
  useEffect(() => {
    const prevPosMap = new Map();
    (nodesRef.current || []).forEach((n) => prevPosMap.set(n.id, { x: n.x, y: n.y }));

    const canvas = canvasRef.current;
    const width = canvas ? canvas.clientWidth : 800;
    const height = canvas ? canvas.clientHeight : 600;

    const populatedNodes = visibleNodes.map((node, index) => {
      const prev = prevPosMap.get(node.id);
      if (prev) {
        return { ...node, x: prev.x, y: prev.y };
      } else {
        const angle = (index / Math.max(visibleNodes.length, 1)) * Math.PI * 2;
        const radius = Math.min(width, height) * 0.22;
        return {
          ...node,
          x: Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
          y: Math.sin(angle) * radius + (Math.random() - 0.5) * 30
        };
      }
    });

    nodesRef.current = populatedNodes;
    edgesRef.current = visibleEdges;
    adjacencyRef.current = baseGraphData.adjacencyMap;
  }, [visibleNodes, visibleEdges, baseGraphData.adjacencyMap]);

  // Separate effect to focus camera on specific note without triggering render loop
  const focusedNoteRef = useRef(null);
  useEffect(() => {
    if (!focusNoteId || focusedNoteRef.current === focusNoteId) return;
    focusedNoteRef.current = focusNoteId;
    const focusNode = nodesRef.current.find((n) => n.id === focusNoteId);
    if (focusNode) {
      const curZoom = zoomRef.current;
      setPan({ x: -focusNode.x * curZoom, y: -focusNode.y * curZoom });
    }
  }, [focusNoteId]);

  // 2. Physics Simulation Tick (Stable Damping)
  const stepPhysics = () => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;

        if (dist < 300) {
          const force = (1800 / (dist * dist));
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (n1 !== draggedNodeRef.current) {
            n1.vx -= fx;
            n1.vy -= fy;
          }
          if (n2 !== draggedNodeRef.current) {
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }
    }

    // Attraction
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    edges.forEach((edge) => {
      const n1 = nodeMap.get(edge.source);
      const n2 = nodeMap.get(edge.target);
      if (!n1 || !n2) return;

      let dx = n2.x - n1.x;
      let dy = n2.y - n1.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const idealDist = 110;
      const force = (dist - idealDist) * 0.035;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (n1 !== draggedNodeRef.current) {
        n1.vx += fx;
        n1.vy += fy;
      }
      if (n2 !== draggedNodeRef.current) {
        n2.vx -= fx;
        n2.vy -= fy;
      }
    });

    // Central gravity & strong velocity damping to stabilize simulation
    nodes.forEach((n) => {
      if (n === draggedNodeRef.current) return;
      n.vx -= n.x * 0.005;
      n.vy -= n.y * 0.005;
      n.vx *= 0.82;
      n.vy *= 0.82;

      n.x += n.vx;
      n.y += n.vy;
    });
  };

  // 3. Stable Animation Frame Loop Reading from Refs
  useEffect(() => {
    let animationFrameId;

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const curZoom = zoomRef.current;
        const curPan = panRef.current;
        const curQuery = searchQueryRef.current;
        const curSelectedId = selectedNoteIdRef.current;

        // Read Dynamic Theme CSS Tokens
        const computedStyle = getComputedStyle(document.documentElement);
        const bgColor = computedStyle.getPropertyValue('--bg-app').trim() || '#09090b';
        const edgeColor = computedStyle.getPropertyValue('--border-subtle').trim() || '#27272a';
        const accentPrimary = computedStyle.getPropertyValue('--accent-primary').trim() || '#6366f1';
        const textPrimary = computedStyle.getPropertyValue('--text-primary').trim() || '#fafafa';
        const textSecondary = computedStyle.getPropertyValue('--text-secondary').trim() || '#a1a1aa';
        const textMuted = computedStyle.getPropertyValue('--text-muted').trim() || '#71717a';

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2 + curPan.x, height / 2 + curPan.y);
        ctx.scale(curZoom, curZoom);

        stepPhysics();

        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        const hoveredNode = hoveredNodeRef.current;
        const adjacencies = hoveredNode ? (adjacencyRef.current[hoveredNode.id] || new Set()) : new Set();

        const searchMatchSet = new Set();
        if (curQuery.trim()) {
          const q = curQuery.toLowerCase();
          nodes.forEach((n) => {
            if (n.title.toLowerCase().includes(q)) searchMatchSet.add(n.id);
          });
        }

        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        // Render Edges
        edges.forEach((edge) => {
          const n1 = nodeMap.get(edge.source);
          const n2 = nodeMap.get(edge.target);
          if (!n1 || !n2) return;

          const isHighlighted =
            hoveredNode && (edge.source === hoveredNode.id || edge.target === hoveredNode.id);

          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = isHighlighted ? accentPrimary : edgeColor;
          ctx.lineWidth = isHighlighted ? 2.5 / curZoom : 1 / curZoom;
          ctx.stroke();
        });

        // Render Nodes
        nodes.forEach((n) => {
          const isHovered = hoveredNode?.id === n.id;
          const isSelected = curSelectedId === n.id;
          const isNeighbor = hoveredNode && adjacencies.has(n.id);
          const isSearchMatch = searchMatchSet.has(n.id);

          const radius = Math.min(7 + n.degree * 1.5, 15);

          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);

          if (isHovered || isSelected || isSearchMatch) {
            ctx.fillStyle = accentPrimary;
          } else if (isNeighbor) {
            ctx.fillStyle = textPrimary;
          } else {
            ctx.fillStyle = textMuted;
          }

          ctx.fill();

          if (isSelected || isSearchMatch) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = accentPrimary;
            ctx.lineWidth = 1.5 / curZoom;
            ctx.stroke();
          }

          ctx.font = `${isHovered || isSelected ? '600' : '500'} ${12 / Math.max(curZoom, 0.8)}px Inter, sans-serif`;
          ctx.fillStyle = isHovered || isSelected || isNeighbor || isSearchMatch ? textPrimary : textSecondary;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(n.title, n.x, n.y + radius + 5);
        });

        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const getCanvasMousePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { worldX: 0, worldY: 0, screenX: 0, screenY: 0, mouseX: 0, mouseY: 0, width: 800, height: 600 };
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const curZoom = zoomRef.current;
    const curPan = panRef.current;

    const worldX = (mouseX - canvas.clientWidth / 2 - curPan.x) / curZoom;
    const worldY = (mouseY - canvas.clientHeight / 2 - curPan.y) / curZoom;

    return { worldX, worldY, screenX: e.clientX, screenY: e.clientY, mouseX, mouseY, width: canvas.clientWidth, height: canvas.clientHeight };
  };

  const handleMouseDown = (e) => {
    const { worldX, worldY, screenX, screenY } = getCanvasMousePos(e);
    lastMousePosRef.current = { x: screenX, y: screenY };

    const hitNode = nodesRef.current.find((n) => {
      const radius = Math.min(7 + n.degree * 1.5, 15);
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      return Math.sqrt(dx * dx + dy * dy) <= radius + 4;
    });

    if (hitNode) {
      draggedNodeRef.current = hitNode;
    } else {
      isDraggingCanvasRef.current = true;
    }
  };

  const handleMouseMove = (e) => {
    const { worldX, worldY, screenX, screenY } = getCanvasMousePos(e);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = worldX;
      draggedNodeRef.current.y = worldY;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingCanvasRef.current) {
      const dx = screenX - lastMousePosRef.current.x;
      const dy = screenY - lastMousePosRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePosRef.current = { x: screenX, y: screenY };
      return;
    }

    const hitNode = nodesRef.current.find((n) => {
      const radius = Math.min(7 + n.degree * 1.5, 15);
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      return Math.sqrt(dx * dx + dy * dy) <= radius + 4;
    });

    hoveredNodeRef.current = hitNode || null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hitNode ? 'pointer' : (isDraggingCanvasRef.current ? 'grabbing' : 'default');
  };

  const handleMouseUp = (e) => {
    const { worldX, worldY } = getCanvasMousePos(e);

    if (draggedNodeRef.current) {
      const radius = Math.min(7 + draggedNodeRef.current.degree * 1.5, 15);
      const dx = draggedNodeRef.current.x - worldX;
      const dy = draggedNodeRef.current.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) <= radius + 4) {
        if (onSelectNote) onSelectNote(draggedNodeRef.current.id);
      }
    }

    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const { mouseX, mouseY, width, height } = getCanvasMousePos(e);

    const delta = -e.deltaY;
    let factor = delta > 0 ? 1.08 : 0.92;
    if (e.ctrlKey) factor = delta > 0 ? 1.04 : 0.96;

    const curZoom = zoomRef.current;
    const curPan = panRef.current;

    const newZoom = Math.min(Math.max(curZoom * factor, 0.25), 4.0);

    const worldX = (mouseX - width / 2 - curPan.x) / curZoom;
    const worldY = (mouseY - height / 2 - curPan.y) / curZoom;

    const newPanX = mouseX - width / 2 - worldX * newZoom;
    const newPanY = mouseY - height / 2 - worldY * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev * 1.2, 4.0));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev * 0.8, 0.25));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSearchQuery('');
  };

  const handleFitGraph = () => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) {
      handleResetView();
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });

    const canvas = canvasRef.current;
    const width = canvas ? canvas.clientWidth : 800;
    const height = canvas ? canvas.clientHeight : 600;

    const graphWidth = Math.max(maxX - minX, 100);
    const graphHeight = Math.max(maxY - minY, 100);

    const padding = 100;
    const scaleX = (width - padding) / graphWidth;
    const scaleY = (height - padding) / graphHeight;
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.4), 2.0);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(fitZoom);
    setPan({ x: -centerX * fitZoom, y: -centerY * fitZoom });
  };

  const totalNodes = visibleNodes.length;
  const totalEdges = visibleEdges.length;
  const hasZeroNotes = persistentNotes.length === 0;

  return (
    <div className="knowledge-graph-container" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      <GraphControls
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetView={handleResetView}
        onFitGraph={handleFitGraph}
      />

      <div className="graph-info-badge">
        <Share2 size={12} />
        <span>{totalNodes} Notes</span>
        <span>•</span>
        <span>{totalEdges} Connections</span>
      </div>

      {!hasZeroNotes && totalEdges === 0 && (
        <div className="graph-subtle-hint">
          <Sparkles size={12} style={{ color: 'var(--accent-primary)' }} />
          <span>Link notes with <code className="md-inline-code">[[Note Name]]</code> to connect them</span>
        </div>
      )}

      {hasZeroNotes && (
        <div className="empty-graph-overlay">
          <div style={{ maxWidth: '320px', textAlign: 'center', background: 'var(--bg-sidebar)', border: '1px solid var(--border-medium)', padding: '20px', borderRadius: 'var(--radius-md)' }}>
            <Share2 size={28} style={{ margin: '0 auto 10px auto', display: 'block', color: 'var(--text-muted)', opacity: 0.5 }} />
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No notes yet
            </h3>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Create your first note to begin building your knowledge graph.
            </p>
            <button className="new-note-btn" style={{ width: 'auto', margin: '0 auto' }} onClick={onCreateNote}>
              <Plus size={13} />
              <span>+ New Note</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
