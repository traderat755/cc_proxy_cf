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

  constructor() {
    this._config = {
      openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      azureApiVersion: process.env.AZURE_API_VERSION,
      host: process.env.HOST || '0.0.0.0',
      port: parseInt(process.env.PORT || '8082'),
      logLevel: process.env.LOG_LEVEL || 'INFO',
      maxTokensLimit: parseInt(process.env.MAX_TOKENS_LIMIT || '4096'),
      minTokensLimit: parseInt(process.env.MIN_TOKENS_LIMIT || '100'),
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '90'),
      maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
      bigModel: process.env.BIG_MODEL || 'gpt-oss-120b',
      middleModel: process.env.MIDDLE_MODEL || process.env.BIG_MODEL || 'gpt-oss-120b',
      smallModel: process.env.SMALL_MODEL || 'gpt-oss-120b-mini'
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

export const config = new ConfigManager().config;
export const configManager = new ConfigManager();