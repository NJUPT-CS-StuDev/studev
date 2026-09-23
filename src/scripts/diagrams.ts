type DiagramKind = 'mermaid' | 'flow' | 'sequence';

function replaceCode(pre: HTMLElement, label: string) {
  const panel = document.createElement('div');
  panel.className = 'diagram-panel';
  panel.setAttribute('role', 'img');
  panel.setAttribute('aria-label', label);
  pre.replaceWith(panel);
  return panel;
}

async function drawMermaid(blocks: HTMLElement[]) {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      primaryColor: '#f8fafd',
      primaryBorderColor: '#dadce0',
      primaryTextColor: '#202124',
      lineColor: '#5f6368',
      fontFamily: 'Google Sans, Segoe UI, Arial, Microsoft YaHei, sans-serif',
    },
  });

  for (const [index, pre] of blocks.entries()) {
    try {
      const source = pre.textContent?.trim() ?? '';
      const { svg, bindFunctions } = await mermaid.render(`studev-diagram-${index}`, source);
      const panel = replaceCode(pre, '图表');
      panel.innerHTML = svg;
      bindFunctions?.(panel);
    } catch (error) {
      console.error('Mermaid diagram:', error);
    }
  }
}

async function drawFlow(blocks: HTMLElement[]) {
  const { default: flowchart } = await import('flowchart.js');
  for (const pre of blocks) {
    try {
      const chart = flowchart.parse(pre.textContent?.trim() ?? '');
      const panel = replaceCode(pre, '流程图');
      chart.drawSVG(panel, {
        'font-family': 'Google Sans, Segoe UI, Arial, sans-serif',
        'font-size': 14,
        'line-color': '#5f6368',
        'element-color': '#dadce0',
        fill: '#fff',
      });
    } catch (error) {
      console.error('Flow diagram:', error);
    }
  }
}

async function drawSequence(blocks: HTMLElement[]) {
  const { default: raphael } = await import('raphael');
  (window as typeof window & { Raphael: typeof raphael }).Raphael = raphael;
  const { Diagram } = await import('@hackmd/js-sequence-diagrams/dist/parser/diagram.js');
  const { DiagramPainter } = await import('@hackmd/js-sequence-diagrams/dist/painter/DiagramPainter.js');
  for (const pre of blocks) {
    try {
      const diagram = Diagram.parse(pre.textContent?.trim() ?? '');
      const panel = replaceCode(pre, '时序图');
      new DiagramPainter(diagram).drawSvg(panel);
    } catch (error) {
      console.error('Sequence diagram:', error);
    }
  }
}

const diagrams = Object.fromEntries(
  (['mermaid', 'flow', 'sequence'] as DiagramKind[]).map((kind) => [
    kind,
    [...document.querySelectorAll<HTMLElement>(`.prose pre[data-language="${kind}"]`)],
  ]),
) as Record<DiagramKind, HTMLElement[]>;

if (diagrams.mermaid.length) void drawMermaid(diagrams.mermaid);
if (diagrams.flow.length) void drawFlow(diagrams.flow);
if (diagrams.sequence.length) void drawSequence(diagrams.sequence);
