from algopy import *
from algopy.arc4 import abimethod
from algopy import subroutine


class Launchpad(ARC4Contract):

    project_count: UInt64

    def __init__(self) -> None:
        self.project_count = UInt64(0)

        # Per-project state — keyed by project_id (UInt64)
        self.project_creator = BoxMap(UInt64, Account, key_prefix="pc")
        self.project_goal = BoxMap(UInt64, UInt64, key_prefix="pg")
        self.project_deadline = BoxMap(UInt64, UInt64, key_prefix="pd")
        self.project_raised = BoxMap(UInt64, UInt64, key_prefix="pr")
        self.project_status = BoxMap(UInt64, UInt64, key_prefix="ps")
        # status: 0=active, 1=funded/claimed, 2=failed

        # Per-user per-project pledge — composite key: concat(itob(project_id), account.bytes)
        self.pledges = BoxMap(Bytes, UInt64, key_prefix="pl")

    # ── No-op pad for extra box-ref capacity in atomic groups ──

    @abimethod()
    def pad(self) -> None:
        pass

    # ── Subroutines ──

    @subroutine
    def _pledge_key(self, project_id: UInt64, account: Account) -> Bytes:
        return op.concat(op.itob(project_id), account.bytes)

    # ── Project Creation ──

    @abimethod()
    def create_project(
        self,
        goal: UInt64,
        deadline: UInt64,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"
        assert goal > UInt64(0), "Goal must be positive"
        assert deadline > Global.latest_timestamp, "Deadline must be in the future"

        project_id = self.project_count + UInt64(1)
        self.project_count = project_id

        self.project_creator[project_id] = Txn.sender
        self.project_goal[project_id] = goal
        self.project_deadline[project_id] = deadline
        self.project_raised[project_id] = UInt64(0)
        self.project_status[project_id] = UInt64(0)

        return project_id

    # ── Fund Project ──

    @abimethod()
    def fund_project(
        self,
        project_id: UInt64,
        pay_txn: gtxn.PaymentTransaction,
    ) -> UInt64:
        _creator, exists = self.project_creator.maybe(project_id)
        assert exists, "Project does not exist"
        assert self.project_status[project_id] == UInt64(0), "Project not active"
        assert self.project_deadline[project_id] > Global.latest_timestamp, "Deadline passed"
        assert pay_txn.receiver == Global.current_application_address, "Payment must go to app"
        assert pay_txn.amount > UInt64(0), "Must send positive amount"

        # Update raised total
        self.project_raised[project_id] = self.project_raised[project_id] + pay_txn.amount

        # Update user pledge
        key = self._pledge_key(project_id, Txn.sender)
        current_pledge, has_pledge = self.pledges.maybe(key)
        if has_pledge:
            self.pledges[key] = current_pledge + pay_txn.amount
        else:
            self.pledges[key] = pay_txn.amount

        return self.project_raised[project_id]

    # ── Claim Funds (creator only, goal met) ──

    @abimethod()
    def claim_funds(
        self,
        project_id: UInt64,
    ) -> UInt64:
        _creator, exists = self.project_creator.maybe(project_id)
        assert exists, "Project does not exist"
        assert self.project_status[project_id] == UInt64(0), "Project not active"
        assert Txn.sender == self.project_creator[project_id], "Only creator can claim"

        raised = self.project_raised[project_id]
        goal = self.project_goal[project_id]
        assert raised >= goal, "Goal not met"

        self.project_status[project_id] = UInt64(1)

        itxn.Payment(receiver=Txn.sender, amount=raised, fee=0).submit()

        return raised

    # ── Refund (backer only, deadline passed, goal not met) ──

    @abimethod()
    def refund(
        self,
        project_id: UInt64,
    ) -> UInt64:
        _creator, exists = self.project_creator.maybe(project_id)
        assert exists, "Project does not exist"

        status = self.project_status[project_id]
        assert status == UInt64(0) or status == UInt64(2), "Project already funded/claimed"
        assert self.project_deadline[project_id] <= Global.latest_timestamp, "Deadline not passed"

        raised = self.project_raised[project_id]
        goal = self.project_goal[project_id]
        assert raised < goal, "Goal was met, cannot refund"

        # Mark as failed on first refund
        if status == UInt64(0):
            self.project_status[project_id] = UInt64(2)

        key = self._pledge_key(project_id, Txn.sender)
        pledge_amount = self.pledges[key]
        assert pledge_amount > UInt64(0), "No pledge to refund"

        # Zero out pledge before paying
        self.pledges[key] = UInt64(0)
        self.project_raised[project_id] = raised - pledge_amount

        itxn.Payment(receiver=Txn.sender, amount=pledge_amount, fee=0).submit()

        return pledge_amount

    # ── Read-only Views ──

    @abimethod()
    def get_project_info(
        self,
        project_id: UInt64,
    ) -> tuple[Account, UInt64, UInt64, UInt64, UInt64]:
        _creator, exists = self.project_creator.maybe(project_id)
        assert exists, "Project does not exist"

        return (
            self.project_creator[project_id],
            self.project_goal[project_id],
            self.project_deadline[project_id],
            self.project_raised[project_id],
            self.project_status[project_id],
        )

    @abimethod()
    def get_pledge(
        self,
        project_id: UInt64,
        account: Account,
    ) -> UInt64:
        key = self._pledge_key(project_id, account)
        pledge_val, has_pledge = self.pledges.maybe(key)
        if has_pledge:
            return pledge_val
        return UInt64(0)
