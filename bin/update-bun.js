import { readFileSync, writeFileSync } from 'fs';

const packageJsonPath = './package.json';

console.log('🔄 Upgrading Bun to latest stable version...');
await Bun.$`bun upgrade`;

const newVersion = (await Bun.$`bun --version`.text()).trim();
console.log(`✅ Bun upgraded to version ${newVersion}`);

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
packageJson.packageManager = `bun@${newVersion}`;

writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`📦 package.json updated with bun@${newVersion}`);
