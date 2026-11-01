/** عبارة إدراج في سجل التدقيق (تُنفَّذ مع التعديل نفسه داخل db.batch). */
export function auditStmt(db, user, action, entity, entityId, detail) {
  return db
    .prepare('INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(user?.email || 'system', action, entity ?? null, entityId == null ? null : String(entityId), detail == null ? null : JSON.stringify(detail).slice(0, 2000));
}
