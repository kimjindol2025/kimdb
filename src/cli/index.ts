#!/usr/bin/env node
/**
 * kimdb CLI
 *
 * npx kimdb init  - 프로젝트 초기화
 * npx kimdb start - 서버 시작
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { generateEnvExample } from '../server/config.js';

const VERSION = '7.0.0';

const HELP = `
kimdb v${VERSION} - High-performance document database with CRDT

Usage:
  kimdb init     Initialize kimdb in current directory
  kimdb start    Start kimdb server
  kimdb help     Show this help message

Examples:
  npx kimdb init
  npx kimdb start

Environment Variables:
  KIMDB_API_KEY     Required API key (auto-generated in dev mode)
  KIMDB_PORT        Server port (default: 40000)
  KIMDB_HOST        Server host (default: 0.0.0.0)
  KIMDB_DATA_DIR    Data directory (default: ./data)

For more information: https://github.com/kimdb/kimdb
`;

const PM2_CONFIG = `module.exports = {
  apps: [{
    name: 'kimdb',
    script: 'node_modules/kimdb/dist/server/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      KIMDB_PORT: 40000,
    },
    env_file: '.env',
  }],
};
`;

async function init(): Promise<void> {
  console.log(`kimdb v${VERSION} - Initializing...`);

  const cwd = process.cwd();

  // Create .env.example
  const envExamplePath = join(cwd, '.env.example');
  if (!existsSync(envExamplePath)) {
    writeFileSync(envExamplePath, generateEnvExample());
    console.log('  Created .env.example');
  } else {
    console.log('  .env.example already exists, skipping');
  }

  // Create .env if not exists
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) {
    const crypto = await import('crypto');
    const apiKey = `kimdb_${crypto.randomBytes(24).toString('hex')}`;
    const envContent = `# kimdb Configuration
KIMDB_API_KEY=${apiKey}
KIMDB_PORT=40000
NODE_ENV=development
`;
    writeFileSync(envPath, envContent);
    console.log('  Created .env with auto-generated API key');
  } else {
    console.log('  .env already exists, skipping');
  }

  // Create ecosystem.config.cjs for PM2
  const pm2ConfigPath = join(cwd, 'ecosystem.config.cjs');
  if (!existsSync(pm2ConfigPath)) {
    writeFileSync(pm2ConfigPath, PM2_CONFIG);
    console.log('  Created ecosystem.config.cjs (PM2 config)');
  } else {
    console.log('  ecosystem.config.cjs already exists, skipping');
  }

  // Create data directory
  const dataDir = join(cwd, 'data');
  if (!existsSync(dataDir)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(dataDir, { recursive: true });
    console.log('  Created data directory');
  }

  console.log(`
Initialization complete!

Next steps:
  1. Edit .env to configure your settings
  2. Run 'npx kimdb start' to start the server

For production:
  pm2 start ecosystem.config.cjs
`);
}

async function start(): Promise<void> {
  console.log(`kimdb v${VERSION} - Starting server...`);

  // Load .env if exists
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const { readFileSync } = await import('fs');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }

  // Start server
  const { KimDBServer } = await import('../server/index.js');
  const server = new KimDBServer();

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

// ===== Main =====
const command = process.argv[2];

switch (command) {
  case 'init':
    init().catch((e) => {
      console.error('Error:', e.message);
      process.exit(1);
    });
    break;

  case 'start':
    start().catch((e) => {
      console.error('Error:', e.message);
      process.exit(1);
    });
    break;

  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;

  case 'version':
  case '--version':
  case '-v':
    console.log(`kimdb v${VERSION}`);
    break;

  default:
    if (command) {
      console.error(`Unknown command: ${command}`);
    }
    console.log(HELP);
    process.exit(command ? 1 : 0);
}
