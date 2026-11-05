#![no_std]
//! EcoStream: streams USDC per second from a user's vault to a green credit
//! issuer, retiring (locking) tokenized carbon credits as value is settled.
//!
//! Units: USDC amounts are in stroops (7 decimals). Carbon credits are tracked
//! in grams of CO2e. `grams_per_usdc` is the credit rate per 1 whole USDC.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;
const STROOPS_PER_USDC: i128 = 10_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    StreamNotFound = 4,
    StreamClosed = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub asset: Address,
    pub oracle: Address,
    pub issuer: Address,
    pub grams_per_usdc: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub owner: Address,
    pub rate: i128,
    pub deposit: i128,
    pub withdrawn: i128,
    pub last_update: u64,
    pub active: bool,
    pub credits_grams: i128,
}

#[contracttype]
pub enum DataKey {
    Config,
    NextId,
    TotalCredits,
    Stream(u64),
}

fn load_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

fn load_stream(env: &Env, id: u64) -> Result<Stream, Error> {
    let key = DataKey::Stream(id);
    let stream: Stream = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::StreamNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    Ok(stream)
}

fn save_stream(env: &Env, id: u64, stream: &Stream) {
    let key = DataKey::Stream(id);
    env.storage().persistent().set(&key, stream);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

/// Amount owed since the last update, capped at the unspent deposit.
fn owed(env: &Env, s: &Stream) -> i128 {
    if !s.active {
        return 0;
    }
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(s.last_update) as i128;
    let remaining = s.deposit - s.withdrawn;
    let accrued = s.rate.saturating_mul(elapsed);
    if accrued > remaining {
        remaining
    } else {
        accrued
    }
}

/// Moves accrued funds to the issuer and locks the matching carbon credits.
fn settle(env: &Env, cfg: &Config, id: u64, s: &mut Stream) -> i128 {
    let amount = owed(env, s);
    if amount > 0 {
        let client = token::Client::new(env, &cfg.asset);
        client.transfer(&env.current_contract_address(), &cfg.issuer, &amount);
        let grams = amount * cfg.grams_per_usdc / STROOPS_PER_USDC;
        s.withdrawn += amount;
        s.credits_grams += grams;
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalCredits)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalCredits, &(total + grams));
        env.events()
            .publish((symbol_short!("settle"), id), (amount, grams));
    }
    s.last_update = env.ledger().timestamp();
    if s.withdrawn >= s.deposit {
        s.active = false;
    }
    amount
}

#[contract]
pub struct EcoStream;

#[contractimpl]
impl EcoStream {
    /// Sets the admin, the USDC asset, the oracle/gateway and the credit issuer.
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: Address,
        oracle: Address,
        issuer: Address,
        grams_per_usdc: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if grams_per_usdc <= 0 {
            return Err(Error::InvalidAmount);
        }
        admin.require_auth();
        let cfg = Config {
            admin,
            asset,
            oracle,
            issuer,
            grams_per_usdc,
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().set(&DataKey::NextId, &1u64);
        env.storage().instance().set(&DataKey::TotalCredits, &0i128);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Locks `deposit` and records a per-second debit `rate` authorized by `owner`.
    pub fn start_stream(env: Env, owner: Address, rate: i128, deposit: i128) -> Result<u64, Error> {
        let cfg = load_config(&env)?;
        owner.require_auth();
        if rate <= 0 || deposit < rate {
            return Err(Error::InvalidAmount);
        }
        token::Client::new(&env, &cfg.asset).transfer(
            &owner,
            &env.current_contract_address(),
            &deposit,
        );
        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        let stream = Stream {
            owner: owner.clone(),
            rate,
            deposit,
            withdrawn: 0,
            last_update: env.ledger().timestamp(),
            active: true,
            credits_grams: 0,
        };
        save_stream(&env, id, &stream);
        env.events()
            .publish((symbol_short!("start"), id), (owner, rate, deposit));
        Ok(id)
    }

    /// Adds funds to an active stream. Accrued value is settled first.
    pub fn top_up(env: Env, id: u64, amount: i128) -> Result<(), Error> {
        let cfg = load_config(&env)?;
        let mut s = load_stream(&env, id)?;
        s.owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if !s.active {
            return Err(Error::StreamClosed);
        }
        settle(&env, &cfg, id, &mut s);
        if !s.active {
            save_stream(&env, id, &s);
            return Err(Error::StreamClosed);
        }
        token::Client::new(&env, &cfg.asset).transfer(
            &s.owner,
            &env.current_contract_address(),
            &amount,
        );
        s.deposit += amount;
        save_stream(&env, id, &s);
        Ok(())
    }

    /// Oracle-authorized settlement: pays the issuer and locks matching credits.
    pub fn withdraw_stream(env: Env, id: u64) -> Result<i128, Error> {
        let cfg = load_config(&env)?;
        cfg.oracle.require_auth();
        let mut s = load_stream(&env, id)?;
        if !s.active {
            return Err(Error::StreamClosed);
        }
        let amount = settle(&env, &cfg, id, &mut s);
        save_stream(&env, id, &s);
        Ok(amount)
    }

    /// Owner-authorized termination: settles accrued value, refunds the rest.
    pub fn close_stream(env: Env, id: u64) -> Result<i128, Error> {
        let cfg = load_config(&env)?;
        let mut s = load_stream(&env, id)?;
        s.owner.require_auth();
        if !s.active {
            return Err(Error::StreamClosed);
        }
        settle(&env, &cfg, id, &mut s);
        let refund = s.deposit - s.withdrawn;
        if refund > 0 {
            token::Client::new(&env, &cfg.asset).transfer(
                &env.current_contract_address(),
                &s.owner,
                &refund,
            );
        }
        s.active = false;
        save_stream(&env, id, &s);
        env.events().publish((symbol_short!("close"), id), refund);
        Ok(refund)
    }

    pub fn get_stream(env: Env, id: u64) -> Result<Stream, Error> {
        load_stream(&env, id)
    }

    /// Amount that would be paid out if settled right now.
    pub fn pending_amount(env: Env, id: u64) -> Result<i128, Error> {
        let s = load_stream(&env, id)?;
        Ok(owed(&env, &s))
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        load_config(&env)
    }

    pub fn total_credits_grams(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalCredits)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    const USDC: i128 = STROOPS_PER_USDC;

    struct Ctx<'a> {
        env: Env,
        client: EcoStreamClient<'a>,
        token: TokenClient<'a>,
        user: Address,
        issuer: Address,
    }

    fn setup<'a>() -> Ctx<'a> {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let issuer = Address::generate(&env);
        let user = Address::generate(&env);
        let asset = env.register_stellar_asset_contract(admin.clone());
        StellarAssetClient::new(&env, &asset).mint(&user, &(1_000 * USDC));
        let id = env.register_contract(None, EcoStream);
        let client = EcoStreamClient::new(&env, &id);
        client.initialize(&admin, &asset, &oracle, &issuer, &25_000);
        let token = TokenClient::new(&env, &asset);
        Ctx {
            env,
            client,
            token,
            user,
            issuer,
        }
    }

    #[test]
    fn cannot_initialize_twice() {
        let c = setup();
        let cfg = c.client.get_config();
        let res = c.client.try_initialize(
            &cfg.admin,
            &cfg.asset,
            &cfg.oracle,
            &cfg.issuer,
            &25_000,
        );
        assert!(res.is_err());
    }

    #[test]
    fn start_locks_deposit() {
        let c = setup();
        let id = c.client.start_stream(&c.user, &1_000, &(100 * USDC));
        assert_eq!(id, 1);
        assert_eq!(c.token.balance(&c.user), 900 * USDC);
        assert_eq!(c.token.balance(&c.client.address), 100 * USDC);
    }

    #[test]
    fn withdraw_pays_issuer_and_locks_credits() {
        let c = setup();
        let id = c.client.start_stream(&c.user, &1_000, &(100 * USDC));
        c.env.ledger().set_timestamp(1_000 + 3_600);
        assert_eq!(c.client.pending_amount(&id), 3_600_000);
        let paid = c.client.withdraw_stream(&id);
        assert_eq!(paid, 3_600_000);
        assert_eq!(c.token.balance(&c.issuer), 3_600_000);
        // 0.36 USDC * 25,000 g per USDC = 9,000 g
        assert_eq!(c.client.get_stream(&id).credits_grams, 9_000);
        assert_eq!(c.client.total_credits_grams(), 9_000);
    }

    #[test]
    fn accrual_is_capped_at_deposit() {
        let c = setup();
        let id = c.client.start_stream(&c.user, &(USDC), &(10 * USDC));
        c.env.ledger().set_timestamp(1_000 + 1_000_000);
        let paid = c.client.withdraw_stream(&id);
        assert_eq!(paid, 10 * USDC);
        assert!(!c.client.get_stream(&id).active);
        assert!(c.client.try_withdraw_stream(&id).is_err());
    }

    #[test]
    fn close_refunds_unspent_balance() {
        let c = setup();
        let id = c.client.start_stream(&c.user, &1_000, &(100 * USDC));
        c.env.ledger().set_timestamp(1_000 + 3_600);
        let refund = c.client.close_stream(&id);
        assert_eq!(refund, 100 * USDC - 3_600_000);
        assert_eq!(c.token.balance(&c.user), 1_000 * USDC - 3_600_000);
        assert_eq!(c.token.balance(&c.issuer), 3_600_000);
        assert_eq!(c.token.balance(&c.client.address), 0);
        assert!(c.client.try_close_stream(&id).is_err());
    }

    #[test]
    fn top_up_extends_stream() {
        let c = setup();
        let id = c.client.start_stream(&c.user, &1_000, &(10 * USDC));
        c.env.ledger().set_timestamp(1_000 + 100);
        c.client.top_up(&id, &(5 * USDC));
        let s = c.client.get_stream(&id);
        assert_eq!(s.deposit, 15 * USDC);
        assert_eq!(s.withdrawn, 100_000);
    }

    #[test]
    fn rejects_invalid_amounts() {
        let c = setup();
        assert!(c.client.try_start_stream(&c.user, &0, &USDC).is_err());
        assert!(c.client.try_start_stream(&c.user, &1_000, &10).is_err());
    }
}
