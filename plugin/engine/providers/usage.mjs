/** Persist billing counters only; never copy arbitrary upstream response objects. */
export function safeUsage(value, counters) {
  if (!value || typeof value !== 'object') return undefined;
  const pick = (source, names) => Object.fromEntries(names
    .filter(name => Number.isSafeInteger(source?.[name]) && source[name] >= 0)
    .map(name => [name, source[name]]));
  const usage = pick(value, counters);
  for (const [name, keys] of [
    ['input_tokens_details', ['image_tokens', 'text_tokens']],
    ['output_tokens_details', ['image_tokens', 'text_tokens']],
    ['tool_usage', ['web_search']],
  ]) {
    const detail = pick(value[name], keys);
    if (Object.keys(detail).length) usage[name] = detail;
  }
  return Object.keys(usage).length ? usage : undefined;
}
