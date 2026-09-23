// Typora's highlight, subscript, and superscript syntax is not part of GFM.
const inlinePattern = /==([^=\n]+)==|~([^~\s][^~\n]*?)~|\^([^\^\s][^\^\n]*?)\^/g;

function transform(parent) {
  if (!Array.isArray(parent.children)) return;

  parent.children = parent.children.flatMap((node) => {
    if (node.type !== 'text') {
      if (!['code', 'inlineCode', 'math', 'inlineMath'].includes(node.type)) transform(node);
      return [node];
    }

    const result = [];
    let start = 0;
    for (const match of node.value.matchAll(inlinePattern)) {
      if (match.index > start) result.push({ type: 'text', value: node.value.slice(start, match.index) });
      const tag = match[1] ? 'mark' : match[2] ? 'sub' : 'sup';
      result.push({ type: tag, data: { hName: tag }, children: [{ type: 'text', value: match[1] ?? match[2] ?? match[3] }] });
      start = match.index + match[0].length;
    }
    if (start < node.value.length) result.push({ type: 'text', value: node.value.slice(start) });
    return result.length ? result : [node];
  });
}

export default function remarkTyporaInline() {
  return transform;
}
