import { Injectable } from '@nestjs/common';
import {
  AgentPosition,
  OptimizationTarget,
  OptimizedPortfolio,
  PortfolioAllocation,
  RiskMetrics,
} from './types';

@Injectable()
export class ComputeBridgeService {
  // ---------------------------------------------------------------------------
  // Core statistical primitives
  // ---------------------------------------------------------------------------

  private mean(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  private variance(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = this.mean(xs);
    return xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
  }

  private stddev(xs: number[]): number {
    return Math.sqrt(this.variance(xs));
  }

  private downsideStddev(xs: number[], target = 0): number {
    const squaredLosses = xs.map(x => (Math.min(x - target, 0)) ** 2);
    return Math.sqrt(squaredLosses.reduce((a, b) => a + b, 0) / xs.length);
  }

  private covariance(xs: number[], ys: number[]): number {
    if (xs.length !== ys.length || xs.length < 2) return 0;
    const mx = this.mean(xs);
    const my = this.mean(ys);
    return xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / xs.length;
  }

  // ---------------------------------------------------------------------------
  // Individual risk metrics
  // ---------------------------------------------------------------------------

  sharpe(returns: number[], riskFreeRate = 0.02 / 252): number {
    if (returns.length === 0) return 0;
    const excess = returns.map(r => r - riskFreeRate);
    const vol = this.stddev(excess);
    return vol === 0 ? 0 : (this.mean(excess) / vol) * Math.sqrt(252);
  }

  sortino(returns: number[], riskFreeRate = 0.02 / 252): number {
    if (returns.length === 0) return 0;
    const excess = returns.map(r => r - riskFreeRate);
    const downVol = this.downsideStddev(excess);
    return downVol === 0 ? 0 : (this.mean(excess) / downVol) * Math.sqrt(252);
  }

  maxDrawdown(returns: number[]): number {
    let peak = 1;
    let nav = 1;
    let maxDD = 0;
    for (const r of returns) {
      nav *= 1 + r;
      if (nav > peak) peak = nav;
      const dd = (nav - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    return maxDD;
  }

  valueAtRisk95(returns: number[]): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.05);
    return sorted[index] ?? 0;
  }

  annualizedVolatility(returns: number[]): number {
    return this.stddev(returns) * Math.sqrt(252);
  }

  beta(agentReturns: number[], benchmarkReturns: number[]): number {
    const len = Math.min(agentReturns.length, benchmarkReturns.length);
    if (len < 2) return 1;
    const a = agentReturns.slice(0, len);
    const b = benchmarkReturns.slice(0, len);
    const benchVar = this.variance(b);
    return benchVar === 0 ? 1 : this.covariance(a, b) / benchVar;
  }

  // ---------------------------------------------------------------------------
  // Helpers for position-based computations
  // ---------------------------------------------------------------------------

  extractReturns(positions: AgentPosition[]): number[] {
    const totalValue = positions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice,
      0,
    );
    if (totalValue === 0 || positions.length === 0) return [];

    const maxLen = Math.max(...positions.map(p => p.returns.length));
    const aggregated: number[] = [];

    for (let i = 0; i < maxLen; i++) {
      let weightedReturn = 0;
      for (const pos of positions) {
        const weight = (pos.quantity * pos.currentPrice) / totalValue;
        weightedReturn += weight * (pos.returns[i] ?? 0);
      }
      aggregated.push(weightedReturn);
    }
    return aggregated;
  }

  buildBenchmarkReturns(positions: AgentPosition[]): number[] {
    if (positions.length === 0) return [];
    const maxLen = Math.max(...positions.map(p => p.returns.length));
    const n = positions.length;
    return Array.from({ length: maxLen }, (_, i) =>
      positions.reduce((sum, p) => sum + (p.returns[i] ?? 0), 0) / n,
    );
  }

  // ---------------------------------------------------------------------------
  // Full RiskMetrics computation
  // ---------------------------------------------------------------------------

  computeRiskMetrics(agentId: string, positions: AgentPosition[]): RiskMetrics {
    const returns = this.extractReturns(positions);
    const benchmark = this.buildBenchmarkReturns(positions);

    return {
      agentId,
      sharpeRatio: this.sharpe(returns),
      sortinoRatio: this.sortino(returns),
      maxDrawdown: this.maxDrawdown(returns),
      valueAtRisk95: this.valueAtRisk95(returns),
      beta: this.beta(returns, benchmark),
      annualizedVolatility: this.annualizedVolatility(returns),
    };
  }

  // ---------------------------------------------------------------------------
  // Portfolio optimization
  // ---------------------------------------------------------------------------

  private buildCovarianceMatrix(positions: AgentPosition[]): number[][] {
    const n = positions.length;
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        this.covariance(positions[i].returns, positions[j].returns),
      ),
    );
  }

  private portfolioVariance(weights: number[], covMatrix: number[][]): number {
    const n = weights.length;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += weights[i] * weights[j] * covMatrix[i][j];
      }
    }
    return variance;
  }

  private portfolioExpectedReturn(weights: number[], positions: AgentPosition[]): number {
    return weights.reduce((sum, w, i) => sum + w * this.mean(positions[i].returns) * 252, 0);
  }

  private optimizeWeights(
    positions: AgentPosition[],
    target: OptimizationTarget,
  ): number[] {
    const n = positions.length;
    if (n === 0) return [];
    if (n === 1) return [1];

    const covMatrix = this.buildCovarianceMatrix(positions);
    const expectedReturns = positions.map(p => this.mean(p.returns) * 252);
    const riskFreeRate = 0.02;

    let weights = Array(n).fill(1 / n);

    const learningRate = 0.01;
    const iterations = 2000;
    const epsilon = 1e-6;

    const objective = (w: number[]): number => {
      const portVar = this.portfolioVariance(w, covMatrix);
      const portVol = Math.sqrt(Math.max(portVar, 0));
      const portRet = w.reduce((s, wi, i) => s + wi * expectedReturns[i], 0);

      switch (target) {
        case 'max-sharpe':
          return portVol === 0 ? 0 : -((portRet - riskFreeRate) / portVol);
        case 'min-volatility':
          return portVol;
        case 'risk-parity': {
          const totalVar = this.portfolioVariance(w, covMatrix);
          if (totalVar === 0) return 0;
          const riskContribs = w.map((wi, i) => {
            const marginal = covMatrix[i].reduce((s, cov, j) => s + cov * w[j], 0);
            return (wi * marginal) / totalVar;
          });
          const targetContrib = 1 / n;
          return riskContribs.reduce((s, rc) => s + (rc - targetContrib) ** 2, 0);
        }
      }
    };

    for (let iter = 0; iter < iterations; iter++) {
      const grad = weights.map((_, i) => {
        const wPlus = [...weights];
        const wMinus = [...weights];
        wPlus[i] += epsilon;
        wMinus[i] -= epsilon;
        return (objective(wPlus) - objective(wMinus)) / (2 * epsilon);
      });

      const updated = weights.map((w, i) => Math.max(0, w - learningRate * grad[i]));
      const total = updated.reduce((a, b) => a + b, 0);
      weights = total === 0 ? Array(n).fill(1 / n) : updated.map(w => w / total);
    }

    return weights;
  }

  optimize(agentId: string, positions: AgentPosition[], target: OptimizationTarget): OptimizedPortfolio {
    const n = positions.length;

    if (n === 0) {
      return {
        agentId,
        allocations: [],
        expectedReturn: 0,
        expectedVolatility: 0,
        sharpeRatio: 0,
        optimizationTarget: target,
      };
    }

    const covMatrix = this.buildCovarianceMatrix(positions);
    const weights = this.optimizeWeights(positions, target);

    const portVar = this.portfolioVariance(weights, covMatrix);
    const portVol = Math.sqrt(Math.max(portVar, 0));
    const portRet = this.portfolioExpectedReturn(weights, positions);
    const totalVar = portVar === 0 ? 1 : portVar;

    const allocations: PortfolioAllocation[] = positions.map((pos, i) => {
      const marginalVariance = covMatrix[i].reduce(
        (sum, cov, j) => sum + cov * weights[j],
        0,
      );
      const riskContribution = (weights[i] * marginalVariance) / totalVar;
      return {
        assetId: pos.assetId,
        weight: weights[i],
        expectedReturn: this.mean(pos.returns) * 252,
        riskContribution,
      };
    });

    return {
      agentId,
      allocations,
      expectedReturn: portRet,
      expectedVolatility: portVol,
      sharpeRatio: portVol === 0 ? 0 : (portRet - 0.02) / portVol,
      optimizationTarget: target,
    };
  }
}