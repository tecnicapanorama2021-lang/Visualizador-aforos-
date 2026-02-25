import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// Configuración de proveedores LLM
const LLM_PROVIDERS = {
  GOOGLE_GEMINI: 'google_gemini',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic'
};

/**
 * GET /api/pmt/providers
 * Retorna lista de proveedores LLM disponibles
 */
router.get('/providers', (req, res) => {
  const providers = [];
  
  if (process.env.GOOGLE_GEMINI_API_KEY) {
    providers.push(LLM_PROVIDERS.GOOGLE_GEMINI);
  }
  
  if (process.env.OPENAI_API_KEY) {
    providers.push(LLM_PROVIDERS.OPENAI);
  }
  
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(LLM_PROVIDERS.ANTHROPIC);
  }
  
  res.json({ providers });
});

/**
 * POST /api/pmt/generate
 * Genera PMT usando LLM
 */
router.post('/generate', async (req, res) => {
  try {
    const { contexto, tipoObra, provider = LLM_PROVIDERS.GOOGLE_GEMINI } = req.body;
    
    if (!contexto) {
      return res.status(400).json({ error: 'Contexto de intersección requerido' });
    }
    
    if (!tipoObra) {
      return res.status(400).json({ error: 'Tipo de obra requerido' });
    }

    let response;
    
    switch (provider) {
      case LLM_PROVIDERS.GOOGLE_GEMINI:
        response = await generateWithGemini(contexto, tipoObra);
        break;
      case LLM_PROVIDERS.OPENAI:
        response = await generateWithOpenAI(contexto, tipoObra);
        break;
      case LLM_PROVIDERS.ANTHROPIC:
        response = await generateWithAnthropic(contexto, tipoObra);
        break;
      default:
        return res.status(400).json({ error: `Proveedor no soportado: ${provider}` });
    }
    
    res.json({
      response,
      provider,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generando PMT:', error);
    res.status(500).json({ 
      error: 'Error al generar PMT',
      message: error.message 
    });
  }
});

/**
 * Genera PMT usando Google Gemini
 */
async function generateWithGemini(contexto, tipoObra) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY no configurada');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  const prompt = formatPromptForGemini(contexto, tipoObra);
  
  const result = await model.generateContent(prompt);
  const response = await result.response;
  
  return response.text();
}

/**
 * Genera PMT usando OpenAI (preparado para futuro)
 */
async function generateWithOpenAI(contexto, tipoObra) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada');
  }

  // Implementación futura
  throw new Error('OpenAI aún no implementado');
}

/**
 * Genera PMT usando Anthropic Claude (preparado para futuro)
 */
async function generateWithAnthropic(contexto, tipoObra) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }

  // Implementación futura
  throw new Error('Anthropic aún no implementado');
}

/**
 * Formatea el prompt para Gemini
 */
function formatPromptForGemini(contexto, tipoObra) {
  return `
Eres un experto en Planes de Manejo de Tránsito (PMT) en Bogotá, Colombia, siguiendo las normativas de la Secretaría de Movilidad.

CONTEXTO DE LA INTERSECCIÓN:
- Ubicación: ${contexto.centro.lat.toFixed(6)}, ${contexto.centro.lng.toFixed(6)}
- Número de intersecciones detectadas: ${contexto.numeroIntersecciones}
- Número de vías en el área: ${contexto.numeroVias}
- Complejidad: ${contexto.complejidad}
- Tipos de vía: ${contexto.tiposVia.join(', ')}
- Sentidos detectados: ${contexto.sentidos.join(', ')}
- Carriles: promedio ${contexto.carriles.promedio}, máximo ${contexto.carriles.maximo}
- Velocidades: mínima ${contexto.velocidades.minima || 'N/A'} km/h, máxima ${contexto.velocidades.maxima || 'N/A'} km/h
- Tiene doble sentido: ${contexto.hayDobleSentido ? 'Sí' : 'No'}
- Vías principales: ${contexto.viasPrincipales}

TIPO DE OBRA: ${tipoObra}

DETALLE DE VÍAS:
${contexto.viasCercanas.map((via, idx) => `
${idx + 1}. ${via.nombre} (${via.tipo})
   - Sentido: ${via.sentido}
   - Carriles: ${via.numeroCarriles}
   - Velocidad: ${via.velocidadReglamentaria} km/h
`).join('')}

INSTRUCCIONES:
Genera un PMT profesional con las siguientes secciones:

1. SEÑALES REGLAMENTARIAS (SR):
   - Especifica códigos (SR-30, SR-40, SR-50, SR-PARE, SR-CEDA)
   - Ubicación exacta de cada señal
   - Distancias recomendadas

2. SEÑALES PREVENTIVAS (SP):
   - Especifica códigos (SP-01, SP-02, SP-03, SP-04)
   - Advertencias necesarias
   - Ubicación estratégica

3. SEÑALES INFORMATIVAS (SI):
   - Rutas alternas si aplica
   - Información de distancias

4. RECOMENDACIONES ESPECÍFICAS:
   - Basadas en el tipo de obra: ${tipoObra}
   - Considerando la complejidad de la intersección
   - Siguiendo normativas de Bogotá

IMPORTANTE: Responde ÚNICAMENTE en formato JSON válido con esta estructura exacta:
{
  "señalesReglamentarias": [
    {
      "codigo": "SR-30",
      "nombre": "Límite de Velocidad 30 km/h",
      "ubicacion": "descripción detallada",
      "distancia": "50m antes",
      "razon": "justificación"
    }
  ],
  "señalesPreventivas": [
    {
      "codigo": "SP-01",
      "nombre": "Zona de Obras",
      "ubicacion": "descripción",
      "distancia": "50m antes",
      "razon": "justificación"
    }
  ],
  "señalesInformativas": [],
  "recomendaciones": "texto general con recomendaciones específicas",
  "observaciones": "notas adicionales importantes"
}

NO incluyas texto adicional fuera del JSON. Responde solo con el objeto JSON.
`;
}

export default router;
