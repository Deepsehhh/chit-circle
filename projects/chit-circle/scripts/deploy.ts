import { writeFileSync } from 'fs';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { ChitCircleFactory } from '../contracts/clients/ChitCircleClient';

// Demo circle settings
const CONTRIBUTION_MICROALGOS = 100_000; // 0.1 ALGO per member per round
const MAX_MEMBERS = 3;
const ROUND_SECONDS = 86_400; // 1 day

async function main() {
  const network = process.env.NETWORK ?? 'localnet';

  let algorand: AlgorandClient;
  if (network === 'testnet') {
    algorand = AlgorandClient.testNet();
  } else {
    algorand = AlgorandClient.defaultLocalNet();
  }

  let deployer;
  if (network === 'testnet') {
    const mnemonic = process.env.DEPLOYER_MNEMONIC;
    if (!mnemonic) {
      throw new Error('DEPLOYER_MNEMONIC is not set. See the TestNet step.');
    }
    deployer = algorand.account.fromMnemonic(mnemonic);
  } else {
    deployer = await algorand.account.localNetDispenser();
  }

  const info = await algorand.account.getInformation(deployer.addr);
  console.log(`Network:  ${network}`);
  console.log(`Deployer: ${deployer.addr}`);
  console.log(`Balance:  ${info.balance.algo} ALGO`);

  const factory = new ChitCircleFactory({ algorand, defaultSender: deployer.addr });

  const { appClient, result } = await factory.send.create.createApplication({
    args: {
      contributionAmount: CONTRIBUTION_MICROALGOS,
      maxMembersAllowed: MAX_MEMBERS,
      roundLengthSeconds: ROUND_SECONDS,
    },
  });

  console.log('\nDeployed ChitCircle');
  console.log(`App ID:      ${appClient.appId}`);
  console.log(`App address: ${appClient.appAddress}`);
  console.log(`Create tx:   ${result.txIds[0]}`);

  if (network === 'testnet') {
    console.log(`Explorer:    https://lora.algokit.io/testnet/application/${appClient.appId}`);
  }

  writeFileSync(
    `deployments/${network}.json`,
    JSON.stringify(
      {
        network,
        appId: appClient.appId.toString(),
        appAddress: String(appClient.appAddress),
        createTxId: result.txIds[0],
        contribution: CONTRIBUTION_MICROALGOS,
        maxMembers: MAX_MEMBERS,
        roundSeconds: ROUND_SECONDS,
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved deployments/${network}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
