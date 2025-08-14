export interface Config {
  openaiBaseUrl: string;
  azureApiVersion?: string;
  host: string;
  port: number;
  logLevel: string;
  maxTokensLimit: number;
  minTokensLimit: number;
  requestTimeout: number;
  maxRetries: number;
  bigModel: string;
  middleModel: string;
  smallModel: string;
}

class ConfigManager {
  private _config: Config;

  constructor(env?: any) {
    // For Cloudflare Workers, use the env parameter
    // For Node.js, use process.env
    const environment = env || (typeof process !== 'undefined' ? process.env : {});

    this._config = {
      openaiBaseUrl: environment.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      azureApiVersion: environment.AZURE_API_VERSION,
      host: environment.HOST || '0.0.0.0',
      port: parseInt(environment.PORT || '8082'),
      logLevel: environment.LOG_LEVEL || 'INFO',
      maxTokensLimit: parseInt(environment.MAX_TOKENS_LIMIT || '40960'),
      minTokensLimit: parseInt(environment.MIN_TOKENS_LIMIT || '100'),
      requestTimeout: parseInt(environment.REQUEST_TIMEOUT || '90'),
      maxRetries: parseInt(environment.MAX_RETRIES || '2'),
      bigModel: environment.BIG_MODEL || 'openai/gpt-oss-120b',
      middleModel: environment.MIDDLE_MODEL || environment.BIG_MODEL || 'openai/gpt-oss-120b',
      smallModel: environment.SMALL_MODEL || 'gpt-oss-20b'
    };
  }

  get config(): Config {
    return this._config;
  }

  validateApiKey(): boolean {
    // API key validation now happens at the client level
    return true;
  }

  validateClientApiKey(_clientApiKey: string): boolean {
    // Client API key validation is now handled in routes
    return true;
  }
}

// For Node.js environment
export const config = new ConfigManager().config;
export const configManager = new ConfigManager();

// For Cloudflare Workers environment
export function createConfigManager(env: any) {
  return new ConfigManager(env);
}