import { existsSync, writeFileSync } from 'fs';
import algosdk from 'algosdk';

if (existsSync('.env')) {
  console.log('.env already exists, not overwriting it.');
  process.exit(0);
}

const account = algosdk.generateAccount();
const mnemonic = algosdk.secretKeyToMnemonic(account.sk);

writeFileSync('.env', `DEPLOYER_MNEMONIC="${mnemonic}"\n`, { mode: 0o600 });
console.log('Created .env (secret phrase saved there, not shown).');
console.log(`TestNet deployer address: ${account.addr}`);
