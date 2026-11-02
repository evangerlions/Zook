import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createGrowStaticHandler } from '../apps/admin-web/grow-static.ts';
function argument(name: string) { const index = process.argv.indexOf(name); const value = process.argv[index + 1]; if (index < 0 || !value || value.startsWith('--')) throw Error('Missing ' + name); return value; }
const source = resolve(argument('--artifact'));
const expectedSource = argument('--source-revision'), expectedContract = argument('--contract-revision');
const destination = resolve('static/grow');
const manifest = JSON.parse(readFileSync(join(source, 'grow-manifest.json'), 'utf8'));
if (manifest.source_revision !== expectedSource || manifest.contract_revision !== expectedContract) throw Error('Artifact revision does not match the reviewed release pair');
if (manifest.source_dirty && !process.argv.includes('--allow-dirty')) throw Error('A dirty source artifact is only allowed for explicit local verification');
createGrowStaticHandler({ growEnabled: true, growRoot: source });
mkdirSync(dirname(destination), { recursive: true });
const stage = mkdtempSync(join(dirname(destination), '.grow-stage-'));
const previous = destination + '.previous';
try {
  for (const name of [...Object.keys(manifest.files), 'grow-manifest.json']) { mkdirSync(dirname(join(stage, name)), { recursive: true }); cpSync(join(source, name), join(stage, name)); }
  createGrowStaticHandler({ growEnabled: true, growRoot: stage });
  if (existsSync(previous)) throw Error('Previous artifact backup exists; review before replacing it');
  if (existsSync(destination)) renameSync(destination, previous);
  try { renameSync(stage, destination); } catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error; }
  if (existsSync(previous)) rmSync(previous, { recursive: true });
  console.log('Installed fixed LightTick Web artifact: ' + manifest.source_revision);
} finally { if (existsSync(stage)) rmSync(stage, { recursive: true }); }
