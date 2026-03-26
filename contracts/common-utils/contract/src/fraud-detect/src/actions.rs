// contracts/fraud-detect/src/actions.rs

pub fn decide_action(score: u32) -> &'static str {
    if score < 30 {
        "LOW"
    } else if score < 70 {
        "MEDIUM"
    } else {
        "HIGH"
    }
}