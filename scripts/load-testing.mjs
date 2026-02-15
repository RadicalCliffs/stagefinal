#!/usr/bin/env node
/**
 * Load Testing Script
 * 
 * Simulates concurrent users to test system performance under load.
 * 
 * Usage:
 *   node scripts/load-testing.mjs --users=100 --duration=60 --url=https://theprize.io
 */

import { performance } from 'perf_hooks';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

class LoadTester {
  constructor(config) {
    this.config = {
      users: parseInt(config.users) || 100,
      duration: parseInt(config.duration) || 60, // seconds
      baseUrl: config.url || 'http://localhost:5173',
      rampUpTime: parseInt(config.rampUp) || 10, // seconds
    };
    
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimes: [],
      errors: [],
      startTime: null,
      endTime: null,
    };
    
    this.endpoints = [
      { path: '/', weight: 30 }, // Homepage
      { path: '/competitions', weight: 25 }, // Competitions list
      { path: '/dashboard', weight: 20 }, // User dashboard
      { path: '/how-to-play', weight: 15 }, // Info pages
      { path: '/faq', weight: 10 }, // FAQ
    ];
  }

  selectEndpoint() {
    const random = Math.random() * 100;
    let cumulative = 0;
    
    for (const endpoint of this.endpoints) {
      cumulative += endpoint.weight;
      if (random <= cumulative) {
        return endpoint.path;
      }
    }
    
    return this.endpoints[0].path;
  }

  async makeRequest(endpoint) {
    const url = `${this.config.baseUrl}${endpoint}`;
    const startTime = performance.now();
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'LoadTest/1.0',
        },
      });
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      this.metrics.totalRequests++;
      this.metrics.responseTimes.push(duration);
      
      if (response.ok) {
        this.metrics.successfulRequests++;
      } else {
        this.metrics.failedRequests++;
        this.metrics.errors.push({
          endpoint,
          status: response.status,
          duration,
        });
      }
      
      return { success: true, duration, status: response.status };
      
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      this.metrics.totalRequests++;
      this.metrics.failedRequests++;
      this.metrics.errors.push({
        endpoint,
        error: error.message,
        duration,
      });
      
      return { success: false, duration, error: error.message };
    }
  }

  async simulateUser(userId, duration) {
    const startTime = Date.now();
    let requestCount = 0;
    
    while (Date.now() - startTime < duration * 1000) {
      const endpoint = this.selectEndpoint();
      await this.makeRequest(endpoint);
      requestCount++;
      
      // Random think time between requests (1-3 seconds)
      const thinkTime = 1000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, thinkTime));
    }
    
    return requestCount;
  }

  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  async run() {
    log('\n╔════════════════════════════════════════════╗', 'magenta');
    log('║          LOAD TESTING SCRIPT              ║', 'magenta');
    log('╚════════════════════════════════════════════╝', 'magenta');
    
    log(`\nConfiguration:`, 'blue');
    log(`  Base URL: ${this.config.baseUrl}`, 'cyan');
    log(`  Concurrent Users: ${this.config.users}`, 'cyan');
    log(`  Test Duration: ${this.config.duration}s`, 'cyan');
    log(`  Ramp-up Time: ${this.config.rampUpTime}s`, 'cyan');
    
    // Verify URL is accessible
    log(`\nVerifying URL accessibility...`, 'blue');
    try {
      const response = await fetch(this.config.baseUrl);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      log(`✓ URL accessible`, 'green');
    } catch (error) {
      log(`✗ URL not accessible: ${error.message}`, 'red');
      log(`Make sure the server is running and the URL is correct`, 'yellow');
      process.exit(1);
    }
    
    log(`\nStarting load test...`, 'blue');
    this.metrics.startTime = Date.now();
    
    // Ramp up users gradually
    const users = [];
    const delayBetweenUsers = (this.config.rampUpTime * 1000) / this.config.users;
    
    for (let i = 0; i < this.config.users; i++) {
      users.push(this.simulateUser(i + 1, this.config.duration));
      
      // Progress indicator
      if ((i + 1) % 10 === 0) {
        log(`  Ramping up... ${i + 1}/${this.config.users} users`, 'cyan');
      }
      
      if (i < this.config.users - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenUsers));
      }
    }
    
    log(`✓ All ${this.config.users} users started`, 'green');
    log(`Running test for ${this.config.duration} seconds...`, 'blue');
    
    // Wait for all users to complete
    await Promise.all(users);
    
    this.metrics.endTime = Date.now();
    
    // Calculate metrics
    const totalDuration = (this.metrics.endTime - this.metrics.startTime) / 1000;
    const requestsPerSecond = this.metrics.totalRequests / totalDuration;
    const successRate = (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;
    
    const avgResponseTime = this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
    const minResponseTime = Math.min(...this.metrics.responseTimes);
    const maxResponseTime = Math.max(...this.metrics.responseTimes);
    const p50 = this.calculatePercentile(this.metrics.responseTimes, 50);
    const p95 = this.calculatePercentile(this.metrics.responseTimes, 95);
    const p99 = this.calculatePercentile(this.metrics.responseTimes, 99);
    
    // Print results
    log('\n╔════════════════════════════════════════════╗', 'magenta');
    log('║          TEST RESULTS                      ║', 'magenta');
    log('╚════════════════════════════════════════════╝', 'magenta');
    
    log(`\nRequests:`, 'blue');
    log(`  Total: ${this.metrics.totalRequests}`, 'cyan');
    log(`  Successful: ${this.metrics.successfulRequests} (${successRate.toFixed(1)}%)`, 
      successRate >= 95 ? 'green' : successRate >= 90 ? 'yellow' : 'red');
    log(`  Failed: ${this.metrics.failedRequests}`, 
      this.metrics.failedRequests === 0 ? 'green' : 'red');
    log(`  Requests/sec: ${requestsPerSecond.toFixed(2)}`, 'cyan');
    
    log(`\nResponse Times (ms):`, 'blue');
    log(`  Min: ${minResponseTime.toFixed(0)}`, 'cyan');
    log(`  Max: ${maxResponseTime.toFixed(0)}`, 'cyan');
    log(`  Avg: ${avgResponseTime.toFixed(0)}`, 
      avgResponseTime < 1000 ? 'green' : avgResponseTime < 2000 ? 'yellow' : 'red');
    log(`  P50 (median): ${p50.toFixed(0)}`, 'cyan');
    log(`  P95: ${p95.toFixed(0)}`, 
      p95 < 3000 ? 'green' : p95 < 5000 ? 'yellow' : 'red');
    log(`  P99: ${p99.toFixed(0)}`, 
      p99 < 5000 ? 'green' : p99 < 10000 ? 'yellow' : 'red');
    
    // Performance assessment
    log(`\nPerformance Assessment:`, 'blue');
    
    const passedCriteria = {
      successRate: successRate >= 95,
      avgResponseTime: avgResponseTime < 2000,
      p95ResponseTime: p95 < 5000,
    };
    
    const allPassed = Object.values(passedCriteria).every(v => v);
    
    log(`  Success rate ≥95%: ${passedCriteria.successRate ? '✓' : '✗'}`, 
      passedCriteria.successRate ? 'green' : 'red');
    log(`  Avg response time <2s: ${passedCriteria.avgResponseTime ? '✓' : '✗'}`, 
      passedCriteria.avgResponseTime ? 'green' : 'red');
    log(`  P95 response time <5s: ${passedCriteria.p95ResponseTime ? '✓' : '✗'}`, 
      passedCriteria.p95ResponseTime ? 'green' : 'red');
    
    if (allPassed) {
      log(`\n✅ LOAD TEST PASSED`, 'green');
    } else {
      log(`\n⚠️  LOAD TEST ISSUES DETECTED`, 'yellow');
    }
    
    // Show errors if any
    if (this.metrics.errors.length > 0) {
      log(`\nErrors (first 10):`, 'blue');
      this.metrics.errors.slice(0, 10).forEach((error, i) => {
        log(`  ${i + 1}. ${error.endpoint}: ${error.error || `HTTP ${error.status}`}`, 'red');
      });
      if (this.metrics.errors.length > 10) {
        log(`  ... and ${this.metrics.errors.length - 10} more errors`, 'yellow');
      }
    }
    
    // Save detailed results
    const results = {
      config: this.config,
      metrics: {
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        successRate,
        requestsPerSecond,
        responseTime: {
          min: minResponseTime,
          max: maxResponseTime,
          avg: avgResponseTime,
          p50,
          p95,
          p99,
        },
        errors: this.metrics.errors,
      },
      timestamp: new Date().toISOString(),
      passed: allPassed,
    };
    
    const resultsFile = join(__dirname, `../test-results/load-test-${Date.now()}.json`);
    writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    log(`\nDetailed results saved to: ${resultsFile}`, 'cyan');
    
    process.exit(allPassed ? 0 : 1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const config = {};

args.forEach(arg => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) {
    config[key.substring(2)] = value;
  }
});

if (!config.url) {
  log('Warning: --url not specified, using default http://localhost:5173', 'yellow');
}

// Run load test
const tester = new LoadTester(config);
tester.run();
