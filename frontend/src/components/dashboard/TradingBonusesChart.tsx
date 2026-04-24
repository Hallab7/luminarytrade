/**
 * TradingBonusesChart.tsx
 *
 * Area chart showing trading bonus earnings over time with breakdown.
 */

import React from "react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    Bar,
    ComposedChart,
} from "recharts";
import { TradingBonusPoint, BonusBreakdown } from "../../types/dashboard.types";
import ChartCard from "./ChartCard";

interface Props {
    data: TradingBonusPoint[];
    breakdown: BonusBreakdown[];
    loading?: boolean;
}

const formatCurrency = (n: number): string => {
    if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "K";
    return "$" + n;
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "rgba(30,30,47,0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: "12px 16px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>{label}</div>
            {payload.map((entry: any, i: number) => (
                <div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                    fontSize: 13,
                }}>
                    <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: entry.color,
                    }} />
                    <span style={{ color: "#94a3b8" }}>{entry.name}:</span>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                        {entry.name.includes("Multiplier") ? entry.value.toFixed(1) + "x" : formatCurrency(entry.value)}
                    </span>
                </div>
            ))}
        </div>
    );
};

const TradingBonusesChart: React.FC<Props> = ({ data, breakdown, loading }) => {
    const csvColumns = [
        { key: "date", label: "Date" },
        { key: "bonusAmount", label: "Bonus Amount ($)" },
        { key: "multiplier", label: "Multiplier" },
        { key: "tradeCount", label: "Trade Count" },
    ];
    return (
        <ChartCard
            title="Trading Bonuses"
            subtitle="Bonus earnings & multiplier trends"
            loading={loading}
            exportData={data as unknown as Record<string, unknown>[]}
            csvColumns={csvColumns}
            exportFilename="trading-bonuses"
            data-testid="trading-bonuses-chart"
        >
            <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                        <linearGradient id="bonusGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="multiplierGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
                    <YAxis yAxisId="bonus" orientation="left" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(v)} />
                    <YAxis yAxisId="multiplier" orientation="right" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "x"} />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 8 }} />
                    <Area yAxisId="bonus" type="monotone" dataKey="bonusAmount" name="Bonus Amount" stroke="#22c55e" strokeWidth={2} fill="url(#bonusGradient)" dot={{ fill: "#22c55e", strokeWidth: 2, r: 4 }} activeDot={{ r: 6, fill: "#22c55e" }} animationDuration={1000} />
                    <Area yAxisId="multiplier" type="monotone" dataKey="multiplier" name="Activity Multiplier" stroke="#f59e0b" strokeWidth={2} fill="url(#multiplierGradient)" dot={{ fill: "#f59e0b", strokeWidth: 2, r: 4 }} activeDot={{ r: 6, fill: "#f59e0b" }} animationDuration={1000} />
                    <Bar yAxisId="bonus" dataKey="tradeCount" name="Trade Count" fill="rgba(139,92,246,0.3)" opacity={0.6} radius={[4,4,0,0]} animationDuration={800} />
                </ComposedChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 20, padding: "16px", background: "rgba(0,0,0,0.2)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bonus Breakdown</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {breakdown.map((item, i) => (
                        <div key={item.type} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 20, border: "1px solid rgba(255,255,255,0.06)" }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
                            <span style={{ fontSize: 12, color: "#e2e8f0" }}>{item.label}:</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{formatCurrency(item.amount)}</span>
                            {item.count && <span style={{ fontSize: 11, color: "#64748b" }}>({item.count})</span>}
                        </div>
                    ))}
                </div>
            </div>
        </ChartCard>
    );
};
export default TradingBonusesChart;

