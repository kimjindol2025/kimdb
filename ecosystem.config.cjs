module.exports = {
  apps: [{
    name: 'kimdb',
    script: 'src/api-server.js',
    cwd: '/home/kimjin/kimdb',
    interpreter: 'node',
    env: {
      PORT: 40000,
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '500M',
    exp_backoff_restart_delay: 1000
  }]
};
