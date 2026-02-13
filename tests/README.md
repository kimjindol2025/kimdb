# KimDB Testing Suite

Complete testing framework covering load testing, E2E tests, performance benchmarks, and SLA validation.

## Test Types

### 1. Load Testing (load-test.ts)

Measures system behavior under controlled load.

**Test Scenarios**:
- **Stress Test**: Gradually increase load (10 → 1000 RPS)
- **Sustained Load**: Maintain constant load for extended period
- **Spike Test**: Sudden load increase to peak capacity
- **Endurance Test**: Long-running test for memory leaks

**Running Load Tests**:
```bash
# Stress test (gradual increase)
npm run test:load stress

# Sustained load (100 RPS for 5 minutes)
npm run test:load sustained

# Spike test (sudden 500 RPS)
npm run test:load spike

# Endurance test (30 minutes at 50 RPS)
npm run test:load endurance
```

**Metrics Collected**:
- Total requests
- Success/failure count
- Average latency
- P95 and P99 latencies
- Throughput (req/s)
- Error rate

**Example Output**:
```
▶ Stage: 100 RPS
  Results:
    Total Requests: 1000
    Success Rate: 99.8%
    Throughput: 101.23 req/s
    Avg Latency: 45.23ms
    P95 Latency: 120.45ms
    P99 Latency: 250.67ms
```

### 2. End-to-End Tests (e2e-test.ts)

Tests complete user workflows using Playwright.

**Test Categories**:
- Health & Connectivity
- CRUD Operations
- Query Operations
- Error Handling
- Performance
- Data Integrity
- Pagination
- WebSocket Sync
- Real-time Synchronization

**Running E2E Tests**:
```bash
# All tests
npm run test:e2e

# Specific test suite
npx playwright test e2e-test.ts --grep "CRUD Operations"

# With UI
npx playwright test --ui

# Debug mode
npx playwright test --debug
```

**Sample Test**:
```typescript
test('should handle limit parameter', async () => {
  const response = await client.getCollection('users', { limit: 5 });
  expect(response.data.length).toBeLessThanOrEqual(5);
});
```

### 3. Performance Benchmarks (benchmark.ts)

Detailed performance measurements across operations.

**Benchmark Categories**:
- REST API operations (9 tests)
- Concurrency levels (1-50 concurrent)
- Data size impact (10-1000 rows)
- Query complexity (6 query types)

**Running Benchmarks**:
```bash
npm run test:benchmark
```

**Metrics**:
- Total time
- Average latency
- Min/Max latency
- P95/P99 latencies
- Throughput (ops/sec)

**Example Results**:
```
📊 Health Check
   Iterations: 1000
   Avg Time:   12.34ms
   P95:        45.67ms
   P99:        89.01ms
   Throughput: 81.03 ops/sec

📊 Get Collection (LIMIT 100)
   Iterations: 300
   Avg Time:   156.78ms
   P95:        234.56ms
   Throughput: 6.38 ops/sec
```

### 4. SLA Validation (sla-validation.ts)

Validates Service Level Agreement commitments.

**SLA Metrics**:
- **Availability**: 99.9% uptime
- **Latency**: P50 < 100ms, P95 < 500ms, P99 < 1000ms
- **Error Rate**: < 0.1%
- **Throughput**: > 1000 req/s
- **Data Consistency**: Reads return same data
- **Error Recovery**: 90%+ recovery rate

**Running SLA Validation**:
```bash
npm run test:sla
```

**Customizing SLA**:
```typescript
const validator = new SLAValidator(client, {
  availability: 99.95,
  latency: {
    p50: 50,
    p95: 300,
    p99: 800,
  },
  errorRate: 0.05,
  throughput: 2000,
});
```

**Sample Report**:
```
╔════════════════════════════════════════╗
║   SLA Validation Report                ║
╚════════════════════════════════════════╝

Metric                  | Target      | Actual      | Status
─────────────────────────────────────────────────────────────
Availability            | 99.9%       | 99.95%      | ✅ PASS
P50 Latency             | 100ms       | 45.23ms     | ✅ PASS
P95 Latency             | 500ms       | 234.56ms    | ✅ PASS
P99 Latency             | 1000ms      | 567.89ms    | ✅ PASS
Error Rate              | 0.1%        | 0.05%       | ✅ PASS
Throughput              | 1000 req/s  | 1234.56 req/s | ✅ PASS
Data Consistency        | Consistent  | Consistent  | ✅ PASS
Error Recovery Rate     | 90%         | 95%         | ✅ PASS

Summary: 8/8 SLA checks passed
Overall SLA Status: ✅ PASSED
```

---

## Setup & Configuration

### Prerequisites

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

### Environment Variables

```bash
# .env
BASE_URL=http://localhost:40000
LOAD_TEST_DURATION=60000
LOAD_TEST_RPS=100
LOAD_TEST_CONCURRENCY=5
BENCHMARK_ITERATIONS=1000
SLA_AVAILABILITY_TARGET=99.9
SLA_LATENCY_P99=1000
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "npm run test:e2e && npm run test:load stress && npm run test:benchmark && npm run test:sla",
    "test:e2e": "playwright test",
    "test:load": "ts-node tests/load-test.ts",
    "test:benchmark": "ts-node tests/benchmark.ts",
    "test:sla": "ts-node tests/sla-validation.ts"
  }
}
```

---

## Running Test Suites

### Quick Test (5 minutes)

```bash
npm run test:benchmark
```

### Full Test Suite (30+ minutes)

```bash
npm run test
```

### Continuous Testing

```bash
# Watch mode - re-run tests on file changes
npm run test:e2e -- --reporter=html

# Generate HTML report
npx playwright show-report
```

### Performance Profiling

```bash
# Run with CPU profiling
node --prof tests/benchmark.ts

# Generate profile
node --prof-process isolate-*.log > profile.txt
```

---

## Test Results Interpretation

### Throughput

```
✅ Good:  > 1000 req/s
⚠️  Fair:  500-1000 req/s
❌ Poor:   < 500 req/s
```

### Latency (P99)

```
✅ Good:  < 500ms
⚠️  Fair:  500-1000ms
❌ Poor:   > 1000ms
```

### Error Rate

```
✅ Good:  < 0.1%
⚠️  Fair:  0.1-1%
❌ Poor:   > 1%
```

### Availability

```
✅ Good:  > 99.9%
⚠️  Fair:  99-99.9%
❌ Poor:   < 99%
```

---

## Troubleshooting

### High Latency

1. Check server CPU/memory usage
2. Verify network latency with `ping`
3. Review slow queries with metrics endpoint
4. Check database size and indexing

### High Error Rate

1. Check server logs
2. Verify database connectivity
3. Test with smaller payloads
4. Check rate limiting configuration

### Memory Leaks

1. Run endurance test
2. Monitor memory during test
3. Check for unclosed connections
4. Review Node.js heap snapshots

### Timeout Issues

1. Increase timeout value in config
2. Reduce concurrent requests
3. Reduce RPS
4. Check server network connectivity

---

## Best Practices

### 1. Test Environment

- Use dedicated test server
- Isolate from production traffic
- Consistent data/schema
- No background jobs during tests

### 2. Load Testing

- Start with low load, gradually increase
- Run multiple times to ensure consistency
- Record baseline metrics
- Compare against SLA targets

### 3. E2E Testing

- Test happy paths and error cases
- Cover pagination, sorting, filtering
- Test real-time sync with WebSocket
- Validate error messages

### 4. Monitoring

- Record test results in database
- Track trends over time
- Alert on SLA violations
- Compare versions

---

## Performance Baselines

### Typical Results (on i7, 16GB RAM, SSD)

```
Operation              | Avg Latency | P99 Latency | Throughput
────────────────────────────────────────────────────────────
Health Check          | 10ms        | 30ms        | 100 ops/s
List Collections      | 15ms        | 45ms        | 67 ops/s
Get Collection (10)   | 25ms        | 75ms        | 40 ops/s
Get Collection (100)  | 150ms       | 300ms       | 7 ops/s
Simple Query          | 50ms        | 150ms       | 20 ops/s
Query with WHERE      | 80ms        | 250ms       | 12 ops/s
Query with GROUP BY   | 200ms       | 600ms       | 5 ops/s
```

---

## Integration with CI/CD

### GitHub Actions

```yaml
name: KimDB Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      kimdb:
        image: kimdb:latest
        ports:
          - 40000:40000

    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npx playwright install
      - run: npm run test:e2e
      - run: npm run test:benchmark
      - run: npm run test:sla
      - uses: actions/upload-artifact@v2
        if: always()
        with:
          name: test-results
          path: test-results/
```

---

## Advanced Testing

### Custom Load Profile

```typescript
const customProfile = async () => {
  // 0-5 min: Warm up to 100 RPS
  // 5-10 min: Sustained 100 RPS
  // 10-15 min: Spike to 500 RPS
  // 15-20 min: Cool down to 0 RPS
};
```

### Database-specific Tests

```bash
# Test with different data sizes
npm run test:benchmark -- --data-size=small
npm run test:benchmark -- --data-size=medium
npm run test:benchmark -- --data-size=large
```

---

## See Also

- [Load Testing Guide](../docs/PERFORMANCE_TESTING.md)
- [Performance Tuning](../docs/PERFORMANCE_TUNING.md)
- [SLA Documentation](../docs/SLA.md)
- [Monitoring Setup](../docs/MONITORING.md)

---

Last updated: 2024-02-13
Version: 1.0.0
