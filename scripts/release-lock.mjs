import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const version = JSON.parse(readFileSync('manifest.json')).version;
const assets = ['main.js','manifest.json','styles.css','validation.cjs','runtime.zip','agent-plugin.zip','installer.py'];
writeFileSync('dist/tools.lock.json', JSON.stringify({repository:'yiju-zhao/noteweaver',version,schema_version:3,
  source_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  assets:Object.fromEntries(assets.map(name=>[name,createHash('sha256').update(readFileSync('dist/'+name)).digest('hex')]))},null,2)+'\n');
