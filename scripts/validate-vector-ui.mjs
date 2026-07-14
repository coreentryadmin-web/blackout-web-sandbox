#!/usr/bin/env node
/**
 * Vector UI Comprehensive Scenario Test
 * Tests scenario engine integration on Vector page (UI level)
 * Validates both universe and non-universe stocks
 */

import { chromium } from 'playwright';

const VALIDATE_BASE = process.env.VALIDATE_BASE || 'https://blackout-web-staging.vercel.app';

const UNIVERSE_STOCKS = ['SPX', 'SPY', 'NVDA', 'QQQ'];
const NON_UNIVERSE_STOCKS = ['RKLB', 'UBER', 'PLTR'];
const ALL_STOCKS = [...UNIVERSE_STOCKS, ...NON_UNIVERSE_STOCKS];

const SCENARIOS = [
  'if SPX drops 1% at open',
  'what if SPX rips 2%',
  'suppose SPX breaks down 40 points',
  'if SPX goes to 7400 at open',
];

async function testVectorScenarios() {
  const browser = await chromium.launch();
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  const results = {
    passed: 0,
    failed: 0,
    errors: [],
  };

  console.log('🧪 Vector UI Scenario Engine Validation\n');
  console.log('='.repeat(60));
  console.log(`Base: ${VALIDATE_BASE}`);
  console.log(`Stocks: ${ALL_STOCKS.join(', ')}`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log('='.repeat(60));

  for (const stock of ALL_STOCKS) {
    const isUniverse = UNIVERSE_STOCKS.includes(stock);
    console.log(`\n📊 Testing ${stock} (${isUniverse ? 'universe' : 'non-universe'})\n`);

    for (const scenario of SCENARIOS) {
      const testName = `${stock}: "${scenario.substring(0, 30)}..."`;

      try {
        // Navigate to Vector page with specific stock
        await page.goto(`${VALIDATE_BASE}/vector?ticker=${stock}`, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        // Wait for page to settle
        await page.waitForTimeout(1000);

        // Inject scenario query into the page (simulating user typing)
        // Find the scenario input (typically in a search/query box)
        const searchBox = await page.locator('input[placeholder*="scenario" i], input[placeholder*="query" i], input[type="text"]').first();

        if (!searchBox) {
          results.failed++;
          results.errors.push(`${testName}: No scenario input found`);
          console.log(`  ⚠️  Skipped (no scenario input UI)`);
          continue;
        }

        // Clear and type scenario (replace stock name if generic)
        const customScenario = scenario.replace(/SPX|SPY|NVDA|QQQ/i, stock);
        await searchBox.fill(customScenario);
        await searchBox.press('Enter');

        // Wait for scenario result to load
        await page.waitForTimeout(2000);

        // Check for response content
        const pageContent = await page.content();
        const hasNumbers = /{{[\d\.,\+\-]+}}|[\d\.,]+\s*(pts?|%|points)/.test(pageContent);
        const hasUnavailable = pageContent.includes('unavailable');
        const hasError = pageContent.includes('error') || pageContent.includes('Error');

        if (hasUnavailable) {
          results.failed++;
          results.errors.push(`${testName}: Scenario unavailable`);
          console.log(`  ⚠️  Unavailable`);
        } else if (hasError) {
          results.failed++;
          results.errors.push(`${testName}: Page error`);
          console.log(`  ❌ Page error`);
        } else if (hasNumbers) {
          results.passed++;
          console.log(`  ✓ PASS (numbers rendered)`);
        } else {
          results.failed++;
          results.errors.push(`${testName}: No scenario data`);
          console.log(`  ❌ No scenario data`);
        }

        // Screenshot for diagnostics
        const screenshotPath = `/tmp/claude-0/-home-user/464bea58-d425-5552-a7bd-de5f2e9c99f9/scratchpad/vector-${stock}-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });

      } catch (error) {
        results.failed++;
        results.errors.push(`${testName}: ${error.message}`);
        console.log(`  ❌ ${error.message}`);
      }
    }
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📋 VECTOR UI TEST SUMMARY\n');
  console.log(`Passed:  ${results.passed} ✓`);
  console.log(`Failed:  ${results.failed} ❌`);
  console.log(`Total:   ${results.passed + results.failed}`);

  if (results.passed + results.failed > 0) {
    const passRate = Math.round((results.passed / (results.passed + results.failed)) * 100);
    console.log(`Pass Rate: ${passRate}%\n`);

    if (results.errors.length > 0) {
      console.log('=== FAILURES ===\n');
      results.errors.forEach(err => console.log(`  ❌ ${err}`));
      console.log();
    }

    if (passRate >= 90) {
      console.log('✅ Vector UI scenarios operational\n');
      return 0;
    } else {
      console.log('⚠️ Vector UI scenarios need review\n');
      return 1;
    }
  }

  return 1;
}

const exitCode = await testVectorScenarios();
process.exit(exitCode);
