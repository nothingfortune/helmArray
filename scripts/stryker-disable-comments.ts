// The one accepted way to accept a mutant: a single-line, next-line-scoped comment that names
// its mutators and gives a reason. Anything else that mentions a Stryker directive is a fault.

/** The mutators Stryker has. A name outside this list is a typo that would disable nothing. */
export const MUTATORS: readonly string[] = [
  'ArithmeticOperator',
  'ArrayDeclaration',
  'ArrowFunction',
  'AssignmentOperator',
  'BlockStatement',
  'BooleanLiteral',
  'CallExpression',
  'ConditionalExpression',
  'EqualityOperator',
  'LogicalOperator',
  'MethodExpression',
  'ObjectLiteral',
  'OptionalChaining',
  'Regex',
  'StringLiteral',
  'UnaryOperator',
  'UpdateOperator',
];

const ACCEPTED = /^\s*\/\/ Stryker disable next-line ([A-Z][A-Za-z]+(?:,[A-Z][A-Za-z]+)*): (\S.*)$/;
const DIRECTIVE = /Stryker (?:disable|restore)\b/;
// "Hard to test" is not a reason: only an equivalent mutant, one no test can tell from the
// original, may be accepted.
const NOT_A_REASON =
  /\b(?:hard|difficult|awkward|annoying|painful) to test\b|\buntestable\b|\bnot worth\b/i;

/** The 1-based numbers of the lines holding a Stryker directive that breaks the convention. */
export function malformedStrykerDirectives(source: string): number[] {
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (!DIRECTIVE.test(line)) return [];
    const match = ACCEPTED.exec(line);
    if (match === null) return [index + 1];
    const mutators = (match[1] ?? '').split(',');
    if (!mutators.every((name) => MUTATORS.includes(name))) return [index + 1];
    if (NOT_A_REASON.test(match[2] ?? '')) return [index + 1];
    return [];
  });
}
