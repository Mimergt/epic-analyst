// src/pricing.js
// Calculo de costo estimado por pregunta, en USD por millon de tokens.
// Los precios vienen de wrangler.jsonc (vars), no son secretos. Cada
// proveedor tiene su propio set de precios (prefijo PRICE_<PROVEEDOR>_...),
// con Anthropic (PRICE_..., sin prefijo) como el original/default por
// compatibilidad con lo que ya existia antes del multi-proveedor.

const PROVIDER_PRICE_PREFIX = {
  anthropic: '',
  openai: 'OPENAI_',
};

export function getPricingConfig(env, provider = 'anthropic') {
  const prefix = PROVIDER_PRICE_PREFIX[provider] ?? '';
  const get = (name, fallback) => parseFloat(env[`PRICE_${prefix}${name}`] ?? fallback);

  return {
    inputPerMTok: get('INPUT_PER_MTOK', '2'),
    outputPerMTok: get('OUTPUT_PER_MTOK', '10'),
    cacheWritePerMTok: get('CACHE_WRITE_PER_MTOK', '2.5'),
    cacheReadPerMTok: get('CACHE_READ_PER_MTOK', '0.20'),
  };
}

/**
 * @param {{input_tokens:number, output_tokens:number, cache_creation_input_tokens:number, cache_read_input_tokens:number}} usage
 * @param {Object} env
 * @param {string} provider - 'anthropic' | 'openai' (default 'anthropic')
 * @returns {number} costo estimado en USD
 */
export function estimateCostUsd(usage, env, provider = 'anthropic') {
  const pricing = getPricingConfig(env, provider);

  const cost =
    (usage.input_tokens / 1_000_000) * pricing.inputPerMTok +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMTok +
    (usage.cache_creation_input_tokens / 1_000_000) * pricing.cacheWritePerMTok +
    (usage.cache_read_input_tokens / 1_000_000) * pricing.cacheReadPerMTok;

  return Math.round(cost * 1_000_000) / 1_000_000;
}
