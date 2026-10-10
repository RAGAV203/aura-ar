# Local data schema

All data stays in the browser. Nothing is synchronised.

## IndexedDB — database `aura`, version 1

| Store | Key | Value |
| --- | --- | --- |
| `creations` | `id` (index `updatedAt`) | `Creation` (below), validated on every read and write |
| `media` | `id` (same as creation) | `{ id, thumbnail: Blob \| null (JPEG ≤480 px), snapshot: Blob \| null (PNG) }` |
| `drafts` | `"current"` | `{ id: "current", creation: Creation, snapshot: Blob \| null, savedAt: ISO }` — interrupted-session recovery, written every 15 s while there is unsaved work and on tab hide; offered for 7 days |

Structural upgrades live in `openDatabase()`'s `onupgradeneeded`, keyed by `oldVersion`.

### `Creation` (schema version 1)

```jsonc
{
  "schemaVersion": 1,
  "id": "3f2a…",                 // [A-Za-z0-9_-]{4,64}
  "name": "Aurora Study",         // control chars stripped, ≤ 80 chars
  "instrumentId": "aurora",       // aurora | inkflow | light-trails | particle-bloom | cosmic-garden
  "presetId": "polar-night",      // or null; must exist on the instrument
  "createdAt": "2026-10-10T10:00:00.000Z",
  "updatedAt": "2026-10-10T10:05:00.000Z",
  "parameters": { "hue": 165, "flow": 0.7, "spread": 0.45, "glow": 0.7 },  // unknown keys dropped, values clamped to the spec
  "gestureMappings": { "Move hand left / right": "Steers the ribbons" },   // descriptive, ≤ 16 entries
  "audioSettings": { "volume": 0.7, "muted": false },
  "seed": 12345,                  // non-negative int < 2^31
  "state": {}                     // instrument-specific, see below; ≤ 64 KB
}
```

Instrument state:

| Instrument | `state` |
| --- | --- |
| Cosmic Garden | `{ orbs: [{ x, y, z, hue, size }] }` — ≤ 48 orbs, coordinates clamped to ±10 |
| InkFlow | `{ hueOffset: number }` |
| Light Trails | `{ hueIndex: 0..4 }` |
| Aurora, Particle Bloom | `{}` |

## Migrations

`features/creations/schema.ts`:

- `CURRENT_SCHEMA_VERSION` is the version written.
- `MIGRATIONS[n]` upgrades a record from version `n` to `n + 1`; `migrateCreation()` chains them.
- Records from a **newer** version are rejected with a clear message (never silently downgraded).
- Version 1 is the first release, so the table is empty. To change the shape: add `MIGRATIONS[1]`, bump the constant, extend `validateCreation`, and add a unit test with a v1 fixture.

## Project file — `*.aura.json`

```jsonc
{
  "format": "aura-project",
  "formatVersion": 1,
  "exportedAt": "ISO timestamp",
  "creation": { /* Creation as above */ },
  "snapshot": "data:image/png;base64,…"   // or null
}
```

Import rules (`parseProjectFile`, `importCreationFile`):

- ≤ 8 MB, valid JSON, `format`/`formatVersion` must match.
- `creation` goes through the same migration + validation as stored data.
- `snapshot` must be a base64 PNG data URL and must decode as an image; otherwise it is dropped.
- Imports always get a new `id`, so they can never overwrite existing work.
- Nothing in a file is executed — there are no scripts or shaders in the format.

## Other storage

| Where | Key | Content |
| --- | --- | --- |
| localStorage | `aura.settings.v1` | Preferences (validated by `parseSettings`, debounced writes) |
| localStorage | `aura.library.layout` | Grid/list choice |
| Cache Storage | `aura-shell-<hash>` | App shell for this build |
| Cache Storage | `aura-runtime-v1` | Same-origin runtime files |
| Cache Storage | `aura-models-v1` | Optional tracking runtime and models |

Settings → *Clear all local data* deletes the database, every `aura-*` cache and localStorage.
