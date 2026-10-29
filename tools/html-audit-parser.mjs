import { parse } from 'parse5';

// Read actual HTML nodes; never delete tags with a regular expression.
export function htmlElements(html) {
  const elements=[];
  function visit(node) {
    if (node.tagName) elements.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parse(html, { sourceCodeLocationInfo:true }));
  return elements;
}
export function htmlScripts(html) {
  return htmlElements(html).filter(node=>node.tagName==='script').map(node=>({
    attrs:Object.fromEntries(node.attrs.map(attr=>[attr.name,attr.value])),
    code:node.childNodes.filter(child=>child.nodeName==='#text').map(child=>child.value).join(''),
  }));
}
export function isClassicInlineScript(attrs) {
  if ('src' in attrs) return false;
  const type=(attrs.type || '').trim().toLowerCase();
  return !type || ['text/javascript','application/javascript','text/ecmascript','application/ecmascript'].includes(type);
}
