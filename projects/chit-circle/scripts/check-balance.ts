import { AlgorandClient } from '@algorandfoundation/algokit-utils';

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  if (!mnemonic) {
    throw new Error('DEPLOYER_MNEMONIC not found. Run this with: npx tsx --env-file=.env scripts/check-balance.ts');
  }
  const algorand = AlgorandClient.testNet();
  const account = algorand.account.fromMnemonic(mnemonic);
  const info = await algorand.account.getInformation(account.addr);
  console.log(`Deployer address: ${account.addr}`);
  console.log(`TestNet balance:  ${info.balance.algo} ALGO`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
