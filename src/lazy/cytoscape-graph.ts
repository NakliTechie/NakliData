// Lazy chunk for Cytoscape.js — renders the taxonomy type-relationship
// graph into a container. Loaded only when the user opens the Schema
// Graph modal, so Cytoscape itself never touches the inlined shell.

import cytoscape from 'cytoscape';
import { Neutral } from '../tokens/colors.ts';

export interface GraphNode {
  id: string;
  label: string;
  domain?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Relationship kind shown as the edge label. */
  kind: string;
  note?: string;
}

export interface MountGraphOpts {
  container: HTMLElement;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Optional click handler — receives the clicked node's id. */
  onNodeClick?: (id: string) => void;
}

export interface GraphHandle {
  destroy: () => void;
  /** Re-layout the graph (useful after the container resizes). */
  refit: () => void;
}

const ACCENT = '#B5371C';
const ACCENT_DIM = '#E9C1B5';
const TEXT = Neutral.text;
const TEXT_MUTED = Neutral.textMuted;
const SURFACE_ALT = Neutral.surfaceAlt;

export function mountGraph({ container, nodes, edges, onNodeClick }: MountGraphOpts): GraphHandle {
  const cy = cytoscape({
    container,
    elements: [
      ...nodes.map((n) => ({
        data: { id: n.id, label: n.label, domain: n.domain ?? '' },
      })),
      ...edges.map((e) => ({
        data: {
          id: `${e.source}->${e.target}->${e.kind}`,
          source: e.source,
          target: e.target,
          label: e.kind,
          note: e.note ?? '',
        },
      })),
    ],
    style: [
      {
        selector: 'node',
        style: {
          'background-color': SURFACE_ALT,
          'border-width': 1.5,
          'border-color': ACCENT_DIM,
          color: TEXT,
          label: 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'font-size': 12,
          'font-family':
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '10px',
          shape: 'round-rectangle',
          width: 'label',
          height: 'label',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'background-color': ACCENT_DIM,
          'border-color': ACCENT,
          'border-width': 2,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.5,
          'line-color': ACCENT_DIM,
          'target-arrow-color': ACCENT_DIM,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          color: TEXT_MUTED,
          'font-size': 10,
          'text-rotation': 'autorotate',
          'text-background-color': SURFACE_ALT,
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
        },
      },
    ],
    layout: {
      name: 'cose',
      animate: false,
      idealEdgeLength: () => 120,
      nodeRepulsion: () => 8000,
      padding: 24,
    },
    wheelSensitivity: 0.2,
  });

  if (onNodeClick) {
    cy.on('tap', 'node', (ev) => {
      const id = ev.target.id() as string;
      onNodeClick(id);
    });
  }

  return {
    destroy: () => cy.destroy(),
    refit: () => cy.fit(undefined, 24),
  };
}
