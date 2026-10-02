import React, { useRef, useEffect, useState, useMemo } from 'react';
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
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

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

// Stable pseudo-random generator based on note ID for deterministic, organic node layout
function getNodeSeed(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0);
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

  // Simulation cooling alpha reference
  const alphaRef = useRef(1.0);

  // Auto-fit camera view to enclose all active nodes with comfortable margins
  const fitGraphToViewport = (nodesList) => {
    const nodes = (nodesList || nodesRef.current || []).filter(
      (n) => Number.isFinite(n.x) && Number.isFinite(n.y)
    );
    if (!nodes || nodes.length === 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    if (nodes.length === 1) {
      setZoom(1.0);
      setPan({ x: -nodes[0].x, y: -nodes[0].y });
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      const r = Math.min(8 + (n.degree || 0) * 1.6, 17) + 20;
      if (n.x - r < minX) minX = n.x - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.y + r + 26 > maxY) maxY = n.y + r + 26;
    });

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const width = canvas?.clientWidth || container?.clientWidth || 800;
    const height = canvas?.clientHeight || container?.clientHeight || 600;

    const padding = 100;
    const graphWidth = Math.max(maxX - minX + padding * 2, 160);
    const graphHeight = Math.max(maxY - minY + padding * 2, 160);

    const scaleX = width / graphWidth;
    const scaleY = height / graphHeight;
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.35), 1.5);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(fitZoom);
    setPan({ x: -centerX * fitZoom, y: -centerY * fitZoom });
  };

  // Synchronize canvas animation physics data with derived visible graph (Organic & Deterministic)
  useEffect(() => {
    const prevPosMap = new Map();
    (nodesRef.current || []).forEach((n) => {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
        prevPosMap.set(n.id, { x: n.x, y: n.y, vx: n.vx || 0, vy: n.vy || 0 });
      }
    });

    const populatedNodes = visibleNodes.map((node) => {
      const prev = prevPosMap.get(node.id);
      if (prev) {
        return { ...node, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy };
      } else {
        // Natural, organic, deterministic pseudo-random distribution
        const rng = seededRandom(getNodeSeed(node.id));
        const angle = rng() * Math.PI * 2;
        const radius = 70 + rng() * 140;
        const jitterX = (rng() - 0.5) * 50;
        const jitterY = (rng() - 0.5) * 50;
        return {
          ...node,
          x: Math.cos(angle) * radius + jitterX,
          y: Math.sin(angle) * radius + jitterY,
          vx: 0,
          vy: 0
        };
      }
    });

    // If new nodes were introduced, perform fast initial force relaxation so organic spacing is established
    const hasNewNodes = visibleNodes.some((n) => !prevPosMap.has(n.id));
    if (hasNewNodes && populatedNodes.length > 1) {
      for (let step = 0; step < 40; step++) {
        // Repulsion
        for (let i = 0; i < populatedNodes.length; i++) {
          for (let j = i + 1; j < populatedNodes.length; j++) {
            const n1 = populatedNodes[i];
            const n2 = populatedNodes[j];
            let dx = n2.x - n1.x;
            let dy = n2.y - n1.y;
            let dist = Math.max(Math.sqrt(dx * dx + dy * dy), 35);
            if (dist < 320) {
              const force = Math.min(2000 / (dist * dist), 3.0);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              n1.vx -= fx; n1.vy -= fy;
              n2.vx += fx; n2.vy += fy;
            }
          }
        }
        // Attraction along actual WikiLink relationships (Proper opposite Newton signs!)
        visibleEdges.forEach((edge) => {
          const n1 = populatedNodes.find((n) => n.id === edge.source);
          const n2 = populatedNodes.find((n) => n.id === edge.target);
          if (n1 && n2) {
            let dx = n2.x - n1.x;
            let dy = n2.y - n1.y;
            let dist = Math.max(Math.sqrt(dx * dx + dy * dy), 35);
            const idealDist = 110;
            const force = Math.max(-3.0, Math.min(3.0, (dist - idealDist) * 0.035));
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx += fx; n1.vy += fy;
            n2.vx -= fx; n2.vy -= fy;
          }
        });
        // Damping, subtle central pull, and velocity cap
        populatedNodes.forEach((n) => {
          n.vx -= n.x * 0.004;
          n.vy -= n.y * 0.004;
          n.vx *= 0.85;
          n.vy *= 0.85;

          const speed = Math.hypot(n.vx, n.vy);
          if (speed > 5) {
            n.vx = (n.vx / speed) * 5;
            n.vy = (n.vy / speed) * 5;
          }

          n.x += n.vx;
          n.y += n.vy;

          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
            n.x = 0; n.y = 0; n.vx = 0; n.vy = 0;
          }
        });
      }
    }

    nodesRef.current = populatedNodes;
    edgesRef.current = visibleEdges;
    adjacencyRef.current = baseGraphData.adjacencyMap;
    alphaRef.current = 0.8;

    // Recalculate auto-fit when nodes change or initial mount
    const timer = setTimeout(() => {
      fitGraphToViewport(populatedNodes);
    }, 60);

    return () => clearTimeout(timer);
  }, [visibleNodes.length, baseGraphData.adjacencyMap]);

  // Handle Container Responsive Resize (e.g. sidebar collapse / expand, window resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let initialFitDone = false;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;
        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const newW = Math.floor(width * dpr);
          const newH = Math.floor(height * dpr);
          if (canvas.width !== newW || canvas.height !== newH) {
            canvas.width = newW;
            canvas.height = newH;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            if (!initialFitDone && nodesRef.current.length > 0) {
              initialFitDone = true;
              fitGraphToViewport();
            }
          }
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

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

  // Physics Simulation Tick (Organic Force-Directed with Thermal Cooling)
  const stepPhysics = () => {
    if (alphaRef.current < 0.005) return;

    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes || nodes.length === 0) return;

    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        let dist = Math.max(Math.sqrt(dx * dx + dy * dy), 35);

        if (dist < 320) {
          const force = Math.min(2000 / (dist * dist), 3.0) * alphaRef.current;
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

    // Attraction along actual WikiLink relationships (Opposite Newton signs!)
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    edges.forEach((edge) => {
      const n1 = nodeMap.get(edge.source);
      const n2 = nodeMap.get(edge.target);
      if (!n1 || !n2) return;

      let dx = n2.x - n1.x;
      let dy = n2.y - n1.y;
      let dist = Math.max(Math.sqrt(dx * dx + dy * dy), 35);

      const idealDist = 110;
      const force = Math.max(-3.0, Math.min(3.0, (dist - idealDist) * 0.035)) * alphaRef.current;
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

    // Central gravity & velocity damping
    nodes.forEach((n) => {
      if (n === draggedNodeRef.current) return;
      n.vx -= n.x * 0.004 * alphaRef.current;
      n.vy -= n.y * 0.004 * alphaRef.current;
      n.vx *= 0.85;
      n.vy *= 0.85;

      const speed = Math.hypot(n.vx, n.vy);
      if (speed > 5) {
        n.vx = (n.vx / speed) * 5;
        n.vy = (n.vy / speed) * 5;
      }

      n.x += n.vx;
      n.y += n.vy;

      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
        n.x = 0; n.y = 0; n.vx = 0; n.vy = 0;
      }
      n.x = Math.max(-1200, Math.min(1200, n.x));
      n.y = Math.max(-1200, Math.min(1200, n.y));
    });

    alphaRef.current *= 0.97;
  };

  // Render Loop Reading from Refs
  useEffect(() => {
    let animationFrameId;

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
        }

        const curZoom = zoomRef.current;
        const curPan = panRef.current;
        const curQuery = searchQueryRef.current;
        const curSelectedId = selectedNoteIdRef.current;

        // Theme aware styling configuration
        const themeAttr = document.documentElement.getAttribute('data-theme') || 'dark';
        const isDark = themeAttr !== 'light';

        const themeColors = isDark ? {
          bg: '#0d0f12',
          edgeNormal: 'rgba(148, 163, 184, 0.35)',
          edgeHighlight: '#38bdf8',
          nodeNormalFill: '#1a1f26',
          nodeNormalStroke: '#475569',
          nodeNeighborFill: '#283342',
          nodeNeighborStroke: '#94a3b8',
          nodeHighlightFill: '#0070f3',
          nodeHighlightStroke: '#ffffff',
          labelNormal: '#f0f3f6',
          labelHighlight: '#ffffff',
          labelHalo: 'rgba(13, 15, 18, 0.95)'
        } : {
          bg: '#f8fafc',
          edgeNormal: 'rgba(100, 116, 139, 0.4)',
          edgeHighlight: '#0066e6',
          nodeNormalFill: '#ffffff',
          nodeNormalStroke: '#64748b',
          nodeNeighborFill: '#e0edff',
          nodeNeighborStroke: '#2563eb',
          nodeHighlightFill: '#0066e6',
          nodeHighlightStroke: '#003d99',
          labelNormal: '#0f172a',
          labelHighlight: '#0052cc',
          labelHalo: 'rgba(248, 250, 252, 0.95)'
        };

        ctx.save();
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = themeColors.bg;
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

        // Render Edges (with strict coordinate validation)
        edges.forEach((edge) => {
          const n1 = nodeMap.get(edge.source);
          const n2 = nodeMap.get(edge.target);
          if (!n1 || !n2) return;
          if (!Number.isFinite(n1.x) || !Number.isFinite(n1.y) || !Number.isFinite(n2.x) || !Number.isFinite(n2.y)) return;
          if (Math.hypot(n2.x - n1.x, n2.y - n1.y) > 1200) return;

          const isHighlighted =
            (hoveredNode && (edge.source === hoveredNode.id || edge.target === hoveredNode.id)) ||
            (curSelectedId && (edge.source === curSelectedId || edge.target === curSelectedId));

          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = isHighlighted ? themeColors.edgeHighlight : themeColors.edgeNormal;
          ctx.lineWidth = isHighlighted ? 2.5 / curZoom : 1.2 / curZoom;
          ctx.stroke();
        });

        // Render Nodes & Labels (with finite coordinate validation)
        nodes.forEach((n) => {
          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
          const isHovered = hoveredNode?.id === n.id;
          const isSelected = curSelectedId === n.id;
          const isNeighbor = hoveredNode && adjacencies.has(n.id);
          const isSearchMatch = searchMatchSet.has(n.id);

          const radius = Math.min(8 + n.degree * 1.6, 17);

          // Node Fill & Stroke
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);

          if (isHovered || isSelected || isSearchMatch) {
            ctx.fillStyle = themeColors.nodeHighlightFill;
          } else if (isNeighbor) {
            ctx.fillStyle = themeColors.nodeNeighborFill;
          } else {
            ctx.fillStyle = themeColors.nodeNormalFill;
          }
          ctx.fill();

          // Node Border / Stroke
          ctx.lineWidth = (isHovered || isSelected ? 2.5 : 1.8) / curZoom;
          ctx.strokeStyle = (isHovered || isSelected || isSearchMatch) 
            ? themeColors.nodeHighlightStroke 
            : (isNeighbor ? themeColors.nodeNeighborStroke : themeColors.nodeNormalStroke);
          ctx.stroke();

          // Selection Outer Halo Ring
          if (isSelected || isSearchMatch) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 5 / Math.max(curZoom, 0.8), 0, Math.PI * 2);
            ctx.strokeStyle = themeColors.edgeHighlight;
            ctx.lineWidth = 2 / curZoom;
            ctx.stroke();
          }

          // Node Label
          const isLabelHighlighted = isHovered || isSelected || isNeighbor || isSearchMatch;
          const fontSize = Math.max(11, Math.min(13, 12 / Math.max(curZoom, 0.75)));
          ctx.save();
          ctx.font = `${isLabelHighlighted ? '600' : '500'} ${fontSize}px var(--font-sans, 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif)`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          const labelY = n.y + radius + 5 / Math.max(curZoom, 0.8);

          // Dual-pass text halo for guaranteed contrast across light & dark themes
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeStyle = themeColors.labelHalo;
          ctx.lineWidth = 3.5 / Math.max(curZoom, 0.8);
          ctx.strokeText(n.title, n.x, labelY);

          ctx.fillStyle = isLabelHighlighted ? themeColors.labelHighlight : themeColors.labelNormal;
          ctx.fillText(n.title, n.x, labelY);
          ctx.restore();
        });

        ctx.restore();
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
      const radius = Math.min(8 + n.degree * 1.6, 17);
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      return Math.sqrt(dx * dx + dy * dy) <= radius + 5;
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
      alphaRef.current = 0.25;
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
      const radius = Math.min(8 + n.degree * 1.6, 17);
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      return Math.sqrt(dx * dx + dy * dy) <= radius + 5;
    });

    hoveredNodeRef.current = hitNode || null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hitNode ? 'pointer' : (isDraggingCanvasRef.current ? 'grabbing' : 'default');
  };

  const handleMouseUp = (e) => {
    const { worldX, worldY } = getCanvasMousePos(e);

    if (draggedNodeRef.current) {
      const radius = Math.min(8 + draggedNodeRef.current.degree * 1.6, 17);
      const dx = draggedNodeRef.current.x - worldX;
      const dy = draggedNodeRef.current.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) <= radius + 5) {
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
    fitGraphToViewport();
  };

  const handleFitGraph = () => {
    fitGraphToViewport();
  };

  const totalNodes = visibleNodes.length;
  const totalEdges = visibleEdges.length;
  const hasZeroNotes = persistentNotes.length === 0;

  return (
    <div 
      ref={containerRef}
      className="knowledge-graph-container" 
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
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
