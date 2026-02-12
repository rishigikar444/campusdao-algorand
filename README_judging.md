# 🚀 Campus SuperApp on Algorand

### A Unified Web3 SuperApp for Campus Ecosystems

Built on **Algorand** with Atomic Transactions & Wallet Identity

------------------------------------------------------------------------

## 🌟 Vision

Universities operate in silos:

-   Event ticketing is centralized\
-   Club funds lack transparency\
-   Expense splitting is manual\
-   Voting systems are outdated

**Algo campus** transforms campus infrastructure into a transparent,
decentralized, wallet-powered ecosystem using Algorand.

------------------------------------------------------------------------

## 🧠 What We Built

A fully integrated **Campus SuperApp** powered by a single wallet
identity.

### 🔗 Core Principle

All modules interoperate via **Algorand Atomic Transactions**.

> One wallet. One identity. Multiple interoperable systems.

------------------------------------------------------------------------

# 🧩 Modules Implemented

## 1️⃣ NFT Event Ticketing 🎟️

Events mint NFT-based tickets.

Each ticket: - Is unique\
- Is verifiable on-chain\
- Cannot be duplicated

Ownership is tracked via Algorand wallet.\
Ticket purchase uses an atomic **Payment + NFT Mint** transaction.

### ✅ Features Implemented

-   Smart contract for event creation\
-   NFT minting on ticket purchase\
-   Wallet-based verification\
-   Atomic transaction: Payment + NFT mint

### 🚀 Why It's Powerful

-   No fake tickets\
-   Transparent revenue\
-   Transferable ticket ownership\
-   Future resale capability

------------------------------------------------------------------------

## 2️⃣ Club Treasury + Governance 💰🗳️

Every campus club operates like a DAO.

### Treasury

-   On-chain treasury account\
-   All funds publicly trackable\
-   Only approved proposals can withdraw funds

### Governance Voting

-   Proposal creation\
-   On-chain voting\
-   Weighted voting logic (configurable)\
-   Transparent result calculation

### ✅ Features Implemented

-   Smart contract for proposal creation\
-   Vote casting transaction\
-   Treasury management logic\
-   Atomic proposal execution

### 🚀 Why It's Powerful

-   No opaque fund usage\
-   Democratic club governance\
-   Fully transparent finance

------------------------------------------------------------------------

## 3️⃣ Expense Splitting (Web3 Splitwise) 💸

A decentralized expense tracker.

-   Users split bills\
-   Records stored via blockchain logic\
-   Settlement via Algorand transactions

### ✅ Features Implemented

-   Expense creation\
-   Multi-party split logic\
-   Settlement transactions\
-   Wallet identity mapping

### 🚀 Why It's Powerful

-   No trust required\
-   Transparent balances\
-   Direct blockchain settlements

------------------------------------------------------------------------

# 🏗 Tech Architecture

## Frontend

-   Next.js\
-   React\
-   Tailwind CSS\
-   Algorand Wallet Integration

## Smart Contracts

-   Python (AlgoKit)\
-   Algorand Smart Contracts\
-   Atomic transaction groups

## Blockchain

-   Algorand Testnet\
-   ASA (Algorand Standard Assets) for NFTs\
-   Atomic grouped transactions

------------------------------------------------------------------------

# ⚙️ How It Works (Technical Flow)

### Example: Buying Event Ticket

1.  User connects wallet\
2.  Smart contract validates event\
3.  Atomic transaction group:
    -   Payment → Event Treasury\
    -   NFT Mint → User Wallet\
4.  Transaction confirmed\
5.  NFT visible in wallet

All executed in one irreversible atomic operation.

------------------------------------------------------------------------

# 🔐 Why Algorand?

-   Instant Finality (\~4.5s)\
-   Low Fees\
-   Native Atomic Transactions\
-   ASA Standard (perfect for NFTs)\
-   Secure & Scalable

Algorand makes campus-scale blockchain practical.

------------------------------------------------------------------------

# 📂 Repository Structure

    algo-dhanda/
    │
    ├── frontend/                # Next.js frontend
    ├── smart_contracts/         # AlgoKit contracts
    ├── deploy_config.py         # Deployment config
    ├── contracts.py             # Core smart contract logic
    ├── README.md

------------------------------------------------------------------------

# 🧪 Deployment

## Prerequisites

-   Python 3.10+\
-   AlgoKit\
-   Node.js\
-   Algorand Testnet Wallet

## Deploy Contracts

``` bash
algokit project deploy testnet
```

## Run Frontend

``` bash
npm install
npm run dev
```

------------------------------------------------------------------------

# 🏆 Innovation Highlights

-   Cross-module wallet identity\
-   Atomic inter-module execution\
-   Unified Campus SuperApp model\
-   DAO-style student governance\
-   NFT infrastructure for events

------------------------------------------------------------------------

# 🚀 Final Statement

Algo Dhanda is a blueprint for the future of campus infrastructure.

**Transparent. Programmable. Decentralized.**

Built on Algorand.
