// A file under packages/<name>/ may not reach another package through a relative path.
// Packages meet only by name (`@helmarray/core`), where the boundary rules can see them.
import { dirname, relative, resolve, sep } from 'node:path';

/**
 * @param {string} file
 * @param {string} root
 * @returns {string | null}
 */
function packageOf(file, root) {
  const parts = relative(root, file).split(sep);
  return parts[0] === 'packages' && parts.length > 2 ? (parts[1] ?? null) : null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow relative imports that leave the importing package' },
    schema: [],
    messages: {
      leaves:
        "'{{source}}' leaves the {{from}} package. Import another package by its name, @helmarray/<name>.",
    },
  },
  create(context) {
    const root = context.cwd;
    const file = context.physicalFilename;
    const from = packageOf(file, root);
    if (from === null) return {};

    /** @param {import('eslint').Rule.Node} node */
    function check(node) {
      const literal = 'source' in node ? node.source : null;
      const source = literal && 'value' in literal ? literal.value : undefined;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = resolve(dirname(file), source);
      if (packageOf(target, root) !== from) {
        context.report({ node, messageId: 'leaves', data: { source, from } });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};
