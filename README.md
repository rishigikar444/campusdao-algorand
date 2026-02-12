# Campus SuperApp on Algorand

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/) (running)
- [Node.js](https://nodejs.org/) 20+ and npm
- [Python](https://www.python.org/) 3.12+
- [Poetry](https://python-poetry.org/) (Python dependency manager)
- [AlgoKit CLI](https://developer.algorand.org/docs/get-details/algokit/) v2.0.0+

### 1. Clone and bootstrap

```bash
git clone <your-repo-url>
cd Hackathon-QuickStart-template
algokit project bootstrap all
```

### 2. Start LocalNet (optional, for local development)

```bash
algokit localnet start
```

### 3. Build smart contracts

```bash
cd projects/contracts
poetry install
poetry run python -m smart_contracts build
```

### 4. Deploy smart contracts

```bash
cd projects/contracts
poetry run python -m smart_contracts deploy
```

Set `DEPLOYER_MNEMONIC` and `DISPENSER_MNEMONIC` environment variables for TestNet/MainNet deploys.

### 5. Run the frontend

```bash
cd projects/frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### 6. Environment variables (Frontend)

Create `projects/frontend/.env`:

```bash
VITE_ALGOD_SERVER=https://testnet-api.algonode.cloud
VITE_ALGOD_PORT=
VITE_ALGOD_TOKEN=
VITE_ALGOD_NETWORK=testnet

VITE_INDEXER_SERVER=https://testnet-idx.algonode.cloud
VITE_INDEXER_PORT=
VITE_INDEXER_TOKEN=

# Optional: Pinata for NFT/IPFS uploads
VITE_PINATA_JWT=<your-pinata-jwt>
VITE_PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs
```

For LocalNet, use `http://localhost:4001` for Algod and `http://localhost:8980` for Indexer.

---

## What is this?

Campus SuperApp is a web application built on Algorand that brings three core campus utilities into a single platform with shared wallet identity and atomic transaction interoperability:

1. **NFT Event Ticketing** -- Create events, mint ticket NFTs, sell them, validate entry, and route revenue to a club treasury.
2. **Club Treasury + Governance Voting** -- Manage club funds with on-chain deposits, spending proposals, member voting, and automated fund execution.
3. **Expense Splitting (Splitwise)** -- Create groups, log shared expenses, track per-person balances, and settle debts on-chain.

---

## Smart Contracts

Three stateful smart contracts are deployed, all written in [Algorand Python (algopy)](https://algorand.github.io/puya/):

### EventManager (`smart_contracts/event_manager/contract.py`)

Handles the full event ticketing lifecycle. Tickets are minted as ASAs (Algorand Standard Assets) held by the contract and transferred to buyers on purchase.

| Method | Description |
|---|---|
| `create_event(club_app_id, ticket_price, max_supply, mbr_pay)` | Creates a new event. Caller becomes the organizer. |
| `mint_ticket(event_id, mbr_pay)` | Mints the ticket ASA for an event (organizer only). Returns the ASA ID. |
| `buy_ticket(event_id, pay_txn, treasury_address)` | Buys a ticket. Payment goes to the treasury; ticket ASA is transferred to the buyer. |
| `validate_ticket(event_id, ticket_asa_id)` | Validates that the caller holds a ticket and marks it as used. |
| `close_sales(event_id)` | Closes ticket sales (organizer only). |
| `get_event_info(event_id)` | Returns `(ticket_price, max_supply, sold_count, sale_active)`. |

**State**: Per-event box storage for organizer, club app ID, ticket price, max supply, sold count, sale status, and ticket ASA ID. Validated tickets are tracked in a separate box map.

### TreasuryDAO (`smart_contracts/treasury_dao/contract.py`)

Manages club treasuries with on-chain governance. Members create spending proposals, vote, and execute approved disbursements.

| Method | Description |
|---|---|
| `create_club(quorum, member1, member2, member3, mbr_pay)` | Creates a club with up to 3 additional members. Caller is always included. |
| `deposit(club_id, pay_txn)` | Deposits ALGO into the club treasury. Anyone can deposit. |
| `create_proposal(club_id, amount, recipient, deadline_round, metadata_hash, mbr_pay)` | Creates a spending proposal (members only). |
| `vote(proposal_id, support)` | Votes on a proposal. `1` = yes, `0` = no. One wallet, one vote. |
| `execute_proposal(proposal_id)` | Executes an approved proposal after deadline + quorum. Sends funds via inner transaction. |
| `get_treasury_balance(club_id)` | Returns the treasury balance. |
| `get_proposal_info(proposal_id)` | Returns `(amount, votes_for, votes_against, deadline, executed)`. |

**Rules**: Only members can propose and vote. Execution requires the voting deadline to have passed, quorum met, and more votes for than against.

### Splitwise (`smart_contracts/splitwise/contract.py`)

On-chain expense splitting. Groups of up to 4 members can log shared expenses and settle debts with verified on-chain payments.

| Method | Description |
|---|---|
| `create_group(member1, member2, member3, mbr_pay)` | Creates a group. Caller is always the first member. Up to 3 additional members. |
| `add_expense(group_id, amount, participant1, participant2, participant3, mbr_pay)` | Logs a shared expense. Caller is the payer. Per-person share is `amount / participant_count`. |
| `settle_expense(expense_id, pay_txn)` | Settles the caller's share by paying the original payer. Prevents double settlement. |
| `close_group(group_id)` | Closes the group (creator only). |
| `get_expense_info(expense_id)` | Returns `(amount, share_per_person, participant_count, settled_count)`. |

**Constraints**: Only group members can add expenses. Participants must be group members. The payer cannot settle with themselves. Each participant can only settle once per expense.

---

## Cross-Module Interactions

### Ticket Revenue to Treasury

When a ticket is purchased via `buy_ticket`, the payment is sent directly to the treasury address. This links event revenue to the club's on-chain treasury.

### Treasury to Expense Reimbursement

1. An expense is logged in the Splitwise contract.
2. A corresponding proposal is created in the TreasuryDAO to reimburse the payer.
3. If the proposal passes governance, the treasury pays the payer via `execute_proposal`.

---

## Frontend Pages

| Route | Features |
|---|---|
| `/events` | Create events, buy tickets, view owned NFTs |
| `/treasury` | View balance, create/vote on proposals |
| `/splitwise` | Create groups, log expenses, settle debts |

Shared components: wallet connect, QR scanner, transaction signer.

**Tech stack**: React 18, TypeScript, Vite, TailwindCSS, DaisyUI, AlgoKit Utils, `@txnlab/use-wallet-react`.

---

## Project Structure

```
.
├── projects/
│   ├── contracts/               # Algorand smart contracts (Python/algopy)
│   │   └── smart_contracts/
│   │       ├── event_manager/   # EventManager contract
│   │       ├── treasury_dao/    # TreasuryDAO contract
│   │       ├── splitwise/       # Splitwise contract
│   │       └── artifacts/       # Compiled TEAL output
│   └── frontend/                # React frontend
│       └── src/
│           ├── contracts/       # Generated TypeScript clients
│           └── components/      # UI components
├── impl.md                      # Detailed implementation plan
└── README.md
```

---

## Demo Flow

Create Event -> Sell Tickets -> Funds to Treasury -> Log Expense -> Vote on Proposal -> Reimburse Payer
