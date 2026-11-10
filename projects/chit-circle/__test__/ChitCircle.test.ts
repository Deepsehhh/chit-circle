import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { Config } from '@algorandfoundation/algokit-utils';
import { AlgoAmount } from '@algorandfoundation/algokit-utils/types/amount';
import { ChitCircleClient, ChitCircleFactory } from '../contracts/clients/ChitCircleClient';

jest.setTimeout(90000);

const fixture = algorandFixture();
Config.configure({ populateAppCallResources: true });

const DEPOSIT = 200_000; // microAlgos, must match the contract
const ONE_ALGO = 1_000_000;

type Member = Awaited<ReturnType<typeof newMember>>;

async function newMember() {
  return fixture.context.generateAccount({ initialFunds: AlgoAmount.Algos(20) });
}

async function createCircle(contribution: number, maxMembers: number, roundSeconds: number) {
  const { testAccount } = fixture.context;
  const { algorand } = fixture;
  const factory = new ChitCircleFactory({ algorand, defaultSender: testAccount.addr });
  const { appClient } = await factory.send.create.createApplication({
    args: {
      contributionAmount: contribution,
      maxMembersAllowed: maxMembers,
      roundLengthSeconds: roundSeconds,
    },
  });
  return appClient;
}

async function join(appClient: ChitCircleClient, member: Member) {
  const payment = await fixture.algorand.createTransaction.payment({
    sender: member.addr,
    receiver: appClient.appAddress,
    amount: AlgoAmount.MicroAlgos(DEPOSIT),
  });
  return appClient.send.join({ args: { payment }, sender: member.addr });
}

async function contribute(appClient: ChitCircleClient, member: Member, amount: number) {
  const payment = await fixture.algorand.createTransaction.payment({
    sender: member.addr,
    receiver: appClient.appAddress,
    amount: AlgoAmount.MicroAlgos(amount),
  });
  return appClient.send.contribute({ args: { payment }, sender: member.addr });
}

async function balanceOf(addr: string) {
  const info = await fixture.algorand.account.getInformation(addr);
  return Number(info.balance.microAlgo);
}

async function getState(appClient: ChitCircleClient) {
  const s = await appClient.state.global.getAll();
  return {
    status: Number(s.status),
    memberCount: Number(s.memberCount),
    currentRound: Number(s.currentRound),
    paidCount: Number(s.paidCount),
  };
}

// Fills the circle with `n` new members and returns them in join order
async function fillCircle(appClient: ChitCircleClient, n: number) {
  const members: Member[] = [];
  for (let i = 0; i < n; i += 1) {
    const m = await newMember();
    await join(appClient, m);
    members.push(m);
  }
  return members;
}

describe('ChitCircle', () => {
  beforeEach(fixture.beforeEach);

  test('creates a circle with the right starting state', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const s = await getState(app);
    expect(s.status).toBe(0);
    expect(s.memberCount).toBe(0);
    expect(s.currentRound).toBe(0);
  });

  test('circle becomes active when the last seat is filled', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    await fillCircle(app, 2);
    expect((await getState(app)).status).toBe(0);
    await fillCircle(app, 1);
    const s = await getState(app);
    expect(s.status).toBe(1);
    expect(s.memberCount).toBe(3);
  });

  test('rejects the same member joining twice', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const m = await newMember();
    await join(app, m);
    await expect(join(app, m)).rejects.toThrow();
  });

  test('rejects joining a full circle', async () => {
    const app = await createCircle(ONE_ALGO, 2, 3600);
    await fillCircle(app, 2);
    const extra = await newMember();
    await expect(join(app, extra)).rejects.toThrow();
  });

  test('accepts a contribution and rejects a second one in the same round', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const members = await fillCircle(app, 3);
    await contribute(app, members[0], ONE_ALGO);
    expect((await getState(app)).paidCount).toBe(1);
    await expect(contribute(app, members[0], ONE_ALGO)).rejects.toThrow();
  });

  test('rejects a contribution of the wrong amount', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const members = await fillCircle(app, 3);
    await expect(contribute(app, members[0], ONE_ALGO - 1)).rejects.toThrow();
  });

  test('rejects payout before everyone has paid', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const members = await fillCircle(app, 3);
    await contribute(app, members[0], ONE_ALGO);
    await contribute(app, members[1], ONE_ALGO);
    await expect(
      app.send.payout({ args: {}, sender: members[2].addr, extraFee: AlgoAmount.MicroAlgos(1000) }),
    ).rejects.toThrow();
  });

  test('full cycle: every member receives the pot once, then the circle completes', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const members = await fillCircle(app, 3);

    for (let round = 0; round < 3; round += 1) {
      for (const m of members) {
        await contribute(app, m, ONE_ALGO);
      }
      const recipient = members[round];
      const caller = members[(round + 1) % 3]; // never the recipient, so the fee does not blur the check

      const before = await balanceOf(recipient.addr);
      await app.send.payout({ args: {}, sender: caller.addr, extraFee: AlgoAmount.MicroAlgos(1000) });
      const after = await balanceOf(recipient.addr);

      expect(after - before).toBe(3 * ONE_ALGO);
    }

    const s = await getState(app);
    expect(s.status).toBe(2);
    expect(s.currentRound).toBe(3);

    // a completed circle accepts no more contributions
    await expect(contribute(app, members[0], ONE_ALGO)).rejects.toThrow();
  });

  test('refund is rejected before the deadline', async () => {
    const app = await createCircle(ONE_ALGO, 3, 3600);
    const members = await fillCircle(app, 3);
    await contribute(app, members[0], ONE_ALGO);
    await expect(
      app.send.refundRound({ args: {}, sender: members[2].addr, extraFee: AlgoAmount.MicroAlgos(5000) }),
    ).rejects.toThrow();
  });

  test('refund after a missed deadline returns money to those who paid and cancels the circle', async () => {
    const app = await createCircle(ONE_ALGO, 3, 10);
    const members = await fillCircle(app, 3);

    // members 0 and 1 pay, member 2 does not
    await contribute(app, members[0], ONE_ALGO);
    await contribute(app, members[1], ONE_ALGO);

    // wait past the 10 second deadline, then add a block so the chain clock moves forward
    await new Promise((resolve) => setTimeout(resolve, 13000));
    await fixture.algorand.send.payment({
      sender: members[2].addr,
      receiver: members[2].addr,
      amount: AlgoAmount.MicroAlgos(0),
      note: 'tick',
    });

    const before0 = await balanceOf(members[0].addr);
    const before1 = await balanceOf(members[1].addr);

    await app.send.refundRound({
      args: {},
      sender: members[2].addr, // the member who did not pay calls it, so the others' balances change only by the refund
      extraFee: AlgoAmount.MicroAlgos(5000),
    });

    expect((await balanceOf(members[0].addr)) - before0).toBe(ONE_ALGO);
    expect((await balanceOf(members[1].addr)) - before1).toBe(ONE_ALGO);
    expect((await getState(app)).status).toBe(3);
  });
});
