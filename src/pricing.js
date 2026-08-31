// src/pricing.js
// Calculo de costo estimado por pregunta, en USD por millon de tokens.
// Los precios vienen de wrangler.jsonc (vars), no son secretos.

export function getPricingConfig(env) {
  return {
    inputPerMTok: parseFloat(env.PRICE_INPUT_PER_MTOK || '2'),
    outputPerMTok: parseFloat(env.PRICE_OUTPUT_PER_MTOK || '10'),
    cacheWritePerMTok: parseFloat(env.PRICE_CACHE_WRITE_PER_MTOK || '2.5'),
    cacheReadPerMTok: parseFloat(env.PRICE_CACHE_READ_PER_MTOK || '0.20'),
  };
}

/**
 * @param {{input_tokens:number, output_tokens:number, cache_creation_input_tokens:number, cache_read_input_tokens:number}} usage
 * @param {Object} env
 * @returns {number} costo estimado en USD
 */
export function estimateCostUsd(usage, env) {
  const pricing = getPricingConfig(env);

  const cost =
    (usage.input_tokens / 1_000_000) * pricing.inputPerMTok +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMTok +
    (usage.cache_creation_input_tokens / 1_000_000) * pricing.cacheWritePerMTok +
    (usage.cache_read_input_tokens / 1_000_000) * pricing.cacheReadPerMTok;

  return Math.round(cost * 1_000_000) / 1_000_000;
}
