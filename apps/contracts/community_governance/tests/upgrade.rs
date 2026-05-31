//! Contract upgrade mechanism tests — issue #284.
//!
//! Acceptance criteria:
//!   1. propose_upgrade() restricted to admin
//!   2. 48-hour timelock before upgrade takes effect
//!   3. Upgrade announcement event emitted
//!   4. Timelock cancellable by admin within window
//!   5. Tests for upgrade flow and cancellation

use community_governance::{CommunityGovernance, CommunityGovernanceClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    BytesN, Env,
};

/// 48 hours in ledgers (10-second ledger time).
const UPGRADE_TIMELOCK_LEDGERS: u32 = 17_280;

fn setup() -> (Env, soroban_sdk::Address, CommunityGovernanceClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(CommunityGovernance, ());
    let client = CommunityGovernanceClient::new(&env, &id);
    let admin = soroban_sdk::Address::generate(&env);
    client.initialize(&admin, &100_u32, &100_u32);
    (env, admin, client)
}

fn wasm_hash(env: &Env, val: u8) -> BytesN<32> {
    BytesN::from_array(env, &[val; 32])
}

/// AC1 + AC3: propose_upgrade emits an announcement event.
#[test]
fn propose_upgrade_emits_event() {
    let (env, admin, client) = setup();
    let hash = wasm_hash(&env, 0xAB);

    client.propose_upgrade(&admin, &hash);

    let events = env.events().all();
    assert!(!events.is_empty(), "expected at least one event");
}

/// AC1: propose_upgrade is restricted to admin — non-admin panics.
#[test]
#[should_panic]
fn propose_upgrade_non_admin_rejected() {
    let (env, _admin, client) = setup();
    let attacker = soroban_sdk::Address::generate(&env);
    client.propose_upgrade(&attacker, &wasm_hash(&env, 1));
}

/// AC2: execute_upgrade before timelock elapses panics with "timelock not elapsed".
#[test]
#[should_panic(expected = "timelock not elapsed")]
fn execute_upgrade_before_timelock_panics() {
    let (env, admin, client) = setup();
    client.propose_upgrade(&admin, &wasm_hash(&env, 2));

    // Advance only half the timelock
    env.ledger()
        .with_mut(|l| l.sequence_number += UPGRADE_TIMELOCK_LEDGERS / 2);

    client.execute_upgrade(&admin);
}

/// AC4: cancel_upgrade removes the pending proposal.
#[test]
fn cancel_upgrade_clears_pending() {
    let (env, admin, client) = setup();
    client.propose_upgrade(&admin, &wasm_hash(&env, 3));

    assert!(client.pending_upgrade().is_some());

    client.cancel_upgrade(&admin);

    assert!(client.pending_upgrade().is_none());
}

/// AC4: cancel_upgrade is restricted to admin.
#[test]
#[should_panic]
fn cancel_upgrade_non_admin_rejected() {
    let (env, admin, client) = setup();
    client.propose_upgrade(&admin, &wasm_hash(&env, 4));

    let attacker = soroban_sdk::Address::generate(&env);
    client.cancel_upgrade(&attacker);
}

/// Cancelling when no upgrade is pending panics.
#[test]
#[should_panic(expected = "no pending upgrade")]
fn cancel_upgrade_no_pending_panics() {
    let (env, admin, client) = setup();
    client.cancel_upgrade(&admin);
}

/// Proposing a second upgrade while one is pending panics.
#[test]
#[should_panic(expected = "upgrade already pending")]
fn propose_upgrade_while_pending_panics() {
    let (env, admin, client) = setup();
    client.propose_upgrade(&admin, &wasm_hash(&env, 5));
    client.propose_upgrade(&admin, &wasm_hash(&env, 6));
}

/// After cancellation a new upgrade can be proposed.
#[test]
fn propose_upgrade_after_cancel_succeeds() {
    let (env, admin, client) = setup();
    client.propose_upgrade(&admin, &wasm_hash(&env, 7));
    client.cancel_upgrade(&admin);
    // Should not panic
    client.propose_upgrade(&admin, &wasm_hash(&env, 8));
    assert!(client.pending_upgrade().is_some());
}

/// pending_upgrade returns None when no upgrade is queued.
#[test]
fn pending_upgrade_none_when_empty() {
    let (_env, _admin, client) = setup();
    assert!(client.pending_upgrade().is_none());
}

/// pending_upgrade returns the correct wasm hash after proposal.
#[test]
fn pending_upgrade_returns_correct_hash() {
    let (env, admin, client) = setup();
    let hash = wasm_hash(&env, 0xCC);
    client.propose_upgrade(&admin, &hash);

    let pending = client.pending_upgrade().expect("should have pending upgrade");
    assert_eq!(pending.new_wasm_hash, hash);
}

/// The unlock_ledger is set to current_ledger + UPGRADE_TIMELOCK_LEDGERS.
#[test]
fn pending_upgrade_unlock_ledger_is_correct() {
    let (env, admin, client) = setup();
    let current = env.ledger().sequence();
    client.propose_upgrade(&admin, &wasm_hash(&env, 0xDD));

    let pending = client.pending_upgrade().unwrap();
    assert_eq!(pending.unlock_ledger, current + UPGRADE_TIMELOCK_LEDGERS);
}
