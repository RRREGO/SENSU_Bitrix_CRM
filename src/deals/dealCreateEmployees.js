export function normalizeUserSearchResult(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.users)) return raw.users;
  if (raw && (raw.ID || raw.id)) return [raw];
  return [];
}

export function formatUserOption(user) {
  const id = Number(user.ID ?? user.id);
  const name = [user.NAME ?? user.name, user.LAST_NAME ?? user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const position = user.WORK_POSITION ?? user.workPosition ?? "";
  const department =
    user.UF_DEPARTMENT?.[0] != null
      ? String(user.UF_DEPARTMENT[0])
      : user.DEPARTMENT ?? user.department ?? "";
  return {
    id,
    name: name || `ID ${id}`,
    position: position || null,
    department: department || null,
    display: [name, position, department ? `подр. ${department}` : null, `ID ${id}`]
      .filter(Boolean)
      .join(" · "),
  };
}

export function parseAssignedById(user) {
  const id = Number(user?.ID ?? user?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

/**
 * @returns {{ status: 'resolved', assignedById: number, user: object } | { status: 'ambiguous', candidates: object[] } | { status: 'not_found' }}
 */
export function resolveAssigneeFromUsers(users) {
  const list = normalizeUserSearchResult(users);
  if (!list.length) return { status: "not_found" };
  if (list.length === 1) {
    const assignedById = parseAssignedById(list[0]);
    if (!assignedById) return { status: "not_found" };
    return { status: "resolved", assignedById, user: list[0] };
  }
  return {
    status: "ambiguous",
    candidates: list.map(formatUserOption),
  };
}
