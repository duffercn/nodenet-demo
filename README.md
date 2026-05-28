# Blackwell Industry Map Prototype

This is the first usable local product slice for the V2 docs.

It is intentionally static and dependency-free so the map-first workflow can be tested before the backend and persistence layers are built.

## Run

From this directory:

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:5173/
```

## What Works

- Blackwell industry-chain map.
- Top command bar, left filters, right research card, and bottom current-view drawer.
- Focused auto-layout canvas: the graph renders the selected object and its useful one-hop/two-hop research context instead of dumping the whole seed graph.
- Two graph modes:
  - Focus mode uses larger information-card nodes and labeled relations for the current research context.
  - Global mode uses a force-style network layout with compact dot nodes and full graph connections, closer to an Obsidian-style graph overview.
- Type-aware node cards for products, technologies, companies, metrics, modules, and theme.
- Relation cards with status, confidence, evidence priority, and missing-evidence signaling.
- Manual relation evidence capture: add a source title, summary, and support level as candidate EvidenceLink.
- Actionable Evidence Inbox: candidate evidence can be opened, confirmed, or rejected from the drawer.
- Review persistence in local storage, including added references/evidence and confirmed/rejected/disputed relation states.
- Candidate relations hidden from the default map but visible as badges, card updates, and the candidate drawer.
- Search across nodes, properties, relations, and evidence summaries.
- Manual market refresh placeholder stored on company node properties.

## Current Boundary

This prototype does not yet include the FastAPI backend, SQLite persistence, or real AI extraction. The static data shape mirrors the V2 graph kernel so those pieces can replace the in-memory data without changing the product surface.
