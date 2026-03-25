#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec, Bytes};
use common_utils::error::{AuthorizationError, StateError, ValidationError, ContractError};
use common_utils::{rate_limit, rate_limit_adaptive};
use common_utils::rate_limit::{RateLimiter, TrustTier};
use common_utils::storage_optimization::{ScoreStorage, DataSeparator, DataTemperature};
use common_utils::storage_monitoring::{StorageTracker, PerformanceMonitor};
use common_utils::data_migration::{DataMigrationManager, MigrationConfig, CompressionType};
use common_utils::compression::{CompressionManager, CompressionType};
use common_utils::dex::{DexAdapter, StellarDexAdapter, TokenPair, DexConfig};
use common_utils::dex::trading_data::{TradingData, TradingVolume, PriceData};
use common_utils::dex::liquidity::{LiquidityMetrics, PoolInfo};
use common_utils::dex::scoring_signals::{SignalAggregator, ScoringSignal, SignalType, SignalWeight};
use common_utils::dex::cache::{DexDataCache, CacheConfig};
use common_utils::state_machine::{State, StateMachine, CreditScoreState};
use common_utils::{state_guard, transition_to};
use common_utils::fees::FeeModule;
use common_utils::treasury::TreasuryModule;

#[contracttype]
pub enum DataKey {
    Admin,
    Score(Address),
    Factors(Address),
    MigrationState,
    DexConfig,
    SupportedPairs,
    TradingDataCache(TokenPair),
    ScoreSignals(Address),
    DexEnabled,
    ContractState,
}

#[contract]
pub struct CreditScoreContract;

impl StateMachine<CreditScoreState> for CreditScoreContract {
    fn get_state(env: &Env) -> State<CreditScoreState> {
        env.storage()
            .instance()
            .get(&DataKey::ContractState)
            .unwrap_or(State::Uninitialized)
    }

    fn set_state(env: &Env, state: State<CreditScoreState>) {
        env.storage().instance().set(&DataKey::ContractState, &state);
    }
}

#[contractimpl]
impl CreditScoreContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), StateError> {
        // Ensure contract is uninitialized
        let current_state = Self::get_state(&env);
        if !current_state.is_uninitialized() {
            return Err(StateError::AlreadyInitialized);
        }

        // Transition to Active state
        let initial_state = State::Active(CreditScoreState {
            admin: admin.clone(),
            total_scores: 0,
        });
        
        transition_to!(Self, &env, initial_state)?;
        
        // Store admin for backward compatibility
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::DexEnabled, &true);
        
        let dex_config = DexConfig::default();
        env.storage().instance().set(&DataKey::DexConfig, &dex_config);
        
        Ok(())
    }

    pub fn initialize_dex(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        
        StellarDexAdapter::initialize(&env)
            .map_err(|_| ContractError::InvalidState)?;
        
        env.storage().instance().set(&DataKey::DexEnabled, &true);
        
        Ok(())
    }

    pub fn add_supported_pair(env: Env, admin: Address, pair: TokenPair) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        
        let mut adapter = StellarDexAdapter::new(&env);
        adapter.add_supported_pair(pair.clone())
            .map_err(|_| ContractError::InvalidState)?;
        
        let mut pairs: Vec<TokenPair> = env.storage().instance()
            .get(&DataKey::SupportedPairs)
            .unwrap_or_else(|| Vec::new(&env));
        pairs.push_back(pair);
        env.storage().instance().set(&DataKey::SupportedPairs, &pairs);
        
        Ok(())
    }

    pub fn set_dex_config(env: Env, admin: Address, config: DexConfig) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        config.validate().map_err(|_| ContractError::InvalidConfiguration)?;
        env.storage().instance().set(&DataKey::DexConfig, &config);
        Ok(())
    }

    pub fn get_dex_config(env: Env) -> DexConfig {
        env.storage().instance()
            .get(&DataKey::DexConfig)
            .unwrap_or_else(|| DexConfig::default())
    }

    pub fn set_user_trust_tier(
        env: Env,
        admin: Address,
        user: Address,
        tier: TrustTier,
    ) -> Result<(), AuthorizationError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AuthorizationError::NotInitialized)?;
        stored_admin.require_auth();
        if stored_admin != admin {
            return Err(AuthorizationError::NotAuthorized);
        }
        RateLimiter::set_trust_tier(&env, &user, &tier);
        Ok(())
    }

    pub fn set_network_load(
        env: Env,
        admin: Address,
        load: u32,
    ) -> Result<(), AuthorizationError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AuthorizationError::NotInitialized)?;
        stored_admin.require_auth();
        if stored_admin != admin {
            return Err(AuthorizationError::NotAuthorized);
        }
        RateLimiter::set_network_load(&env, load);
        Ok(())
    }

    pub fn calculate_score_with_dex(
        env: Env,
        account_id: Address,
        pair: TokenPair,
    ) -> Result<u32, ContractError> {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "calc_dex_score"));
        
        let base_score = Self::get_base_score(&env, &account_id)?;
        
        let dex_enabled: bool = env.storage().instance()
            .get(&DataKey::DexEnabled)
            .unwrap_or(false);
        
        if !dex_enabled {
            return Ok(base_score);
        }
        
        let trading_data = Self::fetch_trading_data(&env, &pair)?;
        let liquidity = Self::fetch_liquidity_metrics(&env, &pair)?;
        
        let aggregator = SignalAggregator::new(&env);
        let signals = aggregator.aggregate(&trading_data, &liquidity);
        
        let adjusted_score = aggregator.calculate_credit_impact(base_score, &signals);
        
        env.storage().instance().set(&DataKey::ScoreSignals(account_id.clone()), &signals);
        
        StorageTracker::record_operation(
            &env,
            &Symbol::new(&env, "dex_score"),
            &Symbol::new(&env, "calc"),
            4,
            false,
        );
        
        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "calc_dex_score"));
        
        // Collect Service Fee (mock amount 1000 for calculation)
        if !FeeModule::is_whitelisted(&env, &account_id) {
            let fee = FeeModule::calculate_service_fee(&env, 1000, false);
            TreasuryModule::collect_and_distribute(&env, &account_id, fee);
        }

        Ok(adjusted_score as u32)
    }

    pub fn calculate_score(
        env: Env,
        account_id: String,
    ) -> Result<u32, ValidationError> {
        if account_id.is_empty() {
            return Err(ValidationError::MissingRequiredField);
        }
        Ok(500)
    }

    pub fn get_score(env: Env, account_id: Address) -> Result<u32, AuthorizationError> {
        rate_limit_adaptive!(env, account_id, "get_score",
            max: 60, window: 3600,
            strategy: TokenBucket, scope: PerUser);

        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "get_score"));
        
        let result = ScoreStorage::get_score(&env, &account_id)
            .map_err(|_| AuthorizationError::NotAuthorized)?;
        
        StorageTracker::record_operation(
            &env, 
            &Symbol::new(&env, "access"), 
            &Symbol::new(&env, "score"), 
            4, 
            false
        );
        
        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "get_score"));
        
        // Collect Usage Fee for API call
        if !FeeModule::is_whitelisted(&env, &account_id) {
            let usage_fee = 10; // Flat usage fee for get_score
            TreasuryModule::collect_and_distribute(&env, &account_id, usage_fee);
        }

        Ok(result)
    }

    pub fn get_score_with_signals(env: Env, account_id: Address) -> Result<ScoreWithSignals, ContractError> {
        let base_score = Self::get_base_score(&env, &account_id)?;
        
        let signals: Vec<ScoringSignal> = env.storage().instance()
            .get(&DataKey::ScoreSignals(account_id.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        
        let aggregator = SignalAggregator::new(&env);
        let dex_adjustment = if !signals.is_empty() {
            aggregator.calculate_score(&signals) as i32 - 50
        } else {
            0
        };
        
        Ok(ScoreWithSignals {
            base_score,
            dex_adjustment,
            signals,
        })
    }

    pub fn update_factors(
        env: Env,
        account_id: Address,
        factors: String,
    ) -> Result<(), AuthorizationError> {
        rate_limit!(env, account_id, "upd_factor",
            max: 20, window: 3600,
            strategy: FixedWindow, scope: Global);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AuthorizationError::NotInitialized)?;
        admin.require_auth();

        let factors_bytes = factors.into_bytes();
        let compressed_factors = CompressionManager::compress(
            &Bytes::from_slice(&env, &factors_bytes), 
            &CompressionType::RunLength
        ).map_err(|_| AuthorizationError::NotAuthorized)?;

        env.storage()
            .persistent()
            .set(&DataKey::Factors(account_id), &compressed_factors);
            
        StorageTracker::record_operation(
            &env, 
            &Symbol::new(&env, "store"), 
            &Symbol::new(&env, "factors"), 
            compressed_factors.len() as u32, 
            true
        );
        
        Ok(())
    }

    pub fn set_score(
        env: Env,
        account_id: Address,
        score: u32,
    ) -> Result<(), AuthorizationError> {
        rate_limit!(env, account_id, "set_score",
            max: 30, window: 3600,
            strategy: SlidingWindow, scope: PerUser);
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AuthorizationError::NotInitialized)?;
        admin.require_auth();

        ScoreStorage::store_score(&env, &account_id, score, env.ledger().timestamp())
            .map_err(|_| AuthorizationError::NotAuthorized)?;
        
        StorageTracker::record_operation(
            &env, 
            &Symbol::new(&env, "store"), 
            &Symbol::new(&env, "score"), 
            44, 
            true
        );
        
        Ok(())
    }

    pub fn batch_calculate_scores(
        env: Env,
        accounts: Vec<Address>,
        pair: TokenPair,
    ) -> Result<Vec<u32>, ContractError> {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "batch_calc"));
        
        let trading_data = Self::fetch_trading_data(&env, &pair)?;
        let liquidity = Self::fetch_liquidity_metrics(&env, &pair)?;
        
        let aggregator = SignalAggregator::new(&env);
        let signals = aggregator.aggregate(&trading_data, &liquidity);
        
        let mut scores = Vec::new(&env);
        
        for account in accounts.iter() {
            let base_score = Self::get_base_score(&env, &account).unwrap_or(500);
            let adjusted = aggregator.calculate_credit_impact(base_score, &signals);
            scores.push_back(adjusted as u32);
        }
        
        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "batch_calc"));
        
        Ok(scores)
    }

    pub fn update_signal_weights(
        env: Env,
        admin: Address,
        weights: Vec<SignalWeight>,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        
        let total_weight: u32 = weights.iter().map(|w| w.weight).sum();
        if total_weight > 100 {
            return Err(ContractError::InvalidConfiguration);
        }
        
        env.storage().instance().set(&Symbol::new(&env, "signal_weights"), &weights);
        Ok(())
    }

    pub fn invalidate_dex_cache(env: Env, admin: Address, pair: TokenPair) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        
        let mut cache = DexDataCache::new(&env);
        cache.invalidate(&pair);
        
        Ok(())
    }
    
    pub fn get_score_history(env: Env, account_id: Address, limit: u32) -> Result<Vec<common_utils::storage_optimization::ScoreData>, AuthorizationError> {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "get_score_history"));
        
        let result = ScoreStorage::get_score_history(&env, &account_id, limit)
            .map_err(|_| AuthorizationError::NotAuthorized)?;
        
        StorageTracker::record_operation(
            &env, 
            &Symbol::new(&env, "access"), 
            &Symbol::new(&env, "history"), 
            0, 
            false
        );
        
        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "get_score_history"));
        
        Ok(result)
    }
    
    pub fn migrate_to_compressed(env: Env, admin: Address) -> Result<u64, ContractError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        
        if stored_admin != admin {
            return Err(ContractError::Unauthorized);
        }
        
        if env.storage().instance().has(&DataKey::MigrationState) {
            return Err(ContractError::InvalidState);
        }
        
        let addresses = Self::get_all_score_addresses(&env);
        
        if addresses.is_empty() {
            return Ok(0);
        }
        
        let config = MigrationConfig {
            batch_size: 20,
            max_retries: 3,
            rollback_enabled: true,
            validation_enabled: true,
            compression_type: CompressionType::BitPacking,
            dry_run: false,
        };
        
        let migration_id = DataMigrationManager::start_migration(&env, &config, &addresses)?;
        
        env.storage().instance().set(&DataKey::MigrationState, &migration_id);
        
        DataMigrationManager::execute_migration(&env, migration_id)?;
        
        Self::cleanup_uncompressed_scores(&env, &addresses)?;
        
        env.storage().instance().remove(&DataKey::MigrationState);
        
        Ok(migration_id)
    }
    
    pub fn get_efficiency_report(env: Env) -> Result<common_utils::storage_monitoring::StorageEfficiencyReport, ContractError> {
        let report = common_utils::storage_monitoring::EfficiencyAnalyzer::analyze_efficiency(&env)?;
        Ok(report)
    }

    pub fn get_dex_cache_stats(env: Env) -> common_utils::dex::cache::CacheStats {
        let cache = DexDataCache::new(&env);
        cache.get_stats()
    }

    fn require_admin(env: &Env, admin: &Address) -> Result<(), ContractError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        
        if stored_admin != *admin {
            return Err(ContractError::Unauthorized);
        }
        admin.require_auth();
        Ok(())
    }

    fn get_base_score(env: &Env, account_id: &Address) -> Result<u32, ContractError> {
        ScoreStorage::get_score(env, account_id)
            .map(|s| s)
            .unwrap_or(500)
    }

    fn fetch_trading_data(env: &Env, pair: &TokenPair) -> Result<TradingData, ContractError> {
        let mut cache = DexDataCache::new(env);
        
        if let Some(data) = cache.get_or_stale(pair) {
            return Ok(data);
        }
        
        let adapter = StellarDexAdapter::new(env);
        let pool_info = adapter.fetch_pool_data(pair)
            .map_err(|_| ContractError::ExternalServiceError)?;
        
        let volume = TradingVolume::new(
            env,
            pair.clone(),
            pool_info.reserve_a / 10,
            pool_info.reserve_b / 10,
            (pool_info.reserve_a + pool_info.reserve_b) / 20,
            1000,
            86400,
        );
        
        let price = PriceData::new(
            env,
            pair.clone(),
            pool_info.price_a_to_b(),
            7,
            "stellar_dex",
        );
        
        let trading_data = TradingData::new(env, pair.clone(), volume, price);
        
        cache.set_trading_data(pair, trading_data.clone(), "stellar_dex");
        
        Ok(trading_data)
    }

    fn fetch_liquidity_metrics(env: &Env, pair: &TokenPair) -> Result<LiquidityMetrics, ContractError> {
        let mut cache = DexDataCache::new(env);
        
        if let Ok(metrics) = cache.get_liquidity_metrics(pair) {
            return Ok(metrics);
        }
        
        let adapter = StellarDexAdapter::new(env);
        let pool_info = adapter.fetch_pool_data(pair)
            .map_err(|_| ContractError::ExternalServiceError)?;
        
        let depth = adapter.get_liquidity_at_levels(pair, 5)
            .map_err(|_| ContractError::ExternalServiceError)?;
        
        let mut metrics = LiquidityMetrics::new(env, pair.clone());
        metrics = metrics.with_total_liquidity(pool_info.tvl_usd);
        metrics.calculate_scores(&depth);
        
        cache.set_liquidity_metrics(pair, metrics.clone(), "stellar_dex");
        
        Ok(metrics)
    }
    
    fn get_all_score_addresses(env: &Env) -> Vec<Symbol> {
        Vec::new(env)
    }
    
    fn cleanup_uncompressed_scores(env: &Env, addresses: &Vec<Symbol>) -> Result<(), ContractError> {
        for address_symbol in addresses.iter() {
            let old_key = DataKey::Score(Address::from_bytes(&Bytes::from_slice(env, address_symbol.to_string().as_bytes())));
            env.storage().persistent().remove(&old_key);
        }
        Ok(())
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ScoreWithSignals {
    pub base_score: u32,
    pub dex_adjustment: i32,
    pub signals: Vec<ScoringSignal>,
}

#[cfg(test)]
mod test;