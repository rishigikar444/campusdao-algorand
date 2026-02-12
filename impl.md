# Project Plan — Campus SuperApp on Algorand

## Objective
Build a web superapp on Algorand that integrates:

1. NFT Event Ticketing  
2. Club Treasury + Governance Voting  
3. Expense Splitting (Splitwise)  

All modules must interoperate via atomic transactions and shared wallet identity.

---

# Contract Architecture

Deploy 3 Stateful Smart Contracts:

1. EventManagerApp
2. TreasuryDAOApp
3. SplitwiseApp

Tickets are minted as ASAs, not separate apps.

---

# Module 1 — Event Ticketing

## Features
- Create event
- Mint ticket NFTs
- Sell tickets
- Validate entry
- Route revenue to treasury

## Global State

EventID → {
  club_app_id
  ticket_price
  max_supply
  sold_count
  sale_active
}

## Functions

create_event(club_app_id, price, supply)

mint_ticket(event_id)

buy_ticket(event_id)
→ Atomic group:
   Payment txn
   ASA transfer
   Revenue → Treasury

validate_ticket(event_id, ticket_asa_id)

close_sales(event_id)

## Constraints
- Cannot exceed max supply
- Only organizer can mint
- Sale toggle enforced

---

# Module 2 — Club Treasury + Governance

## Features
- Club treasury wallet
- Fund deposits
- Spending proposals
- Voting
- Fund execution

## Global State

ClubID → {
  members[]
  quorum
  treasury_balance
}

ProposalID → {
  amount
  recipient
  votes_for
  votes_against
  deadline
  executed
}

## Functions

create_club(members, quorum)

deposit()

create_proposal(amount, recipient, metadata_hash)

vote(proposal_id, support)

execute_proposal(proposal_id)

## Rules
- 1 wallet = 1 vote
- Only members propose/vote
- Execution after quorum + deadline

---

# Module 3 — Expense Splitting

## Features
- Create groups
- Add shared expenses
- Track balances
- Settle payments

## Global State

GroupID → {
  members[]
}

ExpenseID → {
  payer
  amount
  participants[]
  settled[]
}

## Functions

create_group(members)

add_expense(group_id, payer, amount, participants)

calculate_balances(group_id)

settle_expense(expense_id)
→ Atomic payment to payer

close_group(group_id)

## Constraints
- Only members add expenses
- Prevent duplicate settlement
- Partial settlement tracking

---

# Cross-Module Interactions

## Ticket Revenue → Treasury

Atomic txn group:

1. Buyer payment
2. Ticket ASA transfer
3. Funds routed to Treasury app

Ensure treasury is mandatory receiver.

---

## Treasury → Expense Reimbursement

Flow:

1. Expense logged in Splitwise
2. Proposal created in Treasury
3. If approved → treasury pays payer

Validate recipient matches expense payer.

---

## Optional — Ticket-Gated Voting

Treasury checks ASA ownership before allowing vote.

---

# Atomic Transaction Groups

Implement for:

- Ticket purchase
- Expense settlement
- Treasury fund execution

Max group size: 16 txns.

---

# Frontend Modules

Pages:

/events
- Create event
- Buy tickets
- View owned NFTs

/treasury
- View balance
- Proposals
- Vote

/splitwise
- Groups
- Expenses
- Settle debts

Shared Components:

- Wallet connect
- QR scanner
- Transaction signer

---

# Data & Indexing

Use Algorand Indexer for:

- User tickets
- Event sales
- Treasury txns
- Expense settlements

Cache in backend if needed.

---

# Security Requirements

- Enforce role permissions
- Prevent overselling
- Prevent double voting
- Prevent double settlement
- Treasury withdrawals via proposals only
- Validate ASA ownership where required

---

# MVP Scope (Hackathon)

Must Have:

- Event creation + ticket mint
- Ticket purchase atomic txn
- Treasury deposits
- Proposal voting
- Expense logging
- Settlement payments

Nice to Have:

- Ticket validation QR
- Net debt simplification
- Ticket resale royalties
- Ticket-gated governance

---

# Deliverables

- 3 deployed Algorand apps
- ASA ticket minting
- Atomic txn scripts
- Web dashboard
- Demo flow:

Create Event → Sell Tickets → Funds to Treasury → Log Expense → Vote → Reimburse

---

End of Plan