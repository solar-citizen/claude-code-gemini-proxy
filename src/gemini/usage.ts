/** Strict, shared subset of documented v1beta UsageMetadata.
 * https://aistudio.google.com/api-reference/generate-content#Resource:GenerateContentResponse
 * Optional protobuf defaults may be omitted. Unknown fields remain fail-closed.
 * Usage is reporting metadata, not an enforceable spending limit.
 */
const COUNTERS = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'toolUsePromptTokenCount'];
const DETAILS = ['promptTokensDetails', 'cacheTokensDetails', 'candidatesTokensDetails', 'toolUsePromptTokensDetails'];
const FIELDS = [...COUNTERS, ...DETAILS, 'serviceTier'];
const MODALITIES = ['MODALITY_UNSPECIFIED', 'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'];
const TIERS = ['unspecified', 'standard', 'flex', 'priority'];
type UsageRule = 'expected_object' | 'unknown_field' | 'nonnegative_safe_integer' | 'expected_array' | 'documented_modality' | 'documented_service_tier';
type JsonType = 'undefined' | 'null' | 'array' | 'object' | 'number' | 'string' | 'boolean' | 'other';
function jsonType(value: unknown): JsonType {
  if (value === null) { return 'null'; }
  if (Array.isArray(value)) { return 'array'; }
  const type = typeof value;
  return type === 'undefined' || type === 'object' || type === 'number' || type === 'string' || type === 'boolean' ? type : 'other';
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function inspectUsageMetadata(value: unknown) {
  // At most eleven fixed field names/types and six individually checked counts.
  // Never echo unknown names, strings, nested values or exception messages.
  const observation = {
    type: jsonType(value),
    fields: [] as {name: string; type: JsonType}[],
    token_counts: {} as Record<string, number>,
    unknown_fields: false,
    failure: null as {field: string; rule: UsageRule} | null,
  };
  const fail = (field: string, rule: UsageRule) => { observation.failure ??= {field, rule}; };
  if (value === undefined) { return {usage: null, observation}; }
  if (!record(value)) {
    fail('usageMetadata', 'expected_object');
    return {usage: null, observation};
  }
  for (const name of COUNTERS) {
    if (!Object.hasOwn(value, name)) { continue; }
    const item = value[name];
    observation.fields.push({name, type: jsonType(item)});
    if (!counter(item)) {
      fail(name, 'nonnegative_safe_integer');
    } else {
      observation.token_counts[name] = item;
    }
  }
  for (const name of DETAILS) {
    if (!Object.hasOwn(value, name)) { continue; }
    const items = value[name];
    observation.fields.push({name, type: jsonType(items)});
    if (!Array.isArray(items)) {
      fail(name, 'expected_array');
      continue;
    }
    for (let index = 0; index < items.length; index++) {
      const item: unknown = items[index];
      const field = `${name}[${index}]`;
      if (!record(item)) {
        fail(field, 'expected_object');
        continue;
      }
      if (Object.keys(item).some(key => !['modality', 'tokenCount'].includes(key))) {
        fail(field, 'unknown_field');
      }
      if (Object.hasOwn(item, 'modality') && (typeof item.modality !== 'string' || !MODALITIES.includes(item.modality))) {
        fail(field + '.modality', 'documented_modality');
      }
      if (Object.hasOwn(item, 'tokenCount') && !counter(item.tokenCount)) {
        fail(field + '.tokenCount', 'nonnegative_safe_integer');
      }
    }
  }
  if (Object.hasOwn(value, 'serviceTier')) {
    observation.fields.push({name: 'serviceTier', type: jsonType(value.serviceTier)});
    if (typeof value.serviceTier !== 'string' || !TIERS.includes(value.serviceTier)) {
      fail('serviceTier', 'documented_service_tier');
    }
  }
  observation.unknown_fields = Object.keys(value).some(name => !FIELDS.includes(name));
  if (observation.unknown_fields) { fail('usageMetadata', 'unknown_field'); }
  // Do not assert total = prompt + candidates: thinking/tool-use tokens contribute
  // too, cache is included in prompt, and optional counters may be absent.
  return {usage: observation.failure ? null : value, observation};
}
