type DiagramKind = 'flow' | 'sequence';
type DiagramBlock = { pre: HTMLElement; source: string; panel?: HTMLElement; kind: DiagramKind };

function panelFor(block: DiagramBlock) {
  if (block.panel) return block.panel;
  const panel = document.createElement('div');
  panel.className = 'diagram-panel';
  panel.dataset.diagram = block.kind;
  panel.setAttribute('role', 'img');
  panel.setAttribute('aria-label', block.kind === 'flow' ? '流程图' : '时序图');
  block.pre.replaceWith(panel);
  block.panel = panel;
  return panel;
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(['ink', 'muted', 'line', 'diagram-bg'].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

async function draw(block: DiagramBlock) {
  if (block.kind === 'flow') {
    const { default: flowchart } = await import('flowchart.js');
    const palette = colors();
    const panel = panelFor(block);
    panel.replaceChildren();
    flowchart.parse(block.source).drawSVG(panel, {
      'font-family': 'Segoe UI, Arial, sans-serif',
      'font-size': 14,
      'line-color': palette.muted,
      'element-color': palette.line,
      'font-color': palette.ink,
      fill: palette['diagram-bg'],
    });
  } else {
    const { default: raphael } = await import('raphael');
    (window as typeof window & { Raphael: typeof raphael }).Raphael = raphael;
    const { Diagram } = await import('@hackmd/js-sequence-diagrams/dist/parser/diagram.js');
    const { DiagramPainter } = await import('@hackmd/js-sequence-diagrams/dist/painter/DiagramPainter.js');
    new DiagramPainter(Diagram.parse(block.source)).drawSvg(panelFor(block));
  }
}

const blocks: DiagramBlock[] = [...document.querySelectorAll<HTMLElement>('.prose pre[data-language="flow"], .prose pre[data-language="sequence"]')]
  .map((pre) => ({ pre, source: pre.textContent?.trim() ?? '', kind: pre.dataset.language as DiagramKind }));

if (blocks.length) {
  let queue = Promise.resolve();
  const render = (block: DiagramBlock) => {
    queue = queue.then(() => draw(block)).catch((error) => console.error(`${block.kind} diagram:`, error));
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const block = blocks.find(({ pre }) => pre === entry.target);
      if (block) render(block);
    }
  }, { rootMargin: '300px' });
  blocks.forEach(({ pre }) => observer.observe(pre));
  document.addEventListener('site:theme-change', () => {
    blocks.filter((block) => block.kind === 'flow' && block.panel).forEach(render);
  });
}
