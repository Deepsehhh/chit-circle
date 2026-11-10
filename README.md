# ChitCircle: a rotating savings circle on Algorand

ChitCircle is a smart contract that automates a **chit fund / rotating savings circle (ROSCA)**. A small group of people each pay a fixed amount every round, and the contract pays the whole pot to one member per round, in join order, until everyone has received it once. Nobody has to trust a single person to hold the money.

Built for the **ABC Smart Contract Building Challenge** with TealScript on Algorand.

## Why this problem

Chit funds and savings circles are used by millions of people, but the money usually sits with an organizer who has to be trusted. ChitCircle moves the rules into a contract: payments are verified on-chain, payouts are automatic, and a missed deadline refunds the members who did pay.

## How it works

1. **Create:** the organizer deploys the contract with three settings: contribution per round (microAlgos), number of members (2 to 5) and round length (seconds).
2. **Join:** each member calls `join` with a grouped payment of 0.2 ALGO (a storage deposit for their boxes). When the last seat is filled, round 1 starts.
3. **Contribute:** each round, every member calls `contribute` with a grouped payment of exactly the contribution amount.
4. **Payout:** once everyone has paid, anyone can call `payout`. The contract sends the whole pot to that round's recipient with an inner transaction. Recipient order is join order.
5. **Finish:** after the last member has been paid, the circle is marked completed.
6. **Safety exit:** if a round's deadline passes and someone has not paid, anyone can call `refundRound`. Members who paid get that round's contribution back and the circle is cancelled.

## Contract methods

| Method | Purpose |
| --- | --- |
| `createApplication(contributionAmount, maxMembersAllowed, roundLengthSeconds)` | Creates the circle |
| `join(payment)` | Joins the circle (grouped 0.2 ALGO payment) |
| `contribute(payment)` | Pays this round's contribution (grouped payment) |
| `payout()` | Sends the pot to the current round's recipient |
| `refundRound()` | After a missed deadline, refunds payers and cancels the circle |

Status values in global state: 0 = open, 1 = active, 2 = completed, 3 = cancelled.

Algorand features used: grouped transaction verification (`verifyPayTxn`), box storage (`BoxMap`), inner transactions (`sendPayment`), global state and block timestamps.

## Deployment (Algorand TestNet)

- App ID: **775695522**
- Explorer: https://lora.algokit.io/testnet/application/775695522
- Deployment details: `projects/chit-circle/deployments/testnet.json`
- Demo settings: 0.1 ALGO per round, 3 members, 1 day per round

## Project layout

```
projects/chit-circle/
  contracts/ChitCircle.algo.ts          the smart contract (TealScript)
  contracts/artifacts/ChitCircle.arc56.json   ARC-56 app specification
  contracts/clients/ChitCircleClient.ts generated TypeScript client
  __test__/ChitCircle.test.ts           Jest tests (run on LocalNet)
  scripts/deploy.ts                     deploy to LocalNet or TestNet
  scripts/new-account.ts                creates a throwaway TestNet deployer account
  scripts/check-balance.ts              shows deployer address and balance
  deployments/                          deployment records
```

## Run it yourself

Requirements: Node.js, Python, pipx, Docker Desktop and AlgoKit (tested on Ubuntu under WSL).

```bash
cd projects/chit-circle
npm install
algokit localnet start
npm run build                                  # compile + generate ARC-56 and client
npx jest __test__/ChitCircle.test.ts           # run the tests
NETWORK=localnet npx tsx scripts/deploy.ts     # deploy to LocalNet
```

For TestNet, create a throwaway account with `npx tsx scripts/new-account.ts` (it saves the secret phrase to a local, git-ignored `.env` file and never prints it), fund the printed address from the Algorand TestNet dispenser, then run:

```bash
NETWORK=testnet npx tsx --env-file=.env scripts/deploy.ts
```

Never commit `.env` or share its contents.

## Tests

10 tests pass on LocalNet: initial state, circle activates when full, duplicate join rejected, full-circle join rejected, contribution accepted once per round, wrong amount rejected, early payout rejected, a full cycle where every member receives the pot once and the circle completes, early refund rejected, and refund after a missed deadline returning money to those who paid.

## Limitations and future work

This is a prototype. It has **not been audited** and is **not production-ready**.

- The 0.2 ALGO join deposit stays in the contract; there is no withdrawal path for it.
- A refund covers only the current round. The circle is then cancelled and earlier rounds are not unwound.
- There is no way to delete the app or remove a member after joining.
- Payout order is join order, not random or bid-based.
- Maximum 5 members.
- Ideas for later: random or bid-based payout order, an NFT receipt per payout, deposit withdrawal after completion, larger groups.
