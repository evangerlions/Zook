/** Atomic KV changes keep token rotation and session indexes in one commit. */
export interface KVAtomicChange {
  compare?: { key: string; value: string | null }[];
  set: { key: string; value: string; ttlSeconds?: number }[];
  append?: { key: string; value: string }[];
}

export const atomicChangeScript = `
local change = cjson.decode(ARGV[1])
for _, item in ipairs(change.compare or {}) do
  local current = redis.call('GET', item.key)
  if item.value == cjson.null then
    if current then return 0 end
  elseif current ~= item.value then return 0 end
end
local arrays = {}
for _, item in ipairs(change.append or {}) do
  local current = arrays[item.key]
  if not current then
    local raw = redis.call('GET', item.key)
    current = raw and cjson.decode(raw) or {}
  end
  local found = false
  for _, value in ipairs(current) do if value == item.value then found = true end end
  if not found then table.insert(current, item.value) end
  arrays[item.key] = current
end
for _, item in ipairs(change.set) do
  if item.ttlSeconds then redis.call('SET', item.key, item.value, 'EX', item.ttlSeconds)
  else redis.call('SET', item.key, item.value) end
end
for key, values in pairs(arrays) do redis.call('SET', key, cjson.encode(values)) end
return 1
`;
