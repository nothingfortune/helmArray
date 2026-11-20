// Starts the built app for a test: a temp data folder, a fake Steam folder inside it, the two
// fake units already told apart, and HELM_E2E=1 so real HID can't be reached (the seam is
// src/main/e2e-seam.ts). Every launched app is closed, and its folder removed, when the test ends.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import type { E2eControl, FakeUnitView } from '../src/main/e2e-fakes';
import { E2E_UNIT_IDS } from '../src/main/e2e-seam';

const APP_DIR = resolve(import.meta.dirname, '..');
// `require('electron')` in Node is the path of the binary; nothing of electron is imported here.
const electronBinary = createRequire(import.meta.url)('electron') as string;

export const HELLDIVERS_APP_ID = '553850';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function steamFolder(steamDir: string): Promise<void> {
  const app = (id: string, name: string, dir: string) =>
    `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${dir}"\n}\n`;
  const apps = join(steamDir, 'steamapps');
  await mkdir(apps, { recursive: true });
  await writeFile(
    join(apps, `appmanifest_${HELLDIVERS_APP_ID}.acf`),
    app(HELLDIVERS_APP_ID, 'HELLDIVERS™ 2', 'Helldivers 2'),
  );
  await writeFile(
    join(apps, 'appmanifest_1245620.acf'),
    app('1245620', 'A Game Nobody Wrote Yet', 'Other'),
  );
  const covers = join(steamDir, 'appcache', 'librarycache', HELLDIVERS_APP_ID);
  await mkdir(covers, { recursive: true });
  await writeFile(join(covers, 'library_600x900.jpg'), PNG_1X1);
}

export interface Helm {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
  /** What the fake units hold now. */
  units(): Promise<FakeUnitView[]>;
  /** The programs the fake process list says are running, besides the usual ones. */
  setProcesses(names: string[]): Promise<void>;
  /** The HID paths the fake backend was asked to open. */
  opened(): Promise<string[]>;
}

async function launch(): Promise<{ helm: Helm; close(): Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'helm-e2e-'));
  await steamFolder(join(dataDir, 'steam'));
  // Which unit is which hand is already known: first run is not what these tests are about.
  await writeFile(
    join(dataDir, 'hands.json'),
    JSON.stringify({
      [E2E_UNIT_IDS.left]: 'left',
      [E2E_UNIT_IDS.right]: 'right',
    }),
  );

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A dev server or a Node-mode electron from the caller's shell would change what is run.
    if (value !== undefined && !/^ELECTRON_(RENDERER_URL|RUN_AS_NODE)$/.test(key)) env[key] = value;
  }
  env['HELM_E2E'] = '1';
  env['HELM_E2E_DIR'] = dataDir;

  const launched = await electron
    .launch({
      executablePath: electronBinary,
      args: [APP_DIR],
      cwd: APP_DIR,
      env,
      // The page's language, so the words asserted on are the ones asserted on everywhere.
      locale: 'en-US',
      timeout: 30_000,
    })
    .catch(async (error: unknown) => {
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    });
  const pid = launched.process().pid;
  // If the worker is killed (a hung test), the app must not outlive it.
  const reap = () => {
    if (pid !== undefined && launched.process().exitCode === null) killTree(pid);
  };
  process.once('exit', reap);
  const close = async () => {
    await shutDown(launched, pid);
    process.off('exit', reap);
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
      () => undefined,
    );
  };
  try {
    const page = await launched.firstWindow();
    await launched.context().tracing.start({ screenshots: true, snapshots: true });
    // The page-less side of the fakes, kept on a global of the main process (e2e-fakes.ts). The
    // functions run in that process, so they can't use anything from here: the global's name
    // (`helmE2E`, E2E_CONTROL_GLOBAL) is written out in them.
    const helm: Helm = {
      app: launched,
      page,
      dataDir,
      units: () =>
        launched.evaluate(() => (globalThis as unknown as { helmE2E: E2eControl }).helmE2E.units()),
      setProcesses: (names) =>
        launched.evaluate(
          (_electron, list) =>
            (globalThis as unknown as { helmE2E: E2eControl }).helmE2E.setProcesses(list),
          names,
        ),
      opened: () =>
        launched.evaluate(() =>
          (globalThis as unknown as { helmE2E: E2eControl }).helmE2E.opened(),
        ),
    };
    return { helm, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const CLOSE_MS = 10_000;
/** What a failed test's evidence may take: it never holds up the closing of the app. */
const EVIDENCE_MS = 8000;

const within = <T>(work: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([
    work.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);

/**
 * Closes the app, and makes sure no Electron process is left: if closing doesn't finish in time,
 * or the process is still there afterwards, its whole tree is killed by PID.
 */
async function shutDown(app: ElectronApplication, pid: number | undefined): Promise<void> {
  const child = app.process();
  const closed = app.close().then(
    () => true,
    () => true,
  );
  const timedOut = new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_MS));
  const clean = await Promise.race([closed, timedOut]);
  if (clean && child.exitCode !== null) return;
  if (pid !== undefined) killTree(pid);
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

export const test = base.extend<{ helm: Helm }>({
  // Playwright wants the fixtures argument destructured, even with nothing to take from it.
  // eslint-disable-next-line no-empty-pattern
  helm: async ({}, use, testInfo) => {
    const { helm, close } = await launch();
    try {
      await use(helm);
    } finally {
      try {
        // What a failed test leaves to look at: its trace and a screenshot of the window. (No
        // video: Playwright's recorder needs ffmpeg, which comes with its browser download.)
        // A test that is meant to fail (`test.fail`) counts as passing. Each step is bounded, so
        // nothing here can keep the app from being closed below.
        const tracing = helm.app.context().tracing;
        if (testInfo.status !== testInfo.expectedStatus) {
          const trace = testInfo.outputPath('trace.zip');
          await within(tracing.stop({ path: trace }), EVIDENCE_MS);
          await testInfo
            .attach('trace', { path: trace, contentType: 'application/zip' })
            .catch(() => undefined);
          const png = testInfo.outputPath('window.png');
          await within(helm.page.screenshot({ path: png }), EVIDENCE_MS);
          await testInfo
            .attach('window', { path: png, contentType: 'image/png' })
            .catch(() => undefined);
        } else {
          await within(tracing.stop(), EVIDENCE_MS);
        }
      } finally {
        await close();
      }
    }
  },
});

export { expect } from '@playwright/test';
