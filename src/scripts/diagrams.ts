type DiagramKind = 'mermaid' | 'flow' | 'sequence';
type DiagramBlock = { pre: HTMLElement; source: string; panel?: HTMLElement };

function panelFor(block: DiagramBlock, label: string, kind: DiagramKind) {
  if (block.panel) return block.panel;
  const panel = document.createElement('div');
  panel.className = 'diagram-panel';
  panel.dataset.diagram = kind;
  panel.setAttribute('role', 'img');
  panel.setAttribute('aria-label', label);
  block.pre.replaceWith(panel);
  block.panel = panel;
  return panel;
}

function diagramColors() {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(['ink', 'muted', 'line', 'diagram-bg'].map((name) => [name, styles.getPropertyValue(`--${name}`).trim()])) as Record<string, string>;
}

async function drawMermaid(blocks: DiagramBlock[], generation: number) {
  const { default: mermaid } = await import('mermaid');
  const colors = diagramColors();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      primaryColor: colors['diagram-bg'],
      primaryBorderColor: colors.line,
      primaryTextColor: colors.ink,
      secondaryColor: colors['diagram-bg'],
      tertiaryColor: colors['diagram-bg'],
      lineColor: colors.muted,
      textColor: colors.ink,
      background: colors['diagram-bg'],
      fontFamily: 'Google Sans, Segoe UI, Arial, Microsoft YaHei, sans-serif',
    },
  });

  for (const [index, block] of blocks.entries()) {
    try {
      const { svg, bindFunctions } = await mermaid.render(`studev-diagram-${generation}-${index}`, block.source);
      const panel = panelFor(block, '图表', 'mermaid');
      panel.innerHTML = svg;
      bindFunctions?.(panel);
    } catch (error) {
      console.error('Mermaid diagram:', error);
    }
  }
}

async function drawFlow(blocks: DiagramBlock[]) {
  const { default: flowchart } = await import('flowchart.js');
  const colors = diagramColors();
  for (const block of blocks) {
    try {
      const chart = flowchart.parse(block.source);
      const panel = panelFor(block, '流程图', 'flow');
      panel.replaceChildren();
      chart.drawSVG(panel, {
        'font-family': 'Google Sans, Segoe UI, Arial, sans-serif',
        'font-size': 14,
        'line-color': colors.muted,
        'element-color': colors.line,
        'font-color': colors.ink,
        fill: colors['diagram-bg'],
      });
    } catch (error) {
      console.error('Flow diagram:', error);
    }
  }
}

async function drawSequence(blocks: DiagramBlock[]) {
  const { default: raphael } = await import('raphael');
  (window as typeof window & { Raphael: typeof raphael }).Raphael = raphael;
  const { Diagram } = await import('@hackmd/js-sequence-diagrams/dist/parser/diagram.js');
  const { DiagramPainter } = await import('@hackmd/js-sequence-diagrams/dist/painter/DiagramPainter.js');
  for (const block of blocks) {
    try {
      const diagram = Diagram.parse(block.source);
      const panel = panelFor(block, '时序图', 'sequence');
      new DiagramPainter(diagram).drawSvg(panel);
    } catch (error) {
      console.error('Sequence diagram:', error);
    }
  }
}

const diagrams = Object.fromEntries(
  (['mermaid', 'flow', 'sequence'] as DiagramKind[]).map((kind) => [
    kind,
    [...document.querySelectorAll<HTMLElement>(`.prose pre[data-language="${kind}"]`)].map((pre) => ({ pre, source: pre.textContent?.trim() ?? '' })),
  ]),
) as Record<DiagramKind, DiagramBlock[]>;

let renderCount = 0;
let mermaidQueue = Promise.resolve();
let flowQueue = Promise.resolve();
function renderMermaid() {
  if (!diagrams.mermaid.length) return;
  const generation = ++renderCount;
  mermaidQueue = mermaidQueue.then(() => drawMermaid(diagrams.mermaid, generation)).catch((error) => console.error('Mermaid diagram:', error));
}
function renderFlow() {
  if (!diagrams.flow.length) return;
  flowQueue = flowQueue.then(() => drawFlow(diagrams.flow)).catch((error) => console.error('Flow diagram:', error));
}

renderMermaid();
renderFlow();
if (diagrams.sequence.length) void drawSequence(diagrams.sequence);
document.addEventListener('site:theme-change', () => {
  renderMermaid();
  renderFlow();
});
