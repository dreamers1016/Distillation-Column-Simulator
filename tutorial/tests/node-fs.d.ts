// The one Node API the tests use (no @types/node in this project): reading a source file as text.
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
