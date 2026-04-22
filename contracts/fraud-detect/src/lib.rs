//! # Fraud Detection Contract
//!
//! Analyzes transactions for potential fraud and manages fraud reports.
//! Integrates with DEX for trading pattern analysis.

#![no_std]
use common_utils::authorization::{
    CachedAuth, IAuthorizable, Permission, PermissionCache, RoleBasedAuth,
};
use common_utils::compression::FraudReportCompressor;
use common_utils::data_migration::{CompressionType, DataMigrationManager, MigrationConfig};
use common_utils::dex::cache::DexDataCache;
use common_utils::dex::fraud_indicators::{
    DetectionThresholds, FraudIndicator, IndicatorType, OverallRisk, PatternDetector, RiskLevel,
    Severity, TradingPattern,
};
use common_utils::dex::liquidity::LiquidityMetrics;
use common_utils::dex::trading_data::{TradingData, TradingVolume};
use common_utils::dex::{DexAdapter, DexConfig, StellarDexAdapter, TokenPair};
use common_utils::error::CommonError;
use common_utils::error::{AuthorizationError, ContractError, StateError};
use common_utils::migration::DataMigration;
use common_utils::rate_limit::{RateLimiter, TrustTier};
use common_utils::storage_monitoring::{PerformanceMonitor, StorageTracker};
use common_utils::storage_optimization::{CompressedReportStorage, DataSeparator, DataTemperature};
use common_utils::{
    auth, cached_auth, check_authorization, permission, rate_limit, rate_limit_adaptive,
};
use common_utils::state_machine::{State, StateMachine, FraudDetectState};
use common_utils::{state_guard, transition_to};
use common_utils::compliance_log::{ComplianceLogger, ComplianceAction};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env, String, Symbol,
    TryFromVal, Val, Vec,
};

mod batch;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AclContract,
    Reports(Symbol),
    ReportsMetadata(Symbol),
    MigrationState,
    DexConfig,
    DexEnabled,
    FraudIndicators(Symbol),
    DetectionThresholds,
    TradingPatternHistory(Symbol),
    ContractState,
    FlaggedAccount(Address),
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct FraudReport {
    pub score: u32,
    pub reporter: Address,
    pub timestamp: u64,
}

#[contract]
pub struct FraudDetectContract;

impl StateMachine<FraudDetectState> for FraudDetectContract {
    fn get_state(env: &Env) -> State<FraudDetectState> {
        env.storage()
            .instance()
            .get(&DataKey::ContractState)
            .unwrap_or(State::Uninitialized)
    }

    fn set_state(env: &Env, state: State<FraudDetectState>) {
        env.storage().instance().set(&DataKey::ContractState, &state);
    }
}

#[contractimpl]
impl FraudDetectContract {
    pub fn initialize(env: Env, admin: Address, acl_contract: Address) -> Result<(), StateError> {
        // Ensure contract is uninitialized
        let current_state = Self::get_state(&env);
        if !current_state.is_uninitialized() {
            return Err(StateError::AlreadyInitialized);
        }

        // Transition to Active state
        let initial_state = State::Active(FraudDetectState {
            admin: admin.clone(),
            acl_contract: acl_contract.clone(),
            total_reports: 0,
        });
        
        transition_to!(Self, &env, initial_state)?;
        
        // Store admin and ACL for backward compatibility
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AclContract, &acl_contract);
        env.storage().instance().set(&DataKey::DexEnabled, &true);

        let thresholds = DetectionThresholds::new();
        env.storage()
            .instance()
            .set(&DataKey::DetectionThresholds, &thresholds);

        let dex_config = DexConfig::default();
        env.storage()
            .instance()
            .set(&DataKey::DexConfig, &dex_config);

        env.events()
            .publish((symbol_short!("init"),), (admin, acl_contract));
        Ok(())
    }

    pub fn initialize_dex(env: Env, admin: Address) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;

        StellarDexAdapter::initialize(&env).map_err(|_| ContractError::InvalidState)?;

        env.storage().instance().set(&DataKey::DexEnabled, &true);

        Ok(())
    }

    pub fn set_detection_thresholds(
        env: Env,
        admin: Address,
        thresholds: DetectionThresholds,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::DetectionThresholds, &thresholds);
        Ok(())
    }

    pub fn get_detection_thresholds(env: Env) -> DetectionThresholds {
        env.storage()
            .instance()
            .get(&DataKey::DetectionThresholds)
            .unwrap_or_else(|| DetectionThresholds::new())
    }

    pub fn analyze_trading_for_fraud(
        env: Env,
        pair: TokenPair,
    ) -> Result<FraudAnalysisResult, ContractError> {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "analyze_fraud"));

        let dex_enabled: bool = env
            .storage()
            .instance()
            .get(&DataKey::DexEnabled)
            .unwrap_or(false);

        if !dex_enabled {
            return Ok(FraudAnalysisResult {
                indicators: Vec::new(&env),
                overall_risk: OverallRisk {
                    risk_level: RiskLevel::Low,
                    total_score_impact: 0,
                    critical_count: 0,
                    high_count: 0,
                    medium_count: 0,
                    low_count: 0,
                },
                trading_data: None,
            });
        }

        let trading_data = Self::fetch_trading_data(&env, &pair)?;

        let thresholds = Self::get_detection_thresholds(env.clone());
        let detector = PatternDetector::with_thresholds(&env, thresholds);

        let indicators = detector.analyze(&trading_data);
        let overall_risk = detector.overall_risk(&indicators);

        let patterns = detector.detect_patterns(&trading_data);

        env.storage().instance().set(
            &DataKey::FraudIndicators(pair.symbol_a),
            &indicators.clone(),
        );
        env.storage()
            .instance()
            .set(&DataKey::TradingPatternHistory(pair.symbol_a), &patterns);

        StorageTracker::record_operation(
            &env,
            &Symbol::new(&env, "fraud_analysis"),
            &pair.symbol_a,
            100,
            true,
        );

        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "analyze_fraud"));

        Ok(FraudAnalysisResult {
            indicators,
            overall_risk,
            trading_data: Some(trading_data),
        })
    }

    pub fn analyze_transaction(
        env: Env,
        transaction_data: String,
        pair: Option<TokenPair>,
    ) -> bool {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "analyze_txn"));

        if let Some(token_pair) = pair {
            if let Ok(result) = Self::analyze_trading_for_fraud(env.clone(), token_pair) {
                if result.overall_risk.requires_review() {
                    return true;
                }
            }
        }

        let has_suspicious_pattern = transaction_data.len() > 1000;

        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "analyze_txn"));

        has_suspicious_pattern
    }

    pub fn get_risk_score(env: Env, pair: TokenPair) -> u32 {
        if let Ok(result) = Self::analyze_trading_for_fraud(env.clone(), pair) {
            match result.overall_risk.risk_level {
                RiskLevel::Low => 25,
                RiskLevel::Medium => 50,
                RiskLevel::High => 75,
                RiskLevel::Critical => 100,
            }
        } else {
            0
        }
    }

    pub fn get_indicators(env: Env, pair: TokenPair) -> Vec<FraudIndicator> {
        env.storage()
            .instance()
            .get(&DataKey::FraudIndicators(pair.symbol_a))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_trading_patterns(env: Env, pair: TokenPair) -> Vec<TradingPattern> {
        env.storage()
            .instance()
            .get(&DataKey::TradingPatternHistory(pair.symbol_a))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn update_model(env: Env, admin: Address, model_data: Bytes) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;

        env.events().publish(
            (symbol_short!("mdl_upd"),),
            (env.ledger().timestamp(), model_data),
        );
        Ok(())
    }

    pub fn add_reporter(
        env: Env,
        caller: Address,
        reporter: Address,
    ) -> Result<(), AuthorizationError> {
        caller.require_auth();

        let acl: Address = env
            .storage()
            .instance()
            .get(&DataKey::AclContract)
            .ok_or(AuthorizationError::NotInitialized)?;

        if !common_utils::check_permission(
            env.clone(),
            acl,
            caller,
            symbol_short!("fraud"),
            symbol_short!("manage"),
        ) {
            return Err(AuthorizationError::NotAuthorized);
        }

        Ok(())
    }

    pub fn remove_reporter(env: Env, admin: Address, reporter: Address) -> Result<(), CommonError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CommonError::NotInitialized)?;
        stored_admin.require_auth();

        env.events().publish((symbol_short!("rem_rpt"),), reporter);
        Ok(())
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

    pub fn set_network_load(env: Env, admin: Address, load: u32) -> Result<(), AuthorizationError> {
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

    pub fn submit_report(
        env: Env,
        reporter: Address,
        agent_id: Symbol,
        score: u32,
        trading_evidence: Option<TradingEvidence>,
    ) -> Result<(), ContractError> {
        rate_limit_adaptive!(env, reporter, "submit_rpt",
            max: 10, window: 3600,
            strategy: SlidingWindow, scope: PerUser);

        reporter.require_auth();

        let acl: Address = env
            .storage()
            .instance()
            .get(&DataKey::AclContract)
            .ok_or(ContractError::NotInitialized)?;

        if !common_utils::check_permission(
            env.clone(),
            acl,
            reporter.clone(),
            symbol_short!("fraud"),
            symbol_short!("report"),
        ) {
            return Err(ContractError::Unauthorized);
        }

        let mut reports: Vec<FraudReport> = env
            .storage()
            .instance()
            .get(&DataKey::Reports(agent_id.clone()))
            .unwrap_or(Vec::new(&env));

        let mut adjusted_score = score;

        if let Some(evidence) = trading_evidence {
            if let Ok(result) = Self::analyze_trading_for_fraud(env.clone(), evidence.pair.clone())
            {
                let risk_adjustment = match result.overall_risk.risk_level {
                    RiskLevel::Critical => 20,
                    RiskLevel::High => 10,
                    RiskLevel::Medium => 5,
                    RiskLevel::Low => 0,
                };
                adjusted_score = (score + risk_adjustment).min(100);
            }
        }

        let report = FraudReport {
            score: adjusted_score,
            reporter: reporter.clone(),
            timestamp: env.ledger().timestamp(),
        };

        let mut updated_reports = Vec::new(&env);
        for existing_report in reports.iter() {
            updated_reports.push_back(existing_report);
        }
        updated_reports.push_back(report);

        CompressedReportStorage::store_reports(&env, &agent_id, &updated_reports)
            .map_err(|_| ContractError::StorageFull)?;

        CompressedReportStorage::update_latest_score(&env, &agent_id, adjusted_score)
            .map_err(|_| ContractError::StorageFull)?;

        StorageTracker::record_operation(&env, &symbol_short!("store"), &agent_id, 44, true);

        env.events().publish(
            (symbol_short!("fraud_rpt"), agent_id.clone()),
            (reporter.clone(), adjusted_score, env.ledger().timestamp()),
        );

        // Compliance audit log – fraud report / flagging decision
        if ComplianceLogger::is_initialized(&env) {
            let score_bytes = Bytes::from_slice(&env, &adjusted_score.to_le_bytes());
            let target_bytes = Bytes::from_slice(&env, agent_id.to_string().as_bytes());
            let action = if adjusted_score >= 70 {
                ComplianceAction::FraudFlagged
            } else {
                ComplianceAction::RiskEvaluated
            };
            ComplianceLogger::append(
                &env,
                reporter.clone(),
                action,
                target_bytes,
                Bytes::new(&env),
                score_bytes,
                BytesN::from_array(&env, &[0u8; 32]),
            );
        }

        Ok(())
    }

    pub fn get_reports(env: Env, agent_id: Symbol) -> Vec<FraudReport> {
        let _timer = PerformanceMonitor::start_timer(&env, &symbol_short!("get_reports"));

        let result = CompressedReportStorage::get_reports(&env, &agent_id)
            .unwrap_or_else(|_| Vec::new(&env));

        StorageTracker::record_operation(&env, &symbol_short!("access"), &agent_id, 0, false);

        let _duration = PerformanceMonitor::end_timer(&env, &symbol_short!("get_reports"));

        result
    }

    pub fn get_latest_score(env: Env, agent_id: Symbol) -> u32 {
        let _timer = PerformanceMonitor::start_timer(&env, &symbol_short!("get_latest_score"));

        let result = CompressedReportStorage::get_latest_score(&env, &agent_id).unwrap_or(0);

        StorageTracker::record_operation(&env, &symbol_short!("access"), &agent_id, 0, false);

        let _duration = PerformanceMonitor::end_timer(&env, &symbol_short!("get_latest_score"));

        result
    }

    pub fn batch_analyze_pairs(
        env: Env,
        pairs: Vec<TokenPair>,
    ) -> Result<Vec<FraudAnalysisResult>, ContractError> {
        let _timer = PerformanceMonitor::start_timer(&env, &Symbol::new(&env, "batch_analyze"));

        let mut results = Vec::new(&env);

        for pair in pairs.iter() {
            if let Ok(result) = Self::analyze_trading_for_fraud(env.clone(), pair) {
                results.push_back(result);
            }
        }

        let _duration = PerformanceMonitor::end_timer(&env, &Symbol::new(&env, "batch_analyze"));

        Ok(results)
    }

    pub fn batch_flag_fraud(
        env: Env,
        admin: Address,
        flags: Vec<common_utils::batch::FraudFlag>,
    ) -> Result<common_utils::batch::BatchResult, common_utils::batch::BatchError> {
        batch::batch_flag_fraud(&env, &admin, flags)
    }

    pub fn invalidate_dex_cache(
        env: Env,
        admin: Address,
        pair: TokenPair,
    ) -> Result<(), ContractError> {
        Self::require_admin(&env, &admin)?;

        let mut cache = DexDataCache::new(&env);
        cache.invalidate(&pair);

        Ok(())
    }

    fn get_auth(env: &Env) -> CachedAuth<RoleBasedAuth> {
        let role_auth = auth!(
            RoleBased,
            Symbol::new(env, "admin"),
            Symbol::new(env, "role")
        );
        let cache = PermissionCache::new(300, Symbol::new(env, "auth_cache"));
        cached_auth!(role_auth, cache)
    }

    pub fn has_role(env: Env, address: Address, role: Permission) -> bool {
        let auth = Self::get_auth(&env);
        auth.check_permission(&env, &address, &role)
            .unwrap_or(false)
    }

    pub fn migrate_to_compressed(env: Env, admin: Address) -> Result<u64, ContractError> {
        let auth = Self::get_auth(&env);
        check_authorization!(auth, &env, &admin, permission!(Admin));

        if env.storage().instance().has(&DataKey::MigrationState) {
            return Err(ContractError::InvalidState);
        }

        Ok(0)
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

    fn fetch_trading_data(env: &Env, pair: &TokenPair) -> Result<TradingData, ContractError> {
        let mut cache = DexDataCache::new(env);

        if let Some(data) = cache.get_or_stale(pair) {
            return Ok(data);
        }

        let adapter = StellarDexAdapter::new(env);
        let pool_info = adapter
            .fetch_pool_data(pair)
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

        let price = common_utils::dex::trading_data::PriceData::new(
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
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FraudAnalysisResult {
    pub indicators: Vec<FraudIndicator>,
    pub overall_risk: OverallRisk,
    pub trading_data: Option<TradingData>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TradingEvidence {
    pub pair: TokenPair,
    pub volume_anomaly: bool,
    pub price_anomaly: bool,
}

#[contractimpl]
impl DataMigration for FraudDetectContract {
    fn export_state(env: Env) -> Vec<Val> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let mut state = Vec::new(&env);
        state.push_back(admin.to_val());
        state
    }

    fn import_state(env: Env, data: Vec<Val>) -> Result<(), CommonError> {
        if data.len() < 1 {
            return Err(CommonError::InvalidFormat);
        }
        let val = data.get(0).unwrap();
        let admin = Address::try_from_val(&env, &val).map_err(|_| CommonError::InvalidFormat)?;
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }
}

#[cfg(test)]
mod test;
