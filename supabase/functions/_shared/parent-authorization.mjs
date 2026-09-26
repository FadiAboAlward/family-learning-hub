export function canManageLearningRole(role) {
  return role === "owner" || role === "admin" || role === "teacher";
}
