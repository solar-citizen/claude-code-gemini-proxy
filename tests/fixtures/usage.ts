// Synthetic examples of the documented v1beta UsageMetadata contract.
export const completeUsage = {
  promptTokenCount: 10, candidatesTokenCount: 3, cachedContentTokenCount: 4,
  thoughtsTokenCount: 7, toolUsePromptTokenCount: 1, totalTokenCount: 21,
  promptTokensDetails: [{modality: 'TEXT', tokenCount: 6}, {modality: 'IMAGE', tokenCount: 4}],
  cacheTokensDetails: [{modality: 'IMAGE', tokenCount: 4}],
  candidatesTokensDetails: [{modality: 'TEXT', tokenCount: 3}],
  toolUsePromptTokensDetails: [{modality: 'TEXT', tokenCount: 1}],
  serviceTier: 'standard',
};
export const counterNames = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount', 'totalTokenCount', 'toolUsePromptTokenCount'];
export const detailNames = ['promptTokensDetails', 'cacheTokensDetails', 'candidatesTokensDetails', 'toolUsePromptTokensDetails'];
export const validUsageCases: [string, unknown][] = [
  ['complete documented metadata', completeUsage],
  ['omitted metadata', undefined], ['empty metadata', {}], ['total only', {totalTokenCount: 2}],
  ['zero counters', Object.fromEntries(counterNames.map(name => [name, 0]))],
  ['thinking accounting includes thoughts and tool prompts', {promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 7, toolUsePromptTokenCount: 1, totalTokenCount: 21}],
  ['cache is already part of prompt', {promptTokenCount: 10, cachedContentTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 13}],
  ...detailNames.flatMap((name): [string, unknown][] => [
    [name + ' only', {[name]: [{modality: 'TEXT', tokenCount: 0}]}],
    [name + ' omitted protobuf defaults', {[name]: [{}]}],
    [name + ' empty', {[name]: []}],
  ]),
  ...['unspecified', 'standard', 'flex', 'priority'].map((tier): [string, unknown] => ['tier ' + tier, {serviceTier: tier}]),
  ...['MODALITY_UNSPECIFIED', 'TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].map((modality): [string, unknown] => ['modality ' + modality, {promptTokensDetails: [{modality, tokenCount: 0}]}]),
];
// Last two columns are bounded diagnostics: no attacker-supplied names/values.
export const invalidUsageCases: [string, unknown, string, string][] = [
  ...[null, [], 1, 'private-canary', true].map((value): [string, unknown, string, string] => ['metadata ' + JSON.stringify(value), value, 'usageMetadata', 'expected_object']),
  ...counterNames.flatMap(name => [-1, 0.5, 'private-canary', true, null, Number.MAX_SAFE_INTEGER + 1].map((value): [string, unknown, string, string] => [name + ' ' + JSON.stringify(value), {[name]: value}, name, 'nonnegative_safe_integer'])),
  ['unknown field', {'private-canary': 'synthetic-test-key'}, 'usageMetadata', 'unknown_field'],
  ...detailNames.flatMap((name): [string, unknown, string, string][] => [
    [name + ' object', {[name]: {}}, name, 'expected_array'],
    [name + ' bad item', {[name]: [null]}, name + '[0]', 'expected_object'],
    [name + ' bad modality', {[name]: [{modality: 'private-canary'}]}, name + '[0].modality', 'documented_modality'],
    [name + ' bad count', {[name]: [{modality: 'TEXT', tokenCount: -1}]}, name + '[0].tokenCount', 'nonnegative_safe_integer'],
    [name + ' unsafe count', {[name]: [{tokenCount: Number.MAX_SAFE_INTEGER + 1}]}, name + '[0].tokenCount', 'nonnegative_safe_integer'],
    [name + ' extra field', {[name]: [{modality: 'TEXT', tokenCount: 0, 'private-canary': 'synthetic-test-key'}]}, name + '[0]', 'unknown_field'],
  ]),
  ...[null, 1, {}, 'private-canary'].map((value): [string, unknown, string, string] => ['service tier ' + JSON.stringify(value), {serviceTier: value}, 'serviceTier', 'documented_service_tier']),
];
