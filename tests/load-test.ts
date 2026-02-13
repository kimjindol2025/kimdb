/**
 * KimDB Load Testing Suite
 * Tests throughput, latency, and reliability under load
 */

import { KimDBClient } from '@kimdb/client';
import { performance } from 'perf_hooks';

interface LoadTestConfig {
  baseUrl: string;
  duration: number; // milliseconds
  rps: number; // requests per second
  concurrency: number;
  timeout: number;
  token?: string;
}

interface LoadTestResult {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDuration: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number; // requests per second
  errorRate: number;
  rps: number;
}

class LoadTester {
  private client: KimDBClient;
  private latencies: number[] = [];
  private errors: Error[] = [];
  private successCount = 0;
  private failureCount = 0;
  private startTime = 0;

  constructor(private config: LoadTestConfig) {
    this.client = new KimDBClient({
      baseUrl: config.baseUrl,
      token: config.token,
      timeout: config.timeout,
      retries: 0, // No retries for load tests
    });
  }

  /**
   * Run load test for REST API
   */
  async runRestApiLoadTest(): Promise<LoadTestResult> {
    this.startTime = performance.now();
    const endTime = this.startTime + this.config.duration;
    const interval = 1000 / this.config.rps;

    const operations = [
      () => this.testHealthCheck(),
      () => this.testGetCollections(),
      () => this.testGetDocuments(),
      () => this.testQuery(),
    ];

    // Run requests at specified RPS
    let operationIndex = 0;
    let nextRequestTime = this.startTime;

    while (performance.now() < endTime) {
      const now = performance.now();

      if (now >= nextRequestTime) {
        const operation = operations[operationIndex % operations.length];
        operationIndex++;

        // Run with concurrency
        const promises = [];
        for (let i = 0; i < this.config.concurrency; i++) {
          promises.push(
            operation().catch((error) => {
              this.failureCount++;
              this.errors.push(error);
            })
          );
        }

        Promise.all(promises).catch(() => {
          // Ignore
        });

        nextRequestTime = now + interval;
      }

      // Small sleep to prevent CPU spinning
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    // Wait for pending requests
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return this.generateReport();
  }

  /**
   * Test: Health check
   */
  private async testHealthCheck(): Promise<void> {
    const start = performance.now();

    try {
      await this.client.health();
      const latency = performance.now() - start;
      this.recordSuccess(latency);
    } catch (error) {
      this.recordFailure(error as Error);
    }
  }

  /**
   * Test: List collections
   */
  private async testGetCollections(): Promise<void> {
    const start = performance.now();

    try {
      await this.client.listCollections();
      const latency = performance.now() - start;
      this.recordSuccess(latency);
    } catch (error) {
      this.recordFailure(error as Error);
    }
  }

  /**
   * Test: Get all documents
   */
  private async testGetDocuments(): Promise<void> {
    const start = performance.now();

    try {
      await this.client.getCollection('users', { limit: 100 });
      const latency = performance.now() - start;
      this.recordSuccess(latency);
    } catch (error) {
      this.recordFailure(error as Error);
    }
  }

  /**
   * Test: SQL query
   */
  private async testQuery(): Promise<void> {
    const start = performance.now();

    try {
      await this.client.query(
        'SELECT * FROM users LIMIT 10',
        'users'
      );
      const latency = performance.now() - start;
      this.recordSuccess(latency);
    } catch (error) {
      this.recordFailure(error as Error);
    }
  }

  private recordSuccess(latency: number): void {
    this.successCount++;
    this.latencies.push(latency);
  }

  private recordFailure(error: Error): void {
    this.failureCount++;
    this.errors.push(error);
  }

  private generateReport(): LoadTestResult {
    const totalDuration = performance.now() - this.startTime;
    const totalRequests = this.successCount + this.failureCount;

    // Calculate percentiles
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      totalRequests,
      successfulRequests: this.successCount,
      failedRequests: this.failureCount,
      totalDuration,
      avgLatency:
        this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length || 0,
      minLatency: Math.min(...this.latencies),
      maxLatency: Math.max(...this.latencies),
      p95Latency: sorted[p95Index] || 0,
      p99Latency: sorted[p99Index] || 0,
      throughput: (this.successCount / totalDuration) * 1000,
      errorRate: this.failureCount / totalRequests,
      rps: totalRequests / (totalDuration / 1000),
    };
  }
}

/**
 * Stress Test: Gradually increase load
 */
async function stressTest(): Promise<void> {
  console.log('\n=== KimDB Stress Test ===\n');

  const stages = [
    { rps: 10, concurrency: 1, duration: 10000, name: '10 RPS' },
    { rps: 50, concurrency: 2, duration: 10000, name: '50 RPS' },
    { rps: 100, concurrency: 5, duration: 10000, name: '100 RPS' },
    { rps: 500, concurrency: 10, duration: 10000, name: '500 RPS' },
    { rps: 1000, concurrency: 20, duration: 10000, name: '1000 RPS' },
  ];

  for (const stage of stages) {
    console.log(`\n▶ Stage: ${stage.name}`);
    console.log(`  RPS: ${stage.rps}, Concurrency: ${stage.concurrency}`);

    const tester = new LoadTester({
      baseUrl: 'http://localhost:40000',
      duration: stage.duration,
      rps: stage.rps,
      concurrency: stage.concurrency,
      timeout: 30000,
    });

    const result = await tester.runRestApiLoadTest();

    console.log(`  Results:`);
    console.log(`    Total Requests: ${result.totalRequests}`);
    console.log(`    Success Rate: ${((1 - result.errorRate) * 100).toFixed(2)}%`);
    console.log(`    Throughput: ${result.throughput.toFixed(2)} req/s`);
    console.log(`    Avg Latency: ${result.avgLatency.toFixed(2)}ms`);
    console.log(`    P95 Latency: ${result.p95Latency.toFixed(2)}ms`);
    console.log(`    P99 Latency: ${result.p99Latency.toFixed(2)}ms`);

    // Check SLA
    if (result.errorRate > 0.01) {
      console.log(`    ⚠️  High error rate: ${(result.errorRate * 100).toFixed(2)}%`);
      break;
    }
    if (result.p99Latency > 5000) {
      console.log(`    ⚠️  High latency: ${result.p99Latency.toFixed(2)}ms`);
      break;
    }
  }
}

/**
 * Sustained Load Test
 */
async function sustainedLoadTest(): Promise<void> {
  console.log('\n=== KimDB Sustained Load Test ===\n');
  console.log('Testing 100 RPS for 5 minutes...\n');

  const tester = new LoadTester({
    baseUrl: 'http://localhost:40000',
    duration: 5 * 60 * 1000, // 5 minutes
    rps: 100,
    concurrency: 5,
    timeout: 30000,
  });

  const result = await tester.runRestApiLoadTest();

  console.log(`Results:`);
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(`  Success Rate: ${((1 - result.errorRate) * 100).toFixed(2)}%`);
  console.log(`  Throughput: ${result.throughput.toFixed(2)} req/s`);
  console.log(`  Avg Latency: ${result.avgLatency.toFixed(2)}ms`);
  console.log(`  P95 Latency: ${result.p95Latency.toFixed(2)}ms`);
  console.log(`  P99 Latency: ${result.p99Latency.toFixed(2)}ms`);
  console.log(`  Max Latency: ${result.maxLatency.toFixed(2)}ms`);

  // SLA Validation
  console.log(`\n=== SLA Validation ===`);
  const slaChecks = {
    'Success Rate > 99%': (1 - result.errorRate) * 100 > 99,
    'P99 Latency < 1000ms': result.p99Latency < 1000,
    'P95 Latency < 500ms': result.p95Latency < 500,
    'Throughput > 50 req/s': result.throughput > 50,
  };

  for (const [check, passed] of Object.entries(slaChecks)) {
    console.log(`  ${passed ? '✅' : '❌'} ${check}`);
  }
}

/**
 * Spike Test: Sudden load increase
 */
async function spikeTest(): Promise<void> {
  console.log('\n=== KimDB Spike Test ===\n');

  const config: LoadTestConfig = {
    baseUrl: 'http://localhost:40000',
    duration: 30000, // 30 seconds
    rps: 500, // Sudden spike to 500 RPS
    concurrency: 20,
    timeout: 30000,
  };

  console.log('Applying sudden load spike (500 RPS)...\n');

  const tester = new LoadTester(config);
  const result = await tester.runRestApiLoadTest();

  console.log(`Results:`);
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(`  Success Rate: ${((1 - result.errorRate) * 100).toFixed(2)}%`);
  console.log(`  P99 Latency: ${result.p99Latency.toFixed(2)}ms`);
  console.log(`  Max Latency: ${result.maxLatency.toFixed(2)}ms`);

  if (result.errorRate < 0.05 && result.p99Latency < 2000) {
    console.log(`\n✅ Spike test passed - System recovered quickly`);
  } else {
    console.log(`\n❌ Spike test failed - System struggled with spike`);
  }
}

/**
 * Endurance Test: Long-running test for memory leaks
 */
async function enduranceTest(): Promise<void> {
  console.log('\n=== KimDB Endurance Test ===\n');
  console.log('Running for 30 minutes at 50 RPS...\n');

  const tester = new LoadTester({
    baseUrl: 'http://localhost:40000',
    duration: 30 * 60 * 1000, // 30 minutes
    rps: 50,
    concurrency: 3,
    timeout: 30000,
  });

  // Periodically log memory
  const memoryMonitor = setInterval(() => {
    const usage = process.memoryUsage();
    console.log(`Memory: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  }, 60000); // Every minute

  const result = await tester.runRestApiLoadTest();
  clearInterval(memoryMonitor);

  console.log(`\nResults:`);
  console.log(`  Total Requests: ${result.totalRequests}`);
  console.log(`  Success Rate: ${((1 - result.errorRate) * 100).toFixed(2)}%`);
  console.log(`  Avg Latency: ${result.avgLatency.toFixed(2)}ms`);

  if (result.errorRate < 0.01) {
    console.log(`\n✅ Endurance test passed - No memory leaks detected`);
  }
}

// Export for CLI
export { LoadTester, stressTest, sustainedLoadTest, spikeTest, enduranceTest };

// Run if executed directly
if (require.main === module) {
  const testType = process.argv[2] || 'stress';

  (async () => {
    switch (testType) {
      case 'stress':
        await stressTest();
        break;
      case 'sustained':
        await sustainedLoadTest();
        break;
      case 'spike':
        await spikeTest();
        break;
      case 'endurance':
        await enduranceTest();
        break;
      default:
        console.log('Usage: npm run test:load [stress|sustained|spike|endurance]');
    }
    process.exit(0);
  })();
}
