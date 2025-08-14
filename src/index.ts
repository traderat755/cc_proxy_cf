import { serve } from '@hono/node-server';
import { config } from './core/config.js';
import routes from './api/routes.js';

function showHelp() {
  console.log('Claude-to-OpenAI API Proxy v1.0.0');
  console.log('');
  console.log('Usage: npm run dev');
  console.log('');
  console.log('Required environment variables:');
  console.log('  None - API key is provided by clients in each request');
  console.log('');
  console.log('Optional environment variables:');
  console.log(`  OPENAI_BASE_URL - OpenAI API base URL (default: https://api.openai.com/v1)`);
  console.log(`  BIG_MODEL - Model for opus requests (default: gpt-4o)`);
  console.log(`  MIDDLE_MODEL - Model for sonnet requests (default: gpt-4o)`);
  console.log(`  SMALL_MODEL - Model for haiku requests (default: gpt-4o-mini)`);
  console.log(`  HOST - Server host (default: 0.0.0.0)`);
  console.log(`  PORT - Server port (default: 8082)`);
  console.log(`  LOG_LEVEL - Logging level (default: WARNING)`);
  console.log(`  MAX_TOKENS_LIMIT - Token limit (default: 4096)`);
  console.log(`  MIN_TOKENS_LIMIT - Minimum token limit (default: 100)`);
  console.log(`  REQUEST_TIMEOUT - Request timeout in seconds (default: 90)`);
  console.log('');
  console.log('Model mapping:');
  console.log(`  Claude haiku models -> ${config.smallModel}`);
  console.log(`  Claude sonnet/opus models -> ${config.bigModel}`);
}

function main() {
  if (process.argv.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  // Configuration summary
  console.log('🚀 Claude-to-OpenAI API Proxy v1.0.0');
  console.log('✅ Configuration loaded successfully');
  console.log(`   OpenAI Base URL: ${config.openaiBaseUrl}`);
  console.log(`   Big Model (opus): ${config.bigModel}`);
  console.log(`   Middle Model (sonnet): ${config.middleModel}`);
  console.log(`   Small Model (haiku): ${config.smallModel}`);
  console.log(`   Max Tokens Limit: ${config.maxTokensLimit}`);
  console.log(`   Request Timeout: ${config.requestTimeout}s`);
  console.log(`   Server: ${config.host}:${config.port}`);
  console.log(`   Client API Key Validation: Disabled`);
  console.log('');

  // Start server
  serve({
    fetch: routes.fetch,
    port: config.port,
    hostname: config.host
  });

  console.log(`🌟 Server is running on http://${config.host}:${config.port}`);
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}