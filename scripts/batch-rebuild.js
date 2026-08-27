const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

function run(cmd) {
  console.log(`> ${cmd}`);
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (out.trim()) console.log(out.trim());
}

const steps = [
  { version: 'v0.1.0', source: '8d89183', msgFile: path.join(os.tmpdir(), 'msg_1.txt') },
  { version: 'v0.2.0', source: '9642613', msgFile: path.join(os.tmpdir(), 'msg_2.txt') },
  { version: 'v0.3.0', source: 'a6026a4', msgFile: path.join(os.tmpdir(), 'msg_3.txt') },
  { version: 'v0.3.5', source: '3be9d0f', msgFile: path.join(os.tmpdir(), 'msg_4.txt') },
  { version: 'v0.4.0', source: '00c2d34', msgFile: path.join(os.tmpdir(), 'msg_5.txt') },
  { version: 'v0.5.0', source: 'staging/clean-v0.5.0', msgFile: path.join(os.tmpdir(), 'msg_6.txt') }
];

console.log('=== Step 1: Checkout main and reset to initial commit ===');
run('git checkout main');
run('git reset --hard ebd7e6b');

steps.forEach((s, idx) => {
  console.log(`\n=== Batch ${idx + 1} / 6: Rebuilding ${s.version} from ${s.source} ===`);
  run('git rm -rf .');
  run(`git checkout ${s.source} -- .`);
  run('git add -A');
  run(`git commit -F "${s.msgFile}"`);
  run(`git tag -f -a ${s.version} HEAD -m "Release ${s.version}"`);
});

console.log('\n=== Step 3: Align dev branch to main ===');
run('git checkout dev');
run('git reset --hard main');
run('git checkout main');

console.log('\n=== Batch Rebuild Successfully Completed ===');
