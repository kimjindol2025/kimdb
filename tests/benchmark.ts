/**
 * KimDB Performance Benchmarks
 * Measures throughput, latency, and resource usage
 */

import { KimDBClient } from '@kimdb/client';
import { performance } from 'perf_hooks';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  throughput: number; // ops/sec
  p95: number;
  p99: number;
}

class Benchmark {
  private measurements: number[] = [];

  constructor(private name: string) {}

  /**
   * Run a function N times and measure
   */
  async run(fn: () => Promise<void>, iterations: number): Promise<BenchmarkResult> {
    this.measurements = [];

    // Warmup
    for (let i = 0; i < Math.min(5, iterations); i++) {
      await fn();
    }

    // Actual benchmark
    const startTotal = performance.now();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const duration = performance.now() - start;
      this.measurements.push(duration);
    }

    const totalTime = performance.now() - startTotal;

    return this.calculate(iterations, totalTime);
  }

  private calculate(iterations: number, totalTime: number): BenchmarkResult {
    const sorted = [...this.measurements].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      operation: this.name,
      iterations,
      totalTime,
      avgTime: this.measurements.reduce((a, b) => a + b, 0) / iterations,
      minTime: Math.min(...this.measurements),
      maxTime: Math.max(...this.measurements),
      throughput: (iterations / totalTime) * 1000,
      p95: sorted[p95Index],
      p99: sorted[p99Index],
    };
  }

  printResult(result: BenchmarkResult): void {
    console.log(`\n📊 ${result.operation}`);
    console.log(`   Iterations: ${result.iterations}`);
    console.log(`   Total Time: ${result.totalTime.toFixed(2)}ms`);
    console.log(`   Avg Time:   ${result.avgTime.toFixed(2)}ms`);
    console.log(`   Min Time:   ${result.minTime.toFixed(2)}ms`);
    console.log(`   Max Time:   ${result.maxTime.toFixed(2)}ms`);
    console.log(`   P95:        ${result.p95.toFixed(2)}ms`);
    console.log(`   P99:        ${result.p99.toFixed(2)}ms`);
    console.log(`   Throughput: ${result.throughput.toFixed(2)} ops/sec`);
  }
}

/**
 * REST API Benchmarks
 */
async function benchmarkRestAPI(): Promise<void> {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000',
    timeout: 30000,
  });

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   KimDB REST API Benchmarks            ║');
  console.log('╚════════════════════════════════════════╝');

  // 1. Health Check
  let benchmark = new Benchmark('Health Check');
  let result = await benchmark.run(async () => {
    await client.health();
  }, 1000);
  benchmark.printResult(result);

  // 2. List Collections
  benchmark = new Benchmark('List Collections');
  result = await benchmark.run(async () => {
    await client.listCollections();
  }, 1000);
  benchmark.printResult(result);

  // 3. Get Collection (Limit 10)
  benchmark = new Benchmark('Get Collection (LIMIT 10)');
  result = await benchmark.run(async () => {
    await client.getCollection('users', { limit: 10 });
  }, 500);
  benchmark.printResult(result);

  // 4. Get Collection (Limit 100)
  benchmark = new Benchmark('Get Collection (LIMIT 100)');
  result = await benchmark.run(async () => {
    await client.getCollection('users', { limit: 100 });
  }, 300);
  benchmark.printResult(result);

  // 5. Get Single Document
  benchmark = new Benchmark('Get Single Document');
  result = await benchmark.run(async () => {
    try {
      await client.getDocument('users', 'user-001');
    } catch {
      // Ignore not found
    }
  }, 500);
  benchmark.printResult(result);

  // 6. Simple Query
  benchmark = new Benchmark('Simple SELECT Query');
  result = await benchmark.run(async () => {
    await client.query(
      'SELECT * FROM users LIMIT 100',
      'users'
    );
  }, 300);
  benchmark.printResult(result);

  // 7. Query with WHERE
  benchmark = new Benchmark('Query with WHERE Clause');
  result = await benchmark.run(async () => {
    await client.query(
      'SELECT * FROM users WHERE age > ? LIMIT 100',
      'users',
      [18]
    );
  }, 300);
  benchmark.printResult(result);

  // 8. Query with GROUP BY
  benchmark = new Benchmark('Query with GROUP BY');
  result = await benchmark.run(async () => {
    await client.query(
      'SELECT age, COUNT(*) as count FROM users GROUP BY age',
      'users'
    );
  }, 200);
  benchmark.printResult(result);

  // 9. Metrics Endpoint
  benchmark = new Benchmark('Get Metrics');
  result = await benchmark.run(async () => {
    await client.metrics();
  }, 100);
  benchmark.printResult(result);
}

/**
 * Concurrent Requests Benchmark
 */
async function benchmarkConcurrency(): Promise<void> {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000',
  });

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Concurrency Benchmarks               ║');
  console.log('╚════════════════════════════════════════╝');

  const concurrencyLevels = [1, 5, 10, 20, 50];

  for (const concurrency of concurrencyLevels) {
    const benchmark = new Benchmark(`Concurrent Requests (${concurrency})`);

    const result = await benchmark.run(async () => {
      const promises = [];
      for (let i = 0; i < concurrency; i++) {
        promises.push(
          client.query('SELECT * FROM users LIMIT 10', 'users')
        );
      }
      await Promise.all(promises);
    }, 50);

    // Scale by concurrency
    result.throughput = (result.throughput * concurrency);
    benchmark.printResult(result);
  }
}

/**
 * Data Size Benchmark
 */
async function benchmarkDataSize(): Promise<void> {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000',
  });

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Data Size Impact Benchmark           ║');
  console.log('╚════════════════════════════════════════╝');

  const limits = [10, 50, 100, 500, 1000];

  for (const limit of limits) {
    const benchmark = new Benchmark(`Query with LIMIT ${limit}`);

    const result = await benchmark.run(async () => {
      await client.query(
        `SELECT * FROM users LIMIT ${limit}`,
        'users'
      );
    }, 100);

    benchmark.printResult(result);
  }
}

/**
 * Query Complexity Benchmark
 */
async function benchmarkQueryComplexity(): Promise<void> {
  const client = new KimDBClient({
    baseUrl: 'http://localhost:40000',
  });

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Query Complexity Benchmark           ║');
  console.log('╚════════════════════════════════════════╝');

  const queries = [
    {
      name: 'Simple SELECT',
      sql: 'SELECT * FROM users LIMIT 100',
    },
    {
      name: 'SELECT with WHERE',
      sql: 'SELECT * FROM users WHERE age > 18 LIMIT 100',
    },
    {
      name: 'SELECT with ORDER BY',
      sql: 'SELECT * FROM users ORDER BY created_at DESC LIMIT 100',
    },
    {
      name: 'SELECT with DISTINCT',
      sql: 'SELECT DISTINCT age FROM users LIMIT 100',
    },
    {
      name: 'Aggregate (COUNT)',
      sql: 'SELECT COUNT(*) as total FROM users',
    },
    {
      name: 'GROUP BY',
      sql: 'SELECT age, COUNT(*) as count FROM users GROUP BY age',
    },
  ];

  for (const query of queries) {
    const benchmark = new Benchmark(query.name);

    const result = await benchmark.run(async () => {
      await client.query(query.sql, 'users');
    }, 200);

    benchmark.printResult(result);
  }
}

/**
 * Compare with SLA
 */
function checkSLA(results: BenchmarkResult[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   SLA Validation                       ║');
  console.log('╚════════════════════════════════════════╝');

  const sla = {
    'Health Check': 50,
    'List Collections': 50,
    'Get Collection (LIMIT 10)': 100,
    'Get Collection (LIMIT 100)': 200,
    'Get Single Document': 100,
    'Simple SELECT Query': 200,
    'Query with WHERE Clause': 300,
    'Query with GROUP BY': 500,
  };

  for (const result of results) {
    const limit = sla[result.operation as keyof typeof sla];
    if (limit) {
      const passed = result.avgTime < limit;
      const status = passed ? '✅' : '❌';
      console.log(`${status} ${result.operation}: ${result.avgTime.toFixed(2)}ms (SLA: ${limit}ms)`);
    }
  }
}

/**
 * Export and Summary
 */
function printSummary(results: BenchmarkResult[]): void {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Summary                              ║');
  console.log('╚════════════════════════════════════════╝');

  const avgLatency = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;
  const totalThroughput = results.reduce((sum, r) => sum + r.throughput, 0);

  console.log(`\nOverall Metrics:`);
  console.log(`  Avg Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`  Total Throughput: ${totalThroughput.toFixed(2)} ops/sec`);
  console.log(`  Test Operations: ${results.length}`);
}

// Main execution
async function runAllBenchmarks(): Promise<void> {
  try {
    await benchmarkRestAPI();
    await benchmarkConcurrency();
    await benchmarkDataSize();
    await benchmarkQueryComplexity();

    console.log('\n✅ All benchmarks completed!');
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

export { Benchmark, benchmarkRestAPI, benchmarkConcurrency, benchmarkDataSize, benchmarkQueryComplexity };

if (require.main === module) {
  runAllBenchmarks();
}
