export const eyeParameterIds = ['key5', 'key3', 'key4', 'key6'] as const;

/** These parameters select replacement drawings. Partial opacity shows both eyes. */
export function normalizeEyeParameters(values: number[], indices: ReadonlyMap<string, number>, post: Record<string, number> = {}) {
  let selected: string | undefined, strongest = .5;
  for (const id of eyeParameterIds) {
    const index = indices.get(id);
    if (index === undefined) continue;
    const value = post[id] ?? values[index];
    if (value >= strongest && (selected === undefined || value > strongest)) {
      selected = id; strongest = value;
    }
  }
  for (const id of eyeParameterIds) {
    const index = indices.get(id);
    if (index === undefined) continue;
    values[index] = id === selected ? 1 : 0;
    if (Object.hasOwn(post, id)) post[id] = values[index];
  }
}
