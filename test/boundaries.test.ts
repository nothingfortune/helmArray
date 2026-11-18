import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function problems(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

const restricted = '@typescript-eslint/no-restricted-imports';
const relative = 'helm/no-cross-package-relative';

describe('package boundaries', () => {
  describe('core', () => {
    const file = 'packages/core/src/model/scheme.ts';

    it('may import its own files', async () => {
      expect(await problems(file, "export { a } from './a';\n")).toEqual([]);
      expect(await problems(file, "export { b } from '../b';\n")).toEqual([]);
    });

    it.each([
      "import { readFileSync } from 'node:fs';",
      "import { readFileSync } from 'fs';",
      "import type { Signal } from '@helmarray/azeron';",
      "import { z } from 'zod';",
    ])('refuses %s', async (line) => {
      expect(await problems(file, `${line}\nexport {};\n`)).toContain(restricted);
    });

    it('refuses to reach another package by a relative path', async () => {
      expect(await problems(file, "export { x } from '../../../azeron/src/x';\n")).toContain(
        relative,
      );
    });
  });

  describe.each(['azeron', 'games'])('%s', (pkg) => {
    const file = `packages/${pkg}/src/index.ts`;

    it('may import types from core', async () => {
      expect(
        await problems(
          file,
          "import type { Scheme } from '@helmarray/core';\nexport type S = Scheme;\n",
        ),
      ).toEqual([]);
    });

    it.each([
      "import { resolve } from '@helmarray/core';",
      "import { readFileSync } from 'node:fs';",
      "import HID from 'node-hid';",
      "import { app } from 'electron';",
    ])('refuses %s', async (line) => {
      expect(await problems(file, `${line}\nexport {};\n`)).toContain(restricted);
    });

    it('refuses to reach core by a relative path', async () => {
      expect(await problems(file, "export type { S } from '../../core/src/s';\n")).toContain(
        relative,
      );
    });
  });

  describe('app', () => {
    it.each([
      "import { ipcRenderer } from 'electron';",
      "import { readFileSync } from 'node:fs';",
      "import path from 'path';",
      "import type { Session } from '@helmarray/azeron';",
      "import { harvest } from '@helmarray/games';",
    ])('the windows refuse %s', async (line) => {
      expect(await problems('packages/app/src/renderer/x.ts', `${line}\nexport {};\n`)).toContain(
        restricted,
      );
    });

    it('the windows may use core, React and their own files', async () => {
      const code =
        "import type { Scheme } from '@helmarray/core';\nimport { useState } from 'react';\nimport './a.css';\nexport type S = Scheme;\nexport const u = useState;\n";
      expect(await problems('packages/app/src/renderer/x.ts', code)).toEqual([]);
    });

    it('shared code is pure', async () => {
      expect(
        await problems(
          'packages/app/src/shared/x.ts',
          "import { app } from 'electron';\nexport {};\n",
        ),
      ).toContain(restricted);
    });

    it('main may do I/O', async () => {
      const code =
        "import { readFileSync } from 'node:fs';\nimport { app } from 'electron';\nexport { readFileSync, app };\n";
      expect(await problems('packages/app/src/main/x.ts', code)).toEqual([]);
    });
  });
});
