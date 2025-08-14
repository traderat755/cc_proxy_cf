import { config } from './config.js';

export class ModelManager {
  getOpenAIModel(claudeModel: string): string {
    const model = claudeModel.toLowerCase();
    
    // Haiku models -> small model
    if (model.includes('haiku')) {
      return config.smallModel;
    }
    
    // Opus models -> big model
    if (model.includes('opus')) {
      return config.bigModel;
    }
    
    // Sonnet models -> middle model
    if (model.includes('sonnet')) {
      return config.middleModel;
    }
    
    // Default to big model for unknown models
    return config.bigModel;
  }
  
  isValidClaudeModel(model: string): boolean {
    const validModels = [
      'claude-3-haiku',
      'claude-3-sonnet', 
      'claude-3-opus',
      'claude-3-5-haiku',
      'claude-3-5-sonnet',
      'claude-3-5-opus'
    ];
    
    return validModels.some(validModel => model.toLowerCase().includes(validModel));
  }
}

export const modelManager = new ModelManager();