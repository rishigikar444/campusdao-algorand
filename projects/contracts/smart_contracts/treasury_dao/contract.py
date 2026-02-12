from algopy import *
from algopy.arc4 import abimethod


class TreasuryDAO(ARC4Contract):

    club_count: UInt64
    proposal_count: UInt64

    def __init__(self) -> None:
        self.club_count = UInt64(0)
        self.proposal_count = UInt64(0)

        # Club state — keyed by club_id
        self.club_creator = BoxMap(UInt64, Account, key_prefix="cc")
        self.club_quorum = BoxMap(UInt64, UInt64, key_prefix="cq")
        self.club_member_count = BoxMap(UInt64, UInt64, key_prefix="cn")
        self.club_treasury = BoxMap(UInt64, UInt64, key_prefix="ct")

        # Membership: key = club_id * 2^32 + member_index => Account
        self.club_members = BoxMap(UInt64, Account, key_prefix="cm")
        # Reverse lookup: is_member key = hash(club_id, account) => UInt64(1)
        self.is_member = BoxMap(Bytes, UInt64, key_prefix="im")

        # Proposal state — keyed by proposal_id
        self.proposal_club = BoxMap(UInt64, UInt64, key_prefix="pc")
        self.proposal_amount = BoxMap(UInt64, UInt64, key_prefix="pa")
        self.proposal_recipient = BoxMap(UInt64, Account, key_prefix="pr")
        self.proposal_votes_for = BoxMap(UInt64, UInt64, key_prefix="pf")
        self.proposal_votes_against = BoxMap(UInt64, UInt64, key_prefix="pg")
        self.proposal_deadline = BoxMap(UInt64, UInt64, key_prefix="pd")
        self.proposal_executed = BoxMap(UInt64, UInt64, key_prefix="pe")
        self.proposal_metadata = BoxMap(UInt64, Bytes, key_prefix="pm")

        # Vote tracking: key = hash(proposal_id, voter) => UInt64(1)
        self.has_voted = BoxMap(Bytes, UInt64, key_prefix="hv")

    def _member_key(self, club_id: UInt64, account: Account) -> Bytes:
        return op.concat(op.itob(club_id), account.bytes)

    def _vote_key(self, proposal_id: UInt64, voter: Account) -> Bytes:
        return op.concat(op.itob(proposal_id), voter.bytes)

    @abimethod()
    def create_club(
        self,
        quorum: UInt64,
        member1: Account,
        member2: Account,
        member3: Account,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Creates a club with up to 3 initial members.
        The caller is always included as a member.
        mbr_pay covers box storage costs."""
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"
        assert quorum > 0, "Quorum must be > 0"

        club_id = self.club_count + UInt64(1)
        self.club_count = club_id

        self.club_creator[club_id] = Txn.sender
        self.club_quorum[club_id] = quorum
        self.club_treasury[club_id] = UInt64(0)

        # Add creator as first member
        member_index = UInt64(0)
        key0 = club_id * UInt64(2**16) + member_index
        self.club_members[key0] = Txn.sender
        self.is_member[self._member_key(club_id, Txn.sender)] = UInt64(1)
        member_index += UInt64(1)

        # Add additional members if they are not zero address and not duplicates
        if member1 != Global.zero_address:
            key1 = club_id * UInt64(2**16) + member_index
            self.club_members[key1] = member1
            self.is_member[self._member_key(club_id, member1)] = UInt64(1)
            member_index += UInt64(1)

        if member2 != Global.zero_address:
            key2 = club_id * UInt64(2**16) + member_index
            self.club_members[key2] = member2
            self.is_member[self._member_key(club_id, member2)] = UInt64(1)
            member_index += UInt64(1)

        if member3 != Global.zero_address:
            key3 = club_id * UInt64(2**16) + member_index
            self.club_members[key3] = member3
            self.is_member[self._member_key(club_id, member3)] = UInt64(1)
            member_index += UInt64(1)

        self.club_member_count[club_id] = member_index
        assert quorum <= member_index, "Quorum cannot exceed member count"

        return club_id

    @abimethod()
    def deposit(
        self,
        club_id: UInt64,
        pay_txn: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Deposits ALGO into the club treasury. Anyone can deposit."""
        _, exists = self.club_creator.maybe(club_id)
        assert exists, "Club does not exist"
        assert pay_txn.receiver == Global.current_application_address, "Payment must go to app"
        assert pay_txn.amount > 0, "Deposit must be > 0"

        current = self.club_treasury[club_id]
        self.club_treasury[club_id] = current + pay_txn.amount

        return self.club_treasury[club_id]

    @abimethod()
    def create_proposal(
        self,
        club_id: UInt64,
        amount: UInt64,
        recipient: Account,
        deadline_round: UInt64,
        metadata_hash: Bytes,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Creates a spending proposal. Only club members can propose.
        mbr_pay covers box storage for proposal data."""
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"

        # Verify caller is a member
        membership, is_mem = self.is_member.maybe(self._member_key(club_id, Txn.sender))
        assert is_mem, "Only club members can create proposals"

        assert amount > 0, "Proposal amount must be > 0"
        assert deadline_round > Global.round, "Deadline must be in the future"

        proposal_id = self.proposal_count + UInt64(1)
        self.proposal_count = proposal_id

        self.proposal_club[proposal_id] = club_id
        self.proposal_amount[proposal_id] = amount
        self.proposal_recipient[proposal_id] = recipient
        self.proposal_votes_for[proposal_id] = UInt64(0)
        self.proposal_votes_against[proposal_id] = UInt64(0)
        self.proposal_deadline[proposal_id] = deadline_round
        self.proposal_executed[proposal_id] = UInt64(0)
        self.proposal_metadata[proposal_id] = metadata_hash

        return proposal_id

    @abimethod()
    def vote(
        self,
        proposal_id: UInt64,
        support: UInt64,
    ) -> None:
        """Vote on a proposal. support=1 for yes, support=0 for no.
        1 wallet = 1 vote. Only club members can vote."""
        club_id = self.proposal_club[proposal_id]

        # Verify caller is a member of the club
        _, is_mem = self.is_member.maybe(self._member_key(club_id, Txn.sender))
        assert is_mem, "Only club members can vote"

        # Check not already voted
        vote_key = self._vote_key(proposal_id, Txn.sender)
        _, already_voted = self.has_voted.maybe(vote_key)
        assert not already_voted, "Already voted on this proposal"

        # Check deadline not passed
        assert Global.round <= self.proposal_deadline[proposal_id], "Voting period has ended"

        # Record vote
        self.has_voted[vote_key] = UInt64(1)

        if support == UInt64(1):
            self.proposal_votes_for[proposal_id] = self.proposal_votes_for[proposal_id] + UInt64(1)
        else:
            self.proposal_votes_against[proposal_id] = self.proposal_votes_against[proposal_id] + UInt64(1)

    @abimethod()
    def execute_proposal(self, proposal_id: UInt64) -> None:
        """Executes an approved proposal after deadline + quorum met.
        Sends funds from treasury to the proposal recipient."""
        club_id = self.proposal_club[proposal_id]

        # Must not already be executed
        assert self.proposal_executed[proposal_id] == UInt64(0), "Proposal already executed"

        # Deadline must have passed
        assert Global.round > self.proposal_deadline[proposal_id], "Voting period not over"

        # Quorum check: votes_for >= quorum
        quorum = self.club_quorum[club_id]
        assert self.proposal_votes_for[proposal_id] >= quorum, "Quorum not reached"

        # Must have more for than against
        assert self.proposal_votes_for[proposal_id] > self.proposal_votes_against[proposal_id], "Proposal not approved"

        # Check treasury has enough
        amount = self.proposal_amount[proposal_id]
        treasury = self.club_treasury[club_id]
        assert treasury >= amount, "Insufficient treasury balance"

        # Execute payment
        recipient = self.proposal_recipient[proposal_id]
        itxn.Payment(receiver=recipient, amount=amount, fee=0).submit()

        # Update state
        self.club_treasury[club_id] = treasury - amount
        self.proposal_executed[proposal_id] = UInt64(1)

    @abimethod()
    def get_treasury_balance(self, club_id: UInt64) -> UInt64:
        """Returns the treasury balance for a club."""
        _, exists = self.club_creator.maybe(club_id)
        assert exists, "Club does not exist"
        return self.club_treasury[club_id]

    @abimethod()
    def get_proposal_info(self, proposal_id: UInt64) -> tuple[UInt64, UInt64, UInt64, UInt64, UInt64]:
        """Returns (amount, votes_for, votes_against, deadline, executed) for a proposal."""
        _, exists = self.proposal_club.maybe(proposal_id)
        assert exists, "Proposal does not exist"

        return (
            self.proposal_amount[proposal_id],
            self.proposal_votes_for[proposal_id],
            self.proposal_votes_against[proposal_id],
            self.proposal_deadline[proposal_id],
            self.proposal_executed[proposal_id],
        )
