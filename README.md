# Blackwell Industry Map Prototype

This is the first usable local product slice for the V2 docs.

The app can still run as a static prototype, but it now prefers the FastAPI backend when `/api/graph` is available. In backend mode, review actions and manual evidence are persisted to SQLite.

## Run

From the project root, install the backend dependencies once:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Run the persisted app:

```sh
npm run app
```

Open:

```text
http://127.0.0.1:5173/
```

For the static fallback only:

```sh
npm run serve
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
- Source ingest: paste a title and source text to create candidate evidence for mentioned graph relations.
- Review persistence through FastAPI + SQLite when the backend is running.
- Static fallback persistence in local storage when the backend is unavailable.
- Candidate relations hidden from the default map but visible as badges, card updates, and the candidate drawer.
- Search across nodes, properties, relations, and evidence summaries.
- Manual market refresh placeholder stored on company node properties.

## Current Boundary

This prototype does not yet include real AI extraction or URL fetching. Source ingest currently uses conservative local matching against known graph nodes and relations.
