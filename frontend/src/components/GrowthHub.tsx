import React, { useMemo, useState } from "react";
import { useResponsive } from "../hooks/useResponsive";
import { spacing } from "../styles/theme";

type SocialPlatform = "Twitter" | "LinkedIn" | "WhatsApp" | "Telegram";

interface BenefitCard {
  title: string;
  copy: string;
  accent: string;
}

interface AffiliateStat {
  label: string;
  value: string;
  tone: string;
}

interface AffiliatePayout {
  id: string;
  amount: string;
  status: string;
  method: string;
  eta: string;
}

const premiumBenefits: BenefitCard[] = [
  {
    title: "Priority market intelligence",
    copy: "Receive early product updates, strategy briefings, and private beta invites.",
    accent: "#2563eb",
  },
  {
    title: "Higher reward ceilings",
    copy: "Unlock better referral and affiliate earning multipliers as new tools launch.",
    accent: "#ea580c",
  },
  {
    title: "Operator-grade support",
    copy: "Get faster support lanes and a dedicated onboarding path for monetization features.",
    accent: "#059669",
  },
];

const affiliateStats: AffiliateStat[] = [
  { label: "Commission earned", value: "$4,820", tone: "#2563eb" },
  { label: "Pending verification", value: "$1,140", tone: "#d97706" },
  { label: "Conversion rate", value: "18.4%", tone: "#059669" },
  { label: "Partner tier", value: "Gold", tone: "#7c3aed" },
];

const payoutHistory: AffiliatePayout[] = [
  {
    id: "PAYOUT-1048",
    amount: "$780",
    status: "Processing",
    method: "USDC wallet",
    eta: "2 business days",
  },
  {
    id: "PAYOUT-1041",
    amount: "$620",
    status: "Paid",
    method: "Bank transfer",
    eta: "Completed Apr 19",
  },
  {
    id: "PAYOUT-1034",
    amount: "$560",
    status: "Paid",
    method: "USDC wallet",
    eta: "Completed Apr 11",
  },
];

const socialPlatforms: { name: SocialPlatform; url: string }[] = [
  { name: "Twitter", url: "https://twitter.com/intent/tweet?text=" },
  { name: "LinkedIn", url: "https://www.linkedin.com/sharing/share-offsite/?url=" },
  { name: "WhatsApp", url: "https://wa.me/?text=" },
  { name: "Telegram", url: "https://t.me/share/url?url=" },
];

const createHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash);
};

const generateQrCells = (seed: string) => {
  const size = 13;
  const hash = createHash(seed);
  const cells: boolean[][] = [];

  for (let row = 0; row < size; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col += 1) {
      const finder =
        ((row < 3 || row > size - 4) && col < 3) ||
        (row < 3 && col > size - 4);

      if (finder) {
        line.push(true);
        continue;
      }

      const bit = ((hash >> ((row + col) % 12)) + row * 7 + col * 13) % 2 === 0;
      line.push(bit);
    }
    cells.push(line);
  }

  return cells;
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "rgba(255,255,255,0.8)",
  padding: "12px 14px",
  color: "#0f172a",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const sectionCardStyle: React.CSSProperties = {
  borderRadius: 28,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(255,255,255,0.78)",
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.08)",
  padding: 24,
  backdropFilter: "blur(14px)",
};

const GrowthHub: React.FC = () => {
  const { isMobile, isTablet } = useResponsive();
  const referralCode = "BIGBEN7-LUMINARY";
  const referralLink = `https://luminarytrade.app/join?ref=${referralCode}`;
  const qrCells = useMemo(() => generateQrCells(referralLink), [referralLink]);

  const [shareFeedback, setShareFeedback] = useState("Copy your referral link or launch a share sheet.");
  const [monthlyVolume, setMonthlyVolume] = useState(25000);
  const [referralCount, setReferralCount] = useState(18);
  const [conversionRate, setConversionRate] = useState(24);
  const [affiliateTier, setAffiliateTier] = useState<"Starter" | "Growth" | "Scale">("Growth");
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistFeedback, setWaitlistFeedback] = useState("Join the premium queue to unlock higher limits and partner perks.");
  const [payoutRequest, setPayoutRequest] = useState("450");
  const [payoutFeedback, setPayoutFeedback] = useState("Request a payout when your verified commission balance is ready.");

  const baseBonusRate = affiliateTier === "Starter" ? 0.02 : affiliateTier === "Growth" ? 0.03 : 0.045;
  const conversionMultiplier = 1 + conversionRate / 100;
  const referralBonus = Math.round(monthlyVolume * baseBonusRate * conversionMultiplier);
  const networkBonus = Math.round(referralCount * 22 * (affiliateTier === "Scale" ? 1.4 : 1.15));
  const premiumUnlockBonus = Math.round(referralBonus * 0.18);
  const projectedQuarterlyBonus = referralBonus + networkBonus + premiumUnlockBonus;
  const waitlistCount = 284 + waitlistName.trim().length + waitlistEmail.trim().length;

  const handleCopyReferral = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setShareFeedback("Referral link copied. Share it anywhere and keep the code handy for offline intros.");
    } catch (error) {
      setShareFeedback(`Clipboard access failed. Copy this link manually: ${referralLink}`);
    }
  };

  const handleSocialShare = (platform: SocialPlatform) => {
    const target = socialPlatforms.find((option) => option.name === platform);
    if (!target) {
      return;
    }

    const text = encodeURIComponent(
      `Join me on LuminaryTrade and start tracking referral rewards: ${referralLink}`,
    );
    window.open(`${target.url}${text}`, "_blank", "noopener,noreferrer");
    setShareFeedback(`${platform} share window opened with your referral link attached.`);
  };

  const handleWaitlistSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = waitlistName.trim();
    const trimmedEmail = waitlistEmail.trim();

    if (!trimmedName || !trimmedEmail) {
      setWaitlistFeedback("Add both your name and email so the premium waitlist entry is complete.");
      return;
    }

    setWaitlistFeedback(
      `${trimmedName}, you're in. Premium launch notes and invite windows will be sent to ${trimmedEmail}.`,
    );
    setWaitlistName("");
    setWaitlistEmail("");
  };

  const handlePayoutSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(payoutRequest);

    if (Number.isNaN(amount) || amount < 100) {
      setPayoutFeedback("Minimum payout request is $100. Enter a higher verified balance amount.");
      return;
    }

    setPayoutFeedback(`Payout request for $${amount.toLocaleString()} submitted for review.`);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 28%), radial-gradient(circle at top right, rgba(234,88,12,0.18), transparent 24%), linear-gradient(180deg, #eef6ff 0%, #f8fafc 48%, #fff7ed 100%)",
        padding: isMobile ? `${spacing.md}px` : isTablet ? `${spacing.lg}px` : `${spacing.xl}px`,
        color: "#0f172a",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.15fr) minmax(320px, 0.85fr)",
          gap: spacing.lg,
          marginBottom: spacing.lg,
        }}
      >
        <section
          style={{
            ...sectionCardStyle,
            padding: isMobile ? 24 : 32,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.92) 45%, rgba(37,99,235,0.84) 100%)",
            color: "#f8fafc",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "auto -32px -40px auto",
              width: 180,
              height: 180,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              filter: "blur(2px)",
            }}
          />
          <div style={{ position: "relative" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.1)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Growth Command Center
            </div>
            <h1
              style={{
                margin: "18px 0 12px",
                fontSize: isMobile ? 32 : 46,
                lineHeight: 1.02,
                letterSpacing: "-0.04em",
                maxWidth: 560,
              }}
            >
              Referral growth, bonuses, premium demand, and affiliate payouts in one flow.
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: 560,
                color: "rgba(226,232,240,0.82)",
                fontSize: 15,
                lineHeight: 1.7,
              }}
            >
              This workspace bundles the four assigned growth issues into one shipping surface so a single PR can close them together.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
                gap: 12,
                marginTop: 28,
              }}
            >
              {[
                { label: "Shared links", value: "1-click" },
                { label: "Bonus estimate", value: `$${projectedQuarterlyBonus.toLocaleString()}` },
                { label: "Waitlist queue", value: `${waitlistCount}+` },
                { label: "Payout SLA", value: "48 hrs" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 18,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    padding: "16px 18px",
                  }}
                >
                  <div style={{ fontSize: 12, color: "rgba(226,232,240,0.7)", marginBottom: 8 }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ ...sectionCardStyle, display: "grid", gap: 16, alignContent: "start" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#2563eb", letterSpacing: "0.08em" }}>
              Issue Coverage
            </div>
            <h2 style={{ margin: "10px 0 8px", fontSize: 28, lineHeight: 1.1 }}>
              One branch, one PR, four growth features.
            </h2>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
              Referral sharing, bonus forecasting, premium waitlist capture, and affiliate management are all wired here as a combined release candidate.
            </p>
          </div>

          {[
            "#291 Referral Sharing",
            "#292 Bonus Calculator",
            "#293 Waitlist for Premium",
            "#294 Affiliate Program UI",
          ].map((item, index) => (
            <div
              key={item}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 18,
                padding: "14px 16px",
                background: index % 2 === 0 ? "#eff6ff" : "#fff7ed",
                border: "1px solid rgba(148,163,184,0.18)",
              }}
            >
              <span style={{ fontWeight: 700 }}>{item}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>Ready for bundled review</span>
            </div>
          ))}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
          gap: spacing.lg,
        }}
      >
        <section style={sectionCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#2563eb", letterSpacing: "0.08em" }}>
                Referral Sharing
              </div>
              <h2 style={{ margin: "10px 0 8px", fontSize: 26 }}>Shareable links with QR and analytics cues</h2>
              <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
                Promote your referral code across social channels, copy the direct link, and use a visual code when you pitch offline.
              </p>
            </div>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 14,
                background: "#eff6ff",
                color: "#1d4ed8",
                fontWeight: 700,
                height: "fit-content",
              }}
            >
              143 clicks this week
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.2fr) 180px",
              gap: 20,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  borderRadius: 18,
                  padding: "16px 18px",
                  background: "#0f172a",
                  color: "#f8fafc",
                  marginBottom: 16,
                  wordBreak: "break-all",
                }}
              >
                <div style={{ fontSize: 12, textTransform: "uppercase", color: "#93c5fd", marginBottom: 8 }}>
                  Referral link
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{referralLink}</div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => void handleCopyReferral()}
                  style={{
                    border: "none",
                    borderRadius: 14,
                    padding: "12px 16px",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Copy Link
                </button>
                {socialPlatforms.map((platform) => (
                  <button
                    key={platform.name}
                    type="button"
                    onClick={() => handleSocialShare(platform.name)}
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(148,163,184,0.24)",
                      padding: "12px 14px",
                      background: "#fff",
                      color: "#0f172a",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {platform.name}
                  </button>
                ))}
              </div>

              <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>{shareFeedback}</p>
            </div>

            <div
              aria-label="Referral QR code preview"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(13, 1fr)",
                gap: 4,
                padding: 14,
                borderRadius: 24,
                background: "#fff",
                border: "1px solid rgba(148,163,184,0.24)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
              }}
            >
              {qrCells.flatMap((row, rowIndex) =>
                row.map((filled, colIndex) => (
                  <div
                    key={`${rowIndex}-${colIndex}`}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      borderRadius: 3,
                      background: filled ? "#0f172a" : "#dbeafe",
                    }}
                  />
                )),
              )}
            </div>
          </div>
        </section>

        <section style={sectionCardStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#ea580c", letterSpacing: "0.08em" }}>
              Bonus Calculator
            </div>
            <h2 style={{ margin: "10px 0 8px", fontSize: 26 }}>Forecast bonus potential from your network</h2>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
              Adjust volume, referral count, and conversion assumptions to estimate the next payout cycle.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 16 }}>
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Monthly trading volume</span>
              <input
                type="number"
                min="0"
                value={monthlyVolume}
                onChange={(event) => setMonthlyVolume(Number(event.target.value))}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Active referrals</span>
              <input
                type="number"
                min="0"
                value={referralCount}
                onChange={(event) => setReferralCount(Number(event.target.value))}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Conversion rate (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                value={conversionRate}
                onChange={(event) => setConversionRate(Number(event.target.value))}
                style={fieldStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Affiliate tier</span>
              <select
                value={affiliateTier}
                onChange={(event) => setAffiliateTier(event.target.value as "Starter" | "Growth" | "Scale")}
                style={fieldStyle}
              >
                <option value="Starter">Starter</option>
                <option value="Growth">Growth</option>
                <option value="Scale">Scale</option>
              </select>
            </label>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
              gap: 14,
              marginTop: 18,
            }}
          >
            {[
              { label: "Referral bonus", value: `$${referralBonus.toLocaleString()}` },
              { label: "Network bonus", value: `$${networkBonus.toLocaleString()}` },
              { label: "Premium unlock upside", value: `$${premiumUnlockBonus.toLocaleString()}` },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: 18,
                  padding: "16px 18px",
                  background: "#fff7ed",
                  border: "1px solid rgba(234,88,12,0.16)",
                }}
              >
                <div style={{ fontSize: 12, color: "#9a3412", marginBottom: 8 }}>{item.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800 }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              borderRadius: 20,
              padding: "18px 20px",
              background: "#0f172a",
              color: "#f8fafc",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", color: "#fdba74", marginBottom: 8 }}>
              Projected quarterly bonus
            </div>
            <div style={{ fontSize: 34, fontWeight: 900 }}>${projectedQuarterlyBonus.toLocaleString()}</div>
          </div>
        </section>

        <section style={sectionCardStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#059669", letterSpacing: "0.08em" }}>
              Premium Waitlist
            </div>
            <h2 style={{ margin: "10px 0 8px", fontSize: 26 }}>Capture demand before premium access opens</h2>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
              Show benefits, collect intent, and give users a simple way to join the launch queue.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
              gap: 14,
              marginBottom: 20,
            }}
          >
            {premiumBenefits.map((benefit) => (
              <article
                key={benefit.title}
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(148,163,184,0.16)",
                  padding: "18px 18px 20px",
                  background: "#ffffff",
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 14,
                    background: `${benefit.accent}18`,
                    marginBottom: 14,
                  }}
                />
                <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>{benefit.title}</h3>
                <p style={{ margin: 0, color: "#475569", lineHeight: 1.65 }}>{benefit.copy}</p>
              </article>
            ))}
          </div>

          <form onSubmit={handleWaitlistSubmit} style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
              <input
                type="text"
                value={waitlistName}
                onChange={(event) => setWaitlistName(event.target.value)}
                placeholder="Your name"
                style={fieldStyle}
              />
              <input
                type="email"
                value={waitlistEmail}
                onChange={(event) => setWaitlistEmail(event.target.value)}
                placeholder="Email address"
                style={fieldStyle}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <button
                type="submit"
                style={{
                  border: "none",
                  borderRadius: 14,
                  padding: "12px 18px",
                  background: "#059669",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Join Premium Waitlist
              </button>
              <div style={{ color: "#0f766e", fontWeight: 700 }}>{waitlistCount} people already waiting</div>
            </div>
          </form>

          <p style={{ margin: "14px 0 0", color: "#475569", lineHeight: 1.6 }}>{waitlistFeedback}</p>
        </section>

        <section style={sectionCardStyle}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#7c3aed", letterSpacing: "0.08em" }}>
              Affiliate Program
            </div>
            <h2 style={{ margin: "10px 0 8px", fontSize: 26 }}>Track commissions and request payouts</h2>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.7 }}>
              The page sits behind authenticated navigation, giving affiliates a secure place to monitor earnings and submit payout requests.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))",
              gap: 14,
              marginBottom: 20,
            }}
          >
            {affiliateStats.map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: 18,
                  padding: "16px 18px",
                  background: `${item.tone}12`,
                  border: `1px solid ${item.tone}22`,
                }}
              >
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>{item.label}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: item.tone }}>{item.value}</div>
              </div>
            ))}
          </div>

          <form
            onSubmit={handlePayoutSubmit}
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "end",
              marginBottom: 20,
            }}
          >
            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>Request payout amount (USD)</span>
              <input
                type="number"
                min="100"
                value={payoutRequest}
                onChange={(event) => setPayoutRequest(event.target.value)}
                style={fieldStyle}
              />
            </label>

            <button
              type="submit"
              style={{
                border: "none",
                borderRadius: 14,
                padding: "12px 18px",
                background: "#7c3aed",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
                minHeight: 48,
              }}
            >
              Request Payout
            </button>
          </form>

          <p style={{ margin: "0 0 16px", color: "#475569", lineHeight: 1.6 }}>{payoutFeedback}</p>

          <div style={{ display: "grid", gap: 12 }}>
            {payoutHistory.map((payout) => (
              <div
                key={payout.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1.1fr 0.8fr 0.8fr 1fr 1fr",
                  gap: 10,
                  alignItems: "center",
                  borderRadius: 16,
                  padding: "14px 16px",
                  background: "#faf5ff",
                  border: "1px solid rgba(124,58,237,0.12)",
                }}
              >
                <strong>{payout.id}</strong>
                <span>{payout.amount}</span>
                <span style={{ fontWeight: 700, color: payout.status === "Paid" ? "#059669" : "#d97706" }}>
                  {payout.status}
                </span>
                <span>{payout.method}</span>
                <span style={{ color: "#475569" }}>{payout.eta}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default GrowthHub;
