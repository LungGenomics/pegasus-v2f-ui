// Activity feed: a derived "recent changes" list built from the created_by /
// last_edited_by / created_at / updated_at columns on the editable config
// entities (sources, mappings, traits) + the pegasus_settings singleton. One
// row per create, plus one per edit when the entity has been edited since
// creation. Rendered commit-history style. There is no separate event-log
// table — this is the single source of provenance.

import { getDataSource } from "../select";

export interface ChangeEntry {
  ts: string;
  actor: string | null;
  entity_type: "source" | "mapping" | "trait" | "settings";
  label: string;
  op: "created" | "edited";
}

export async function recentChanges(limit = 100): Promise<ChangeEntry[]> {
  const ds = getDataSource();
  // created + edited rows per entity, unioned across the three tables. An
  // "edited" row only when updated_at is meaningfully after created_at.
  const sql = `
    WITH events AS (
      SELECT created_at AS ts, created_by AS actor, 'source' AS entity_type,
             name AS label, 'created' AS op FROM config.sources
      UNION ALL
      SELECT updated_at, last_edited_by, 'source', name, 'edited'
      FROM config.sources WHERE updated_at > created_at

      UNION ALL
      SELECT created_at, created_by, 'mapping',
             COALESCE(display_name, source_tag), 'created' FROM config.mappings
      UNION ALL
      SELECT updated_at, last_edited_by, 'mapping',
             COALESCE(display_name, source_tag), 'edited'
      FROM config.mappings WHERE updated_at > created_at

      UNION ALL
      SELECT created_at, created_by, 'trait', label, 'created' FROM config.traits
      UNION ALL
      SELECT updated_at, last_edited_by, 'trait', label, 'edited'
      FROM config.traits WHERE updated_at > created_at

      UNION ALL
      -- Settings is a singleton: only an "edited" event, recorded once it's
      -- been changed (last_edited_by set; NULL on the seeded row).
      SELECT updated_at, last_edited_by, 'settings', 'Pegasus settings', 'edited'
      FROM config.pegasus_settings WHERE last_edited_by IS NOT NULL
    )
    SELECT ts, actor, entity_type, label, op
    FROM events WHERE ts IS NOT NULL
    ORDER BY ts DESC LIMIT ?`;
  return ds.query<ChangeEntry>({ sql, params: [limit] });
}
