from algopy import *
from algopy.arc4 import abimethod
from algopy import subroutine


class PredictionMarket(ARC4Contract):

    market_count: UInt64

    def __init__(self) -> None:
        self.market_count = UInt64(0)

        # Per-market state — keyed by market_id (UInt64)
        self.market_creator = BoxMap(UInt64, Account, key_prefix="mc")
        self.market_resolution_time = BoxMap(UInt64, UInt64, key_prefix="mr")
        self.market_resolved = BoxMap(UInt64, UInt64, key_prefix="md")
        self.market_outcome = BoxMap(UInt64, UInt64, key_prefix="mo")
        self.market_yes_supply = BoxMap(UInt64, UInt64, key_prefix="my")
        self.market_no_supply = BoxMap(UInt64, UInt64, key_prefix="mn")
        self.market_collateral = BoxMap(UInt64, UInt64, key_prefix="ml")
        self.market_scale = BoxMap(UInt64, UInt64, key_prefix="ms")

        # Council wallets — keyed by market_id
        self.market_council1 = BoxMap(UInt64, Account, key_prefix="c1")
        self.market_council2 = BoxMap(UInt64, Account, key_prefix="c2")
        self.market_council3 = BoxMap(UInt64, Account, key_prefix="c3")
        self.council1_voted = BoxMap(UInt64, UInt64, key_prefix="v1")
        self.council2_voted = BoxMap(UInt64, UInt64, key_prefix="v2")
        self.council3_voted = BoxMap(UInt64, UInt64, key_prefix="v3")
        self.council1_vote = BoxMap(UInt64, UInt64, key_prefix="o1")
        self.council2_vote = BoxMap(UInt64, UInt64, key_prefix="o2")
        self.council3_vote = BoxMap(UInt64, UInt64, key_prefix="o3")

        # Per-user positions — composite key: concat(itob(market_id), account.bytes)
        self.yes_balances = BoxMap(Bytes, UInt64, key_prefix="yb")
        self.no_balances = BoxMap(Bytes, UInt64, key_prefix="nb")
        self.has_redeemed = BoxMap(Bytes, UInt64, key_prefix="hr")

    # ── No-op pad for extra box-ref capacity in atomic groups ──

    @abimethod()
    def pad(self) -> None:
        pass

    # ── Subroutines ──

    @subroutine
    def _position_key(self, market_id: UInt64, account: Account) -> Bytes:
        return op.concat(op.itob(market_id), account.bytes)

    @subroutine
    def _calc_cost(self, amount: UInt64, scale: UInt64) -> UInt64:
        return scale * amount

    @subroutine
    def _check_and_resolve(self, market_id: UInt64) -> None:
        yes_votes = UInt64(0)
        no_votes = UInt64(0)

        if self.council1_voted[market_id] == UInt64(1):
            if self.council1_vote[market_id] == UInt64(1):
                yes_votes += UInt64(1)
            else:
                no_votes += UInt64(1)

        if self.council2_voted[market_id] == UInt64(1):
            if self.council2_vote[market_id] == UInt64(1):
                yes_votes += UInt64(1)
            else:
                no_votes += UInt64(1)

        if self.council3_voted[market_id] == UInt64(1):
            if self.council3_vote[market_id] == UInt64(1):
                yes_votes += UInt64(1)
            else:
                no_votes += UInt64(1)

        # 1-of-3 resolves the market (prototype mode)
        if yes_votes >= UInt64(1):
            self.market_resolved[market_id] = UInt64(1)
            self.market_outcome[market_id] = UInt64(1)
        elif no_votes >= UInt64(1):
            self.market_resolved[market_id] = UInt64(1)
            self.market_outcome[market_id] = UInt64(0)

    # ── Market Creation ──

    @abimethod()
    def create_market(
        self,
        resolution_time: UInt64,
        price_scale: UInt64,
        council1: Account,
        council2: Account,
        council3: Account,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"
        assert resolution_time > Global.latest_timestamp, "Resolution time must be in the future"
        assert price_scale > 0, "Price scale must be positive"
        assert council1 != Global.zero_address, "Council1 cannot be zero address"
        assert council2 != Global.zero_address, "Council2 cannot be zero address"
        assert council3 != Global.zero_address, "Council3 cannot be zero address"
        assert council1 != council2, "Council members must be distinct"
        assert council1 != council3, "Council members must be distinct"
        assert council2 != council3, "Council members must be distinct"

        market_id = self.market_count + UInt64(1)
        self.market_count = market_id

        self.market_creator[market_id] = Txn.sender
        self.market_resolution_time[market_id] = resolution_time
        self.market_resolved[market_id] = UInt64(0)
        self.market_outcome[market_id] = UInt64(0)
        self.market_yes_supply[market_id] = UInt64(0)
        self.market_no_supply[market_id] = UInt64(0)
        self.market_collateral[market_id] = UInt64(0)
        self.market_scale[market_id] = price_scale

        self.market_council1[market_id] = council1
        self.market_council2[market_id] = council2
        self.market_council3[market_id] = council3
        self.council1_voted[market_id] = UInt64(0)
        self.council2_voted[market_id] = UInt64(0)
        self.council3_voted[market_id] = UInt64(0)
        self.council1_vote[market_id] = UInt64(0)
        self.council2_vote[market_id] = UInt64(0)
        self.council3_vote[market_id] = UInt64(0)

        return market_id

    # ── Buy / Sell ──

    @abimethod()
    def buy_yes(
        self,
        market_id: UInt64,
        amount: UInt64,
        pay_txn: gtxn.PaymentTransaction,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(0), "Market already resolved"
        assert amount > 0, "Amount must be positive"
        assert pay_txn.receiver == Global.current_application_address, "Payment must go to app"

        scale = self.market_scale[market_id]
        cost = self._calc_cost(amount, scale)
        assert pay_txn.amount >= cost, "Insufficient payment"

        self.market_yes_supply[market_id] = self.market_yes_supply[market_id] + amount
        self.market_collateral[market_id] = self.market_collateral[market_id] + cost

        key = self._position_key(market_id, Txn.sender)
        current_bal, has_bal = self.yes_balances.maybe(key)
        if has_bal:
            self.yes_balances[key] = current_bal + amount
        else:
            self.yes_balances[key] = amount

        # Refund overpayment
        overpay = pay_txn.amount - cost
        if overpay > 0:
            itxn.Payment(receiver=Txn.sender, amount=overpay, fee=0).submit()

        return cost

    @abimethod()
    def buy_no(
        self,
        market_id: UInt64,
        amount: UInt64,
        pay_txn: gtxn.PaymentTransaction,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(0), "Market already resolved"
        assert amount > 0, "Amount must be positive"
        assert pay_txn.receiver == Global.current_application_address, "Payment must go to app"

        scale = self.market_scale[market_id]
        cost = self._calc_cost(amount, scale)
        assert pay_txn.amount >= cost, "Insufficient payment"

        self.market_no_supply[market_id] = self.market_no_supply[market_id] + amount
        self.market_collateral[market_id] = self.market_collateral[market_id] + cost

        key = self._position_key(market_id, Txn.sender)
        current_bal, has_bal = self.no_balances.maybe(key)
        if has_bal:
            self.no_balances[key] = current_bal + amount
        else:
            self.no_balances[key] = amount

        # Refund overpayment
        overpay = pay_txn.amount - cost
        if overpay > 0:
            itxn.Payment(receiver=Txn.sender, amount=overpay, fee=0).submit()

        return cost

    @abimethod()
    def sell_yes(
        self,
        market_id: UInt64,
        amount: UInt64,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(0), "Market already resolved"
        assert amount > 0, "Amount must be positive"

        key = self._position_key(market_id, Txn.sender)
        current_bal = self.yes_balances[key]
        assert current_bal >= amount, "Insufficient YES balance"

        scale = self.market_scale[market_id]
        refund = self._calc_cost(amount, scale)

        self.yes_balances[key] = current_bal - amount
        self.market_yes_supply[market_id] = self.market_yes_supply[market_id] - amount
        self.market_collateral[market_id] = self.market_collateral[market_id] - refund

        itxn.Payment(receiver=Txn.sender, amount=refund, fee=0).submit()

        return refund

    @abimethod()
    def sell_no(
        self,
        market_id: UInt64,
        amount: UInt64,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(0), "Market already resolved"
        assert amount > 0, "Amount must be positive"

        key = self._position_key(market_id, Txn.sender)
        current_bal = self.no_balances[key]
        assert current_bal >= amount, "Insufficient NO balance"

        scale = self.market_scale[market_id]
        refund = self._calc_cost(amount, scale)

        self.no_balances[key] = current_bal - amount
        self.market_no_supply[market_id] = self.market_no_supply[market_id] - amount
        self.market_collateral[market_id] = self.market_collateral[market_id] - refund

        itxn.Payment(receiver=Txn.sender, amount=refund, fee=0).submit()

        return refund

    # ── Council Resolution ──

    @abimethod()
    def vote_outcome(
        self,
        market_id: UInt64,
        outcome: UInt64,
    ) -> None:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(0), "Market already resolved"
        # Resolution time check removed for prototype
        assert outcome <= UInt64(1), "Outcome must be 0 or 1"

        sender = Txn.sender

        if sender == self.market_council1[market_id]:
            assert self.council1_voted[market_id] == UInt64(0), "Council member already voted"
            self.council1_voted[market_id] = UInt64(1)
            self.council1_vote[market_id] = outcome
        elif sender == self.market_council2[market_id]:
            assert self.council2_voted[market_id] == UInt64(0), "Council member already voted"
            self.council2_voted[market_id] = UInt64(1)
            self.council2_vote[market_id] = outcome
        elif sender == self.market_council3[market_id]:
            assert self.council3_voted[market_id] == UInt64(0), "Council member already voted"
            self.council3_voted[market_id] = UInt64(1)
            self.council3_vote[market_id] = outcome
        else:
            assert False, "Only council members can vote"  # noqa: B011

        self._check_and_resolve(market_id)

    # ── Redemption ──

    @abimethod()
    def redeem(
        self,
        market_id: UInt64,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"
        assert self.market_resolved[market_id] == UInt64(1), "Market not resolved"

        key = self._position_key(market_id, Txn.sender)

        redeemed_val, has_entry = self.has_redeemed.maybe(key)
        if has_entry:
            assert redeemed_val == UInt64(0), "Already redeemed"

        outcome = self.market_outcome[market_id]
        total_collateral = self.market_collateral[market_id]

        winning_balance = UInt64(0)
        winning_supply = UInt64(0)

        if outcome == UInt64(1):
            # YES won
            bal, has_bal = self.yes_balances.maybe(key)
            if has_bal:
                winning_balance = bal
            winning_supply = self.market_yes_supply[market_id]
        else:
            # NO won
            bal, has_bal = self.no_balances.maybe(key)
            if has_bal:
                winning_balance = bal
            winning_supply = self.market_no_supply[market_id]

        assert winning_balance > 0, "No winning shares to redeem"
        assert winning_supply > 0, "No winning supply"

        payout = (winning_balance * total_collateral) // winning_supply

        assert payout > 0, "Payout is zero"

        self.has_redeemed[key] = UInt64(1)

        itxn.Payment(receiver=Txn.sender, amount=payout, fee=0).submit()

        return payout

    # ── Read-only Views ──

    @abimethod()
    def get_market_info(
        self,
        market_id: UInt64,
    ) -> tuple[UInt64, UInt64, UInt64, UInt64, UInt64, UInt64]:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"

        return (
            self.market_yes_supply[market_id],
            self.market_no_supply[market_id],
            self.market_collateral[market_id],
            self.market_scale[market_id],
            self.market_resolved[market_id],
            self.market_outcome[market_id],
        )

    @abimethod()
    def get_position(
        self,
        market_id: UInt64,
        account: Account,
    ) -> tuple[UInt64, UInt64]:
        key = self._position_key(market_id, account)

        yes_bal = UInt64(0)
        no_bal = UInt64(0)

        yval, has_yes = self.yes_balances.maybe(key)
        if has_yes:
            yes_bal = yval

        nval, has_no = self.no_balances.maybe(key)
        if has_no:
            no_bal = nval

        return (yes_bal, no_bal)

    @abimethod()
    def get_prices(
        self,
        market_id: UInt64,
    ) -> tuple[UInt64, UInt64]:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"

        scale = self.market_scale[market_id]
        return (scale, scale)

    @abimethod()
    def get_buy_cost(
        self,
        market_id: UInt64,
        side: UInt64,
        amount: UInt64,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"

        scale = self.market_scale[market_id]
        return self._calc_cost(amount, scale)

    @abimethod()
    def get_sell_return(
        self,
        market_id: UInt64,
        side: UInt64,
        amount: UInt64,
    ) -> UInt64:
        _creator, exists = self.market_creator.maybe(market_id)
        assert exists, "Market does not exist"

        scale = self.market_scale[market_id]
        return self._calc_cost(amount, scale)
