export function recordAudit(db, {
  actorUserId = null,
  actorRole = null,
  action,
  entityType,
  entityId = null,
  metadata = null,
  ipAddress = null
}) {
  db.execute(
    `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress
    ]
  );
}
