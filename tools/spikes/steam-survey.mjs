// Spikes 2 and 3 (docs/plans/04-roadmap.md, M0): survey the Steam library on this machine.
// Read-only. Writes JSON to stdout: per installed game, where its cover art is and what default
// controls can be read. Spike code, not product code: M4 and M5 rebuild what is kept, with tests.
//
//   node tools/spikes/steam-survey.mjs > survey.json

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseBinary, parseText } from './vdf.mjs';

/** @typedef {import('./vdf.mjs').KV} KV */

function steamPath() {
  const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
    encoding: 'utf8',
  });
  const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
  if (!match?.[1]) throw new Error('SteamPath not found in the registry');
  return match[1].trim().replaceAll('/', '\\');
}

/** @param {unknown} v @returns {KV} */
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? /** @type {KV} */ (v) : {});

const steam = steamPath();
const libraries = Object.values(
  obj(
    parseText(readFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8'))[
      'libraryfolders'
    ],
  ),
).map((lib) => String(obj(lib)['path']));

// Cover art: appcache/librarycache/assetcache.vdf maps each app to its cached files.
// Slot keys seen: 0 portrait capsule, 1 hero, 2 logo, 3 header, 4 icon, 5 hero blur.
const cacheDir = join(steam, 'appcache', 'librarycache');
const assetIndexPath = join(cacheDir, 'assetcache.vdf');
/** @type {Record<string, KV>} */
const assetIndex = {};
if (existsSync(assetIndexPath)) {
  /** @param {KV} node */
  const walk = (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (
        /^\d+$/.test(key) &&
        Number(key) > 1000 &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        if (Object.keys(value).some((k) => /^\d+f$/.test(k))) assetIndex[key] = value;
        else walk(value);
      } else if (typeof value === 'object' && !Array.isArray(value)) walk(value);
    }
  };
  walk(parseBinary(readFileSync(assetIndexPath)));
}
const SLOTS = {
  '0f': 'capsule',
  '1f': 'hero',
  '2f': 'logo',
  '3f': 'header',
  '4f': 'icon',
  '5f': 'heroBlur',
};

/** @param {string} appid */
function covers(appid) {
  const dir = join(cacheDir, appid);
  /** @type {Record<string, string | null>} */
  const fromIndex = {};
  const entry = assetIndex[appid] ?? {};
  for (const [slot, name] of Object.entries(SLOTS)) {
    const file = entry[slot];
    fromIndex[name] = typeof file === 'string' && existsSync(join(dir, file)) ? file : null;
  }
  /** @type {string[]} */
  const found = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      if (/\.(jpg|png)$/i.test(name)) found.push(name.replaceAll('\\', '/'));
    }
  }
  const portraitByName = found.find((f) => /library_(600x900|capsule)\.jpg$/.test(f)) ?? null;
  return { inIndex: appid in assetIndex, fromIndex, portraitByName, files: found };
}

// Steam Input: configset_*.vdf say which config each app uses; workshop 241100 caches them.
const configRoot = join(steam, 'steamapps', 'common', 'Steam Controller Configs');
/** @type {Record<string, { configset: string; source: string; value: string }[]>} */
const steamInput = {};
if (existsSync(configRoot)) {
  for (const account of readdirSync(configRoot)) {
    const dir = join(configRoot, account, 'config');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(
      (f) => f.startsWith('configset_') && f.endsWith('.vdf'),
    )) {
      const sets = obj(parseText(readFileSync(join(dir, file), 'utf8'))['controller_config']);
      for (const [app, value] of Object.entries(sets)) {
        for (const [source, id] of Object.entries(obj(value))) {
          (steamInput[app] ??= []).push({ configset: file, source, value: String(id) });
        }
      }
    }
  }
}
const workshopDir = join(steam, 'steamapps', 'workshop', 'content', '241100');

/** @param {string} id */
function workshopConfig(id) {
  const dir = join(workshopDir, id);
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file)).toString('utf8');
    if (!text.includes('"controller_mappings"')) return { file, readable: false };
    const keyPresses = (text.match(/key_press [A-Z0-9_]+, [^"]+/g) ?? []).length;
    const xinput = (text.match(/xinput_button [A-Z_]+/g) ?? []).length;
    return { file, readable: true, keyPressesWithLabels: keyPresses, xinputBindings: xinput };
  }
  return null;
}

// Defaults inside the install folder.
/** @param {string} root */
function walkFiles(root, maxDepth = 7, limit = 60000) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

const localAppData = process.env['LOCALAPPDATA'] ?? '';
// Stock Unreal mappings, plus Everspace 2's own KeybindingsConfig lines.
const BINDING_LINES = /ActionMappings|AxisMappings|ActionKeyMappings|KeybindingsConfig=/;

/** @param {string} installDir */
function harvest(installDir) {
  const files = walkFiles(installDir);
  const rel = (/** @type {string} */ f) => relative(installDir, f).replaceAll('\\', '/');
  const engine = files.some((f) => /UnityPlayer\.dll$/i.test(f))
    ? 'unity'
    : files.some((f) => /[\\/]Content[\\/]Paks[\\/].+\.(pak|utoc)$/i.test(f))
      ? 'unreal'
      : files.some((f) => /\.binds$/i.test(f))
        ? 'cobra (elite)'
        : 'other';
  const binds = files.filter((f) => /\.binds$/i.test(f)).map(rel);
  const unrealIni = files
    .filter((f) => /(^|[\\/])(Default|Base)?Input\.ini$/i.test(f))
    .filter((f) => {
      try {
        return BINDING_LINES.test(readFileSync(f, 'utf8'));
      } catch {
        return false;
      }
    })
    .map(rel);
  const gameActions = files.filter((f) => /game_actions_\d+\.vdf$/i.test(f)).map(rel);
  const otherConfigs = files
    .filter((f) =>
      /(keybind|binding|controls|input|keymap)[^\\/]*\.(json|xml|cfg|ini|txt|yaml|yml)$/i.test(f),
    )
    .filter((f) => !/\.binds$/i.test(f))
    .map(rel)
    .filter((f) => !unrealIni.includes(f))
    .slice(0, 12);
  // Unreal projects keep the player's input in %LOCALAPPDATA%/<Project>/Saved/Config.
  const projects = new Set(
    files
      .map((f) => /([^\\/]+)[\\/]Content[\\/]Paks[\\/]/i.exec(rel(f))?.[1])
      .filter((p) => typeof p === 'string'),
  );
  /** @type {string[]} */
  const userInput = [];
  for (const project of projects) {
    const config = join(localAppData, project, 'Saved', 'Config');
    if (!existsSync(config)) continue;
    for (const platform of readdirSync(config)) {
      const ini = join(config, platform, 'Input.ini');
      if (!existsSync(ini)) continue;
      const lines = readFileSync(ini, 'utf8')
        .split(/\r?\n/)
        .filter((l) => BINDING_LINES.test(l)).length;
      userInput.push(
        `%LOCALAPPDATA%/${project}/Saved/Config/${platform}/Input.ini: ${lines} binding lines`,
      );
    }
  }
  return {
    engine,
    fileCount: files.length,
    binds: binds.slice(0, 12),
    bindsCount: binds.length,
    unrealIni,
    gameActions,
    otherConfigs,
    userInput,
  };
}

const games = [];
for (const lib of libraries) {
  const steamapps = join(lib, 'steamapps');
  if (!existsSync(steamapps)) continue;
  for (const manifest of readdirSync(steamapps).filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
    const state = obj(parseText(readFileSync(join(steamapps, manifest), 'utf8'))['AppState']);
    const appid = String(state['appid']);
    const installDir = join(steamapps, 'common', String(state['installdir']));
    const configs = (steamInput[appid] ?? []).map((c) => ({
      ...c,
      cached: c.source === 'workshop' ? workshopConfig(c.value) : null,
    }));
    games.push({
      appid,
      name: String(state['name']),
      library: lib,
      installed: existsSync(installDir),
      covers: covers(appid),
      steamInput: configs,
      defaults: existsSync(installDir) ? harvest(installDir) : null,
    });
  }
}

process.stdout.write(
  JSON.stringify(
    { steam, libraries, assetIndexEntries: Object.keys(assetIndex).length, games },
    null,
    2,
  ),
);
