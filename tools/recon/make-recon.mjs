// Builds the three Recon profiles of 2026-11-19 (reference/captures/2026-11-19/imported/) from
// the owner's 2026-11-13 Recon export: node tools/recon/make-recon.mjs <export.json> <out dir>.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const [templatePath, outDir] = process.argv.slice(2);
const template = JSON.parse(readFileSync(templatePath, 'utf8'));
const base = template.profiles[0];
const clone = (o) => JSON.parse(JSON.stringify(o));
const empty = clone(base.inputs.find((i) => i.id === 2)); // a Disabled key, as the app writes one
const stickBase = clone(base.inputs.find((i) => i.id === 24));
const UNKNOWN = new Set([0, 28, 29, 255]);

function profile(name, edit) {
  const p = clone(base);
  p.id = randomUUID();
  p.name = name;
  p.systemTags = [];
  p.profileTags = [];
  p.inputs = p.inputs.map((input) => {
    if (UNKNOWN.has(input.pinOne) || input.id === 24) return input;
    const blank = clone(empty);
    blank.id = input.id;
    blank.pinOne = input.pinOne;
    blank.pinTwo = input.pinTwo;
    delete blank.label;
    return blank;
  });
  const byId = (id) => p.inputs.find((i) => i.id === id);
  const stick = clone(stickBase);
  for (const side of ['left', 'right'])
    for (const d of Object.keys(stick.analogSettings.analogKeys[side]))
      stick.analogSettings.analogKeys[side][d] = [0, 0, 0];
  Object.assign(stick.analogSettings, { mouseSensitivity: 5, angle: 0 });
  p.inputs[p.inputs.findIndex((i) => i.id === 24)] = stick;
  edit(byId, stick);
  return { version: '2.0.3', profiles: [p] };
}

const key = (input, label, fields) => Object.assign(input, fields, { label });

const left = profile('Recon L', (byId, stick) => {
  stick.types = ['21', '0', '0'];
  stick.analogSettings.isRightAnalog = true;
  stick.label = 'Xbox RIGHT stick?';
  key(byId(1), 'mouse back (4)', { types: ['15', '6', '6'], keyValues: ['4', '0', '0', '0'] });
  key(byId(2), 'mouse forward (5)', { types: ['15', '6', '6'], keyValues: ['5', '0', '0', '0'] });
  key(byId(3), 'scroll up (20)', {
    types: ['35', '6', '6'],
    x: 0,
    y: 1,
    interval: 150,
    yInterval: 120,
  });
  key(byId(4), 'scroll down (70)', {
    types: ['35', '6', '6'],
    x: 0,
    y: -1,
    interval: 150,
    yInterval: 45,
  });
  key(byId(5), 'chord Q+W', { types: ['1', '6', '6'], keyValues: ['KeyQ', 'KeyW', '0', '0'] });
  key(byId(6), 'chord ASDF+Ctrl+Shift+Alt', {
    types: ['1', '6', '6'],
    keyValues: ['KeyA', 'KeyS', 'KeyD', 'KeyF'],
    metaValues: ['ControlLeft', 'ShiftLeft', 'AltLeft'],
  });
  key(byId(7), 'SET ME: Xbox L-stick UP', {});
  key(byId(9), 'SET ME: Xbox R-stick RIGHT', {});
});

const right = (name, rightStick) =>
  profile(name, (byId, stick) => {
    stick.types = ['21', '0', '0'];
    Object.assign(stick.analogSettings, { isRightAnalog: rightStick, angle: 176 });
    stick.label = rightStick ? 'Xbox RIGHT stick?' : 'Xbox LEFT stick?';
  });

const files = {
  'Recon-L.json': left,
  'Recon-R-right.json': right('Recon R right', true),
  'Recon-R-left.json': right('Recon R left', false),
};
for (const [file, doc] of Object.entries(files))
  writeFileSync(`${outDir}/${file}`, JSON.stringify(doc, null, 2));
console.log(Object.keys(files).join('\n'));
