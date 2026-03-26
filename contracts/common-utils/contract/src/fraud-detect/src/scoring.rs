// contracts/fraud-detect/src/scoring.rs

use crate::types::FraudScore;

pub fn compute_score(score: FraudScore) -> u32 {
    // weighted system
    let total =
        score.unusual_activity * 20 / 100 +
        score.rapid_tx * 20 / 100 +
        score.velocity * 20 / 100 +
        score.blacklist * 80 / 100;

    total.min(100)
}