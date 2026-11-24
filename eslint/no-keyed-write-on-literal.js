// A record keyed by data (mode, control, action, press or game ids) must never be written by key:
// `const map = {}; map[mode] = rows` makes a mode named `__proto__` the prototype instead of an
// entry, and every write in it is lost. Build such records with core's `withOwn`, with
// `Object.fromEntries`, or with `Object.create(null)`.
//
// This flags a computed write (`x[expr] = ...`), and `Object.assign(x, ...)`, onto a variable whose
// value is an object literal.
// A key that can't be data (a fixed union of names, a constant) may be allowed, with a reason, by a
// comment on the line before: `// keyed-write-ok: <why the key is never data>`.

const ALLOW = /\/\/\s*keyed-write-ok:\s*\S/;

/**
 * The value under a cast (`{} as T`, `{} satisfies T`, `<T>{}`).
 * @param {{ type: string, expression?: unknown } | null | undefined} node
 * @returns {{ type: string } | null | undefined}
 */
const unwrap = (node) =>
  node &&
  (node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSTypeAssertion')
    ? unwrap(/** @type {{ type: string }} */ (node.expression))
    : node;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow writing by computed key onto an object literal' },
    schema: [],
    messages: {
      keyed:
        "'{{name}}[…] = …' writes a key onto an object literal: a key such as __proto__ is lost. Use withOwn, Object.fromEntries or Object.create(null); or, when the key can never be data, say why in a '// keyed-write-ok: <reason>' comment on the line before.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    /** @param {import('eslint').Rule.Node} node */
    const allowed = (node) => {
      const line = node.loc?.start.line ?? 0;
      const before = source.lines[line - 2] ?? '';
      return ALLOW.test(before);
    };
    return {
      VariableDeclarator(node) {
        if (unwrap(node.init)?.type !== 'ObjectExpression') return;
        for (const variable of source.getDeclaredVariables(node)) {
          for (const ref of variable.references) {
            const id = /** @type {import('eslint').Rule.Node} */ (ref.identifier);
            const member = id.parent;
            // Object.assign(x, …) writes each key of the sources onto x the same way.
            if (
              member?.type === 'CallExpression' &&
              member.arguments[0] === id &&
              member.callee.type === 'MemberExpression' &&
              member.callee.object.type === 'Identifier' &&
              member.callee.object.name === 'Object' &&
              member.callee.property.type === 'Identifier' &&
              member.callee.property.name === 'assign'
            ) {
              const statement =
                member.parent?.type === 'ExpressionStatement' ? member.parent : member;
              if (!allowed(statement))
                context.report({ node: member, messageId: 'keyed', data: { name: variable.name } });
              continue;
            }
            if (member?.type !== 'MemberExpression' || member.object !== id || !member.computed)
              continue;
            if (member.property.type === 'Literal') continue;
            const write = member.parent;
            if (write?.type !== 'AssignmentExpression' || write.left !== member) continue;
            const statement = write.parent?.type === 'ExpressionStatement' ? write.parent : write;
            if (allowed(statement)) continue;
            context.report({ node: write, messageId: 'keyed', data: { name: variable.name } });
          }
        }
      },
    };
  },
};
