import { writeFileSync } from 'node:fs';
import { tokensCss } from '../src/shared/tokens.ts';

writeFileSync(new URL('../src/renderer/styles/tokens.css', import.meta.url), tokensCss());
