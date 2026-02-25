/**
 * Configuración de proveedores LLM
 */

export const LLM_PROVIDERS = {
  GOOGLE_GEMINI: 'google_gemini',
  GOOGLE_VERTEX: 'google_vertex',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  AZURE_OPENAI: 'azure_openai'
};

export const LLM_CONFIG = {
  [LLM_PROVIDERS.GOOGLE_GEMINI]: {
    name: 'Google Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: {
      default: 'gemini-pro',
      latest: 'gemini-1.5-pro',
      fast: 'gemini-pro'
    },
    requiresApiKey: true,
    envKey: 'GOOGLE_GEMINI_API_KEY'
  },
  [LLM_PROVIDERS.GOOGLE_VERTEX]: {
    name: 'Google Vertex AI',
    apiUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
    models: {
      default: 'gemini-pro',
      latest: 'gemini-1.5-pro'
    },
    requiresApiKey: false,
    requiresAuth: true,
    envKey: 'GOOGLE_APPLICATION_CREDENTIALS'
  },
  [LLM_PROVIDERS.OPENAI]: {
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    models: {
      default: 'gpt-4',
      latest: 'gpt-4-turbo-preview',
      fast: 'gpt-3.5-turbo'
    },
    requiresApiKey: true,
    envKey: 'OPENAI_API_KEY'
  },
  [LLM_PROVIDERS.ANTHROPIC]: {
    name: 'Anthropic Claude',
    apiUrl: 'https://api.anthropic.com/v1',
    models: {
      default: 'claude-3-opus-20240229',
      latest: 'claude-3-5-sonnet-20241022',
      fast: 'claude-3-haiku-20240307'
    },
    requiresApiKey: true,
    envKey: 'ANTHROPIC_API_KEY'
  },
  [LLM_PROVIDERS.AZURE_OPENAI]: {
    name: 'Azure OpenAI',
    apiUrl: null, // Se configura por endpoint
    models: {
      default: 'gpt-4',
      latest: 'gpt-4-turbo'
    },
    requiresApiKey: true,
    envKey: 'AZURE_OPENAI_API_KEY',
    requiresEndpoint: true,
    envEndpoint: 'AZURE_OPENAI_ENDPOINT'
  }
};

/**
 * Obtiene el proveedor por defecto desde variables de entorno
 */
export const getDefaultProvider = () => {
  return import.meta.env.VITE_LLM_PROVIDER || LLM_PROVIDERS.GOOGLE_GEMINI;
};

/**
 * Verifica si un proveedor está disponible (tiene API key)
 */
export const isProviderAvailable = (provider) => {
  const config = LLM_CONFIG[provider];
  if (!config) return false;
  
  if (config.requiresApiKey) {
    // En el frontend, verificamos si hay endpoint configurado
    // La verificación real se hace en el backend
    return true;
  }
  
  return true;
};

/**
 * Obtiene lista de proveedores disponibles
 */
export const getAvailableProviders = () => {
  return Object.values(LLM_PROVIDERS).filter(provider => 
    isProviderAvailable(provider)
  );
};
