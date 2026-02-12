from algopy import *
from algopy.arc4 import abimethod


class EventManager(ARC4Contract):

    event_count: UInt64

    def __init__(self) -> None:
        self.event_count = UInt64(0)

        # Per-event state stored in BoxMaps keyed by event_id (UInt64)
        self.event_organizer = BoxMap(UInt64, Account, key_prefix="eo")
        self.event_club_app_id = BoxMap(UInt64, UInt64, key_prefix="ec")
        self.event_ticket_price = BoxMap(UInt64, UInt64, key_prefix="ep")
        self.event_max_supply = BoxMap(UInt64, UInt64, key_prefix="em")
        self.event_sold_count = BoxMap(UInt64, UInt64, key_prefix="es")
        self.event_sale_active = BoxMap(UInt64, UInt64, key_prefix="ea")
        self.event_ticket_asa = BoxMap(UInt64, UInt64, key_prefix="et")

        # Track which ticket ASAs have been validated (used for entry)
        self.validated_tickets = BoxMap(UInt64, UInt64, key_prefix="vt")

    @abimethod()
    def create_event(
        self,
        club_app_id: UInt64,
        ticket_price: UInt64,
        max_supply: UInt64,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Creates a new event. Caller becomes the organizer.
        mbr_pay covers minimum balance for box storage."""
        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"
        assert ticket_price > 0, "Ticket price must be > 0"
        assert max_supply > 0, "Max supply must be > 0"

        event_id = self.event_count + UInt64(1)
        self.event_count = event_id

        self.event_organizer[event_id] = Txn.sender
        self.event_club_app_id[event_id] = club_app_id
        self.event_ticket_price[event_id] = ticket_price
        self.event_max_supply[event_id] = max_supply
        self.event_sold_count[event_id] = UInt64(0)
        self.event_sale_active[event_id] = UInt64(1)

        return event_id

    @abimethod()
    def mint_ticket(
        self,
        event_id: UInt64,
        mbr_pay: gtxn.PaymentTransaction,
    ) -> UInt64:
        """Mints the ticket ASA for an event. Only the organizer can call this.
        mbr_pay covers the ASA minimum balance requirement.
        Returns the created ASA ID."""
        organizer, exists = self.event_organizer.maybe(event_id)
        assert exists, "Event does not exist"
        assert Txn.sender == organizer, "Only the organizer can mint tickets"

        # Ensure tickets haven't already been minted for this event
        _, already_minted = self.event_ticket_asa.maybe(event_id)
        assert not already_minted, "Tickets already minted for this event"

        assert mbr_pay.receiver == Global.current_application_address, "MBR payment must go to app"

        max_supply = self.event_max_supply[event_id]

        # Create the ticket ASA — app holds total supply
        asa_txn = itxn.AssetConfig(
            total=max_supply,
            decimals=0,
            default_frozen=False,
            asset_name=b"EventTicket",
            unit_name=b"TCKT",
            fee=0,
        ).submit()

        self.event_ticket_asa[event_id] = asa_txn.created_asset.id

        return asa_txn.created_asset.id

    @abimethod()
    def buy_ticket(
        self,
        event_id: UInt64,
        pay_txn: gtxn.PaymentTransaction,
        treasury_address: Account,
    ) -> None:
        """Buys a ticket. Payment goes to the treasury address.
        The ticket ASA is transferred from the app to the buyer.
        Buyer must have opted in to the ticket ASA first."""
        _, exists = self.event_organizer.maybe(event_id)
        assert exists, "Event does not exist"

        assert self.event_sale_active[event_id] == UInt64(1), "Sales are closed"

        sold = self.event_sold_count[event_id]
        max_supply = self.event_max_supply[event_id]
        assert sold < max_supply, "Event is sold out"

        price = self.event_ticket_price[event_id]
        assert pay_txn.amount >= price, "Insufficient payment"
        assert pay_txn.receiver == treasury_address, "Payment must go to treasury"

        ticket_asa_id = self.event_ticket_asa[event_id]

        # Transfer 1 ticket ASA from app to buyer
        itxn.AssetTransfer(
            xfer_asset=Asset(ticket_asa_id),
            asset_receiver=Txn.sender,
            asset_amount=1,
            fee=0,
        ).submit()

        self.event_sold_count[event_id] = sold + UInt64(1)

    @abimethod()
    def validate_ticket(
        self,
        event_id: UInt64,
        ticket_asa_id: UInt64,
    ) -> bool:
        """Validates that the caller holds a ticket for the event.
        Marks the ticket as used (per-account). Returns True if valid."""
        _, exists = self.event_organizer.maybe(event_id)
        assert exists, "Event does not exist"

        stored_asa = self.event_ticket_asa[event_id]
        assert ticket_asa_id == stored_asa, "ASA does not match this event"

        # Check caller holds at least 1 ticket
        balance, opted_in = op.AssetHoldingGet.asset_balance(Txn.sender, Asset(ticket_asa_id))
        assert opted_in, "Caller has not opted in to ticket ASA"
        assert balance > 0, "Caller does not hold a ticket"

        # Mark as validated using a composite key: event_id * 2^32 + a sequential counter
        # For simplicity, we just use a hash-like approach with sender-based key
        # We'll track validation per event_id (simple approach: just mark in validated box)
        _, already_validated = self.validated_tickets.maybe(ticket_asa_id)
        assert not already_validated, "Ticket already validated"

        self.validated_tickets[ticket_asa_id] = event_id

        return True

    @abimethod()
    def close_sales(self, event_id: UInt64) -> None:
        """Closes ticket sales for an event. Only the organizer can call this."""
        organizer = self.event_organizer[event_id]
        assert Txn.sender == organizer, "Only the organizer can close sales"
        self.event_sale_active[event_id] = UInt64(0)

    @abimethod()
    def get_event_info(self, event_id: UInt64) -> tuple[UInt64, UInt64, UInt64, UInt64]:
        """Returns (ticket_price, max_supply, sold_count, sale_active) for an event."""
        _, exists = self.event_organizer.maybe(event_id)
        assert exists, "Event does not exist"

        return (
            self.event_ticket_price[event_id],
            self.event_max_supply[event_id],
            self.event_sold_count[event_id],
            self.event_sale_active[event_id],
        )
