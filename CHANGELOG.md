# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.6.1] - 2026-02-13

### Added
- GitHub Actions CI/CD workflows (test, build)
- Codecov integration for coverage reporting
- This CHANGELOG file

### Changed
- Improved build and test automation

### Fixed
- Build artifact verification in CI/CD

## [7.6.0] - 2026-01-21

### Added
- Safety Hardening features
- Backup and recovery mechanisms
- Data integrity verification
- Crash recovery system
- PM2 ecosystem configuration

### Changed
- Enhanced data persistence strategy
- Improved error handling and recovery

### Fixed
- Data consistency issues
- Recovery from unexpected shutdowns

## [7.5.3] - 2026-01-20

### Added
- PM2 ecosystem.config.js setup

## [7.5.2] - 2026-01-19

### Added
- Real-time monitoring dashboard
- Metrics collection and visualization
- 8-shard status monitoring

## [7.5.1] - 2026-01-15

### Added
- REST API client methods
- Simple client improvements
- Enhanced API documentation

### Changed
- Improved client-server communication

## [7.5.0] - 2026-01-10

### Added
- Real-time monitoring dashboard
- Simple REST client SDK
- Performance metrics collection
- Health check endpoints

## [7.4.0] - 2026-01-05

### Added
- HyperScale Safe mode
- Data persistence guarantee
- Consistency verification

### Changed
- Improved data durability guarantees

## [7.3.0] - 2025-12-28

### Added
- HyperScale support for 10,000+ concurrent users
- Advanced buffering strategies
- Parallel write optimization
- WAL (Write-Ahead Logging) implementation

### Changed
- Significantly improved throughput (909K/sec)
- Optimized memory management

## [7.2.0] - 2025-12-20

### Added
- Sharding support
- Multi-shard query support
- Automatic shard distribution (MD5-based)

### Changed
- Improved scalability for 1000+ concurrent users

## [7.1.0] - 2025-12-15

### Added
- Concurrent write support
- Transaction Manager with queue-based serialization
- SQLITE_BUSY retry mechanism
- Multi-client coordination

### Changed
- Enhanced concurrency handling
- Better lock management

## [7.0.0] - 2025-12-10

### Added
- CRDT Engine (Conflict-free Replicated Data Type)
  - VectorClock for causality tracking
  - LWW-Set/Map for last-write-wins semantics
  - RGA (Replicated Growable Array)
  - RichText CRDT for rich document support
- Real-time WebSocket synchronization
- Offline-first support
- Google Docs-like collaborative editing

### Changed
- Complete architecture redesign
- New data structure implementation

## [6.0.0] - 2025-11-15

### Added
- TypeScript rewrite
- Better type safety
- Enhanced API design

### Changed
- Migration to TypeScript
- Improved developer experience

## [1.0.0] - 2025-10-01

### Added
- Initial release
- Core document database functionality
- Basic SQLite support
- WebSocket real-time updates
- Client-server architecture
