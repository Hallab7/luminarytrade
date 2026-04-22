#!/usr/bin/env ts-node
/**
 * #241 — Startup time benchmark
 * Run before and after lazy-loading changes to verify ≥20% reduction.
 *
 * Usage:
 *   npx ts-node scripts/benchmark-startup.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

async function measureStartup(runs = 5): Promise<void> {
  const times: number[] = [];

  for (let i = 0; i < runs; i++) {
    const start = performance.now();

    const app = await NestFactory.create(AppModule, { logger: false });
    await app.init();

    const elapsed = performance.now() - start;
    times.push(elapsed);

    await app.close();

    // Short pause between runs to let GC settle
    await new Promise(r => setTimeout(r, 200));
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log('\n=== Startup Benchmark ===');
  console.log(`Runs  : ${runs}`);
  console.log(`Avg   : ${avg.toFixed(1)} ms`);
  console.log(`Min   : ${min.toFixed(1)} ms`);
  console.log(`Max   : ${max.toFixed(1)} ms`);
  console.log('=========================\n');

  // Acceptance criteria: avg must be ≤ baseline * 0.80 (20% reduction)
  const baseline = Number(process.env.STARTUP_BASELINE_MS);
  if (baseline) {
    const target = baseline * 0.8;
    const passed = avg <= target;
    console.log(`Baseline : ${baseline.toFixed(1)} ms`);
    console.log(`Target   : ${target.toFixed(1)} ms  (baseline × 0.80)`);
    console.log(`Result   : ${passed ? '✅ PASS' : '❌ FAIL'} (avg ${avg.toFixed(1)} ms)`);
    if (!passed) process.exit(1);
  }
}

measureStartup().catch(err => {
  console.error(err);
  process.exit(1);
});