import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const win = process.platform === 'win32';
const r = spawnSync(win ? 'gradlew.bat' : './gradlew', process.argv.slice(2), { cwd: join(process.cwd(), 'android'), stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
