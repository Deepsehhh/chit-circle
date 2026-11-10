import { Contract } from '@algorandfoundation/tealscript';

/**
 * ChitCircle: a rotating savings circle (chit fund) on Algorand.
 *
 * status: 0 = open (members joining), 1 = active, 2 = completed, 3 = cancelled
 */
export class ChitCircle extends Contract {
  // ---------- Global state ----------
  organizer = GlobalStateKey<Address>();

  contribution = GlobalStateKey<uint64>(); // microAlgos each member pays per round

  maxMembers = GlobalStateKey<uint64>();

  roundSeconds = GlobalStateKey<uint64>(); // length of each round

  memberCount = GlobalStateKey<uint64>();

  currentRound = GlobalStateKey<uint64>(); // 0-based round number

  paidCount = GlobalStateKey<uint64>(); // members who paid in the current round

  roundDeadline = GlobalStateKey<uint64>(); // unix time when current round ends

  status = GlobalStateKey<uint64>();

  // ---------- Box storage ----------
  // join position -> member address (this defines payout order)
  memberAt = BoxMap<uint64, Address>({ prefix: 'i' });

  // member address -> (round number they last paid for) + 1, or 0 if not paid yet
  paidRound = BoxMap<Address, uint64>({ prefix: 'p' });

  /**
   * Creates a new savings circle.
   *
   * @param contributionAmount microAlgos each member pays every round
   * @param maxMembersAllowed number of members (2 to 5)
   * @param roundLengthSeconds how long each round lasts, in seconds
   */
  createApplication(contributionAmount: uint64, maxMembersAllowed: uint64, roundLengthSeconds: uint64): void {
    assert(contributionAmount > 0);
    assert(maxMembersAllowed >= 2 && maxMembersAllowed <= 5);
    assert(roundLengthSeconds > 0);

    this.organizer.value = this.txn.sender;
    this.contribution.value = contributionAmount;
    this.maxMembers.value = maxMembersAllowed;
    this.roundSeconds.value = roundLengthSeconds;
    this.memberCount.value = 0;
    this.currentRound.value = 0;
    this.paidCount.value = 0;
    this.roundDeadline.value = 0;
    this.status.value = 0;
  }

  /**
   * Join the circle. Must be grouped with a payment of exactly 0.2 ALGO
   * (200000 microAlgos) to the app, which pays for the member's storage boxes.
   * When the last seat is filled, round 1 starts.
   */
  join(payment: PayTxn): void {
    assert(this.status.value === 0);
    assert(this.memberCount.value < this.maxMembers.value);

    const sender = this.txn.sender;
    assert(!this.paidRound(sender).exists);

    verifyPayTxn(payment, {
      sender: sender,
      receiver: this.app.address,
      amount: 200000,
    });

    this.memberAt(this.memberCount.value).value = sender;
    this.paidRound(sender).value = 0;
    this.memberCount.value = this.memberCount.value + 1;

    if (this.memberCount.value === this.maxMembers.value) {
      this.status.value = 1;
      this.roundDeadline.value = globals.latestTimestamp + this.roundSeconds.value;
    }
  }

  /**
   * Pay this round's contribution. Must be grouped with a payment of exactly
   * the contribution amount to the app. One payment per member per round.
   */
  contribute(payment: PayTxn): void {
    assert(this.status.value === 1);
    assert(globals.latestTimestamp <= this.roundDeadline.value);

    const sender = this.txn.sender;
    assert(this.paidRound(sender).exists);
    assert(this.paidRound(sender).value !== this.currentRound.value + 1);

    verifyPayTxn(payment, {
      sender: sender,
      receiver: this.app.address,
      amount: this.contribution.value,
    });

    this.paidRound(sender).value = this.currentRound.value + 1;
    this.paidCount.value = this.paidCount.value + 1;
  }

  /**
   * Once everyone has paid, anyone can call this to send the pot to this
   * round's recipient and move to the next round (or finish the circle).
   * The caller must add extra fee to cover the inner payment.
   */
  payout(): void {
    assert(this.status.value === 1);
    assert(this.paidCount.value === this.memberCount.value);

    const recipient = this.memberAt(this.currentRound.value).value;

    sendPayment({
      receiver: recipient,
      amount: this.contribution.value * this.memberCount.value,
      fee: 0,
    });

    this.currentRound.value = this.currentRound.value + 1;
    this.paidCount.value = 0;

    if (this.currentRound.value === this.memberCount.value) {
      this.status.value = 2;
    } else {
      this.roundDeadline.value = globals.latestTimestamp + this.roundSeconds.value;
    }
  }

  /**
   * If the round deadline has passed and not everyone paid, anyone can call
   * this. Members who paid get their contribution back and the circle is
   * cancelled. The caller must add extra fee (one inner payment per refund).
   */
  refundRound(): void {
    assert(this.status.value === 1);
    assert(globals.latestTimestamp > this.roundDeadline.value);
    assert(this.paidCount.value < this.memberCount.value);

    for (let i: uint64 = 0; i < this.memberCount.value; i += 1) {
      const member = this.memberAt(i).value;
      if (this.paidRound(member).value === this.currentRound.value + 1) {
        sendPayment({
          receiver: member,
          amount: this.contribution.value,
          fee: 0,
        });
        this.paidRound(member).value = 0;
      }
    }

    this.paidCount.value = 0;
    this.status.value = 3;
  }
}
