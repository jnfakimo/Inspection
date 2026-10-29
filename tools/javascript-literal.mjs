// Safe even if a future caller embeds the generated JavaScript inside HTML.
export function javascriptStringLiteral(value) {
  return JSON.stringify(String(value)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
