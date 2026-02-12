from algopy import *
from algopy.arc4 import abimethod
from algopy import subroutine


class Splitwise(ARC4Contract):

    group_count: UInt64
    expense_count: UInt64

    def __init__(self) -> None:
        self.group_count = UInt64(0)
        self.expense_count = UInt64(0)

        # Group state — keyed by group_id
        self.group_creator = BoxMap(UInt64, Account, key_prefix="gc")
        self.group_member_count = BoxMap(UInt64, UInt64, key_prefix="gn")
        self.group_active = BoxMap(UInt64, UInt64, key_prefix="ga")

        # Group members: key = group_id * 2^16 + member_index => Account
        self.group_members = BoxMap(UInt64, Account, key_prefix="gm")
        # Membership lookup: key = concat(group_id_bytes, account_bytes) => UInt64(1)
        self.is_group_member = BoxMap(Bytes, UInt64, key_prefix="ig")

        # Expense state — keyed by expense_id
        self.expense_group = BoxMap(UInt64, UInt64, key_prefix="eg")
        self.expense_payer = BoxMap(UInt64, Account, key_prefix="ep")
        self.expense_amount = BoxMap(UInt64, UInt64, key_prefix="ea")
        self.expense_share = BoxMap(UInt64, UInt64, key_prefix="es")
        self.expense_participant_count = BoxMap(UInt64, UInt64, key_prefix="en")

        # Expense participants: key = expense_id * 2^16 + participant_index => Account
        self.expense_participants = BoxMap(UInt64, Account, key_prefix="xp")

        # Settlement tracking: key = concat(expense_id_bytes, account_bytes) => UInt64(1)
        self.has_settled = BoxMap(Bytes, UInt64, key_prefix="hs")
        # Count of settlements per expense
        self.expense_settled_count = BoxMap(UInt64, UInt64, key_prefix="sc")

    @subroutine
    def _group_member_key(self, group_id: UInt64, account: Account) -> Bytes:
        return op.concat(op.itob(group_id), account.bytes)

    @subroutine
    def _settlement_key(self, expense_id: UInt64, account: Account) -> Bytes:
        return op.concat(op.itob(expense_id), account.bytes)

    @abimethod()
    def create_group(
        self,
        member1: Account,
        member2: Account,
        member3: Account,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Creates an expense-splitting group with up to 3 additional members.
        The caller is always the first member.
        mbr_pay covers box storage costs."""
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"

        group_id = self.group_count + UInt64(1)
        self.group_count = group_id

        self.group_creator[group_id] = Txn.sender
        self.group_active[group_id] = UInt64(1)

        # Add creator
        member_index = UInt64(0)
        key0 = group_id * UInt64(2**16) + member_index
        self.group_members[key0] = Txn.sender
        self.is_group_member[self._group_member_key(group_id, Txn.sender)] = UInt64(1)
        member_index += UInt64(1)

        if member1 != Global.zero_address:
            key1 = group_id * UInt64(2**16) + member_index
            self.group_members[key1] = member1
            self.is_group_member[self._group_member_key(group_id, member1)] = UInt64(1)
            member_index += UInt64(1)

        if member2 != Global.zero_address:
            key2 = group_id * UInt64(2**16) + member_index
            self.group_members[key2] = member2
            self.is_group_member[self._group_member_key(group_id, member2)] = UInt64(1)
            member_index += UInt64(1)

        if member3 != Global.zero_address:
            key3 = group_id * UInt64(2**16) + member_index
            self.group_members[key3] = member3
            self.is_group_member[self._group_member_key(group_id, member3)] = UInt64(1)
            member_index += UInt64(1)

        self.group_member_count[group_id] = member_index

        return group_id

    @abimethod()
    def add_expense(
        self,
        group_id: UInt64,
        amount: UInt64,
        participant1: Account,
        participant2: Account,
        participant3: Account,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Adds a shared expense to a group. The caller is the payer.
        Participants are the people who share this expense (including payer if applicable).
        Up to 3 additional participants can be specified.
        mbr_pay covers box storage costs."""
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"

        creator_val, exists = self.group_creator.maybe(group_id)
        assert exists, "Group does not exist"
        assert self.group_active[group_id] == UInt64(1), "Group is closed"

        # Verify caller is a member
        mem_val, is_mem = self.is_group_member.maybe(self._group_member_key(group_id, Txn.sender))
        assert is_mem, "Only group members can add expenses"

        assert amount > 0, "Amount must be > 0"

        expense_id = self.expense_count + UInt64(1)
        self.expense_count = expense_id

        self.expense_group[expense_id] = group_id
        self.expense_payer[expense_id] = Txn.sender
        self.expense_amount[expense_id] = amount
        self.expense_settled_count[expense_id] = UInt64(0)

        # Add participants (people who owe their share)
        p_index = UInt64(0)

        if participant1 != Global.zero_address:
            # Verify participant is group member
            p1_val, is_p1 = self.is_group_member.maybe(self._group_member_key(group_id, participant1))
            assert is_p1, "Participant 1 not in group"
            key1 = expense_id * UInt64(2**16) + p_index
            self.expense_participants[key1] = participant1
            p_index += UInt64(1)

        if participant2 != Global.zero_address:
            p2_val, is_p2 = self.is_group_member.maybe(self._group_member_key(group_id, participant2))
            assert is_p2, "Participant 2 not in group"
            key2 = expense_id * UInt64(2**16) + p_index
            self.expense_participants[key2] = participant2
            p_index += UInt64(1)

        if participant3 != Global.zero_address:
            p3_val, is_p3 = self.is_group_member.maybe(self._group_member_key(group_id, participant3))
            assert is_p3, "Participant 3 not in group"
            key3 = expense_id * UInt64(2**16) + p_index
            self.expense_participants[key3] = participant3
            p_index += UInt64(1)

        assert p_index > 0, "Must have at least one participant"

        self.expense_participant_count[expense_id] = p_index
        # Each participant's share = amount / number of participants
        self.expense_share[expense_id] = amount // p_index

        return expense_id

    @abimethod()
    def settle_expense(
        self,
        expense_id: UInt64,
        pay_txn: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Settles the caller's share of an expense by paying the payer.
        pay_txn must send the caller's share to the original payer.
        Returns remaining unsettled count."""
        payer_val, exists = self.expense_payer.maybe(expense_id)
        assert exists, "Expense does not exist"

        payer = self.expense_payer[expense_id]
        share = self.expense_share[expense_id]

        # Caller cannot be the payer
        assert Txn.sender != payer, "Payer cannot settle with themselves"

        # Check caller hasn't already settled
        settle_key = self._settlement_key(expense_id, Txn.sender)
        settle_val, already_settled = self.has_settled.maybe(settle_key)
        assert not already_settled, "Already settled this expense"

        # Verify caller is a participant
        p_count = self.expense_participant_count[expense_id]
        is_participant = False
        for i in urange(p_count):
            key = expense_id * UInt64(2**16) + i
            participant = self.expense_participants[key]
            if participant == Txn.sender:
                is_participant = True
                break

        assert is_participant, "Caller is not a participant in this expense"

        # Verify payment
        assert pay_txn.receiver == payer, "Payment must go to the expense payer"
        assert pay_txn.amount >= share, "Payment must cover your share"

        # Mark as settled
        self.has_settled[settle_key] = UInt64(1)
        settled = self.expense_settled_count[expense_id] + UInt64(1)
        self.expense_settled_count[expense_id] = settled

        remaining = p_count - settled
        return remaining

    @abimethod()
    def close_group(self, group_id: UInt64) -> None:
        """Closes a group. Only the creator can close it."""
        creator = self.group_creator[group_id]
        assert Txn.sender == creator, "Only the group creator can close the group"
        assert self.group_active[group_id] == UInt64(1), "Group already closed"

        self.group_active[group_id] = UInt64(0)

    @abimethod()
    def get_expense_info(self, expense_id: UInt64) -> tuple[UInt64, UInt64, UInt64, UInt64]:
        """Returns (amount, share_per_person, participant_count, settled_count)."""
        payer_val2, exists = self.expense_payer.maybe(expense_id)
        assert exists, "Expense does not exist"

        return (
            self.expense_amount[expense_id],
            self.expense_share[expense_id],
            self.expense_participant_count[expense_id],
            self.expense_settled_count[expense_id],
        )
