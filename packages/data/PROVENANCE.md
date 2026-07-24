# Data provenance

## `generated/passive-tree.json`

Built by `scripts/build-tree.mjs` from `data/psg_passive_nodes.json` in
[Demonad112/poe2-mcp](https://github.com/Demonad112/poe2-mcp) (2.06 MB, 4,975
nodes). Regenerate with:

```bash
node packages/data/scripts/build-tree.mjs /path/to/poe2-mcp/data/psg_passive_nodes.json
```

| | |
|---|---|
| Tree | `PassiveTree-0.5` |
| Nodes | 4,975 |
| Edges | 5,887 undirected |
| Notables / keystones / jewel sockets | 968 / 30 / 12 |
| Ascendancy nodes | 353 across 19 classes |
| Size | 602 KB raw · 147 KB gzipped |

The web build copies this to `apps/web/public/passive-tree.json`
(`prebuild` → `sync-data`); that copy is generated and gitignored.

### What the build script corrects

Three properties of the source would produce wrong output if used as-is. All
three were verified against the data, not assumed.

**Connections are stored directed.** Of 5,888 stored entries exactly one is
reciprocated. Rendering straight from the field draws each link once with an
arbitrary owner — survivable — but any graph walk (path finding, connectivity)
silently gets a one-way tree. The artifact carries a de-duplicated *undirected*
edge list.

**One self-loop exists.** Node 35653 ("Grenade Damage") connects to itself. It
draws nothing and makes edge counts disagree with themselves, so it is dropped —
leaving 5,887 real edges from 5,888 entries.

**`is_ascendancy` does not mean "is an ascendancy passive".** It is set on 17
nodes, which are the ascendancy *class* nodes ("Deadeye", "Titan", …) — not the
353 passives on the wheels. Structural detection fails too: the whole graph is a
single connected component, so the wheels cannot be separated by walking it. The
reliable signal is the icon path, whose subfolder names the ascendancy
(`passives/DeadEye/…`). That is what the script uses.

### Coordinate space and framing

Full extent spans x −22597…21814, y −18721…20054, but the ascendancy wheels are
small clusters at the periphery (Deadeye sits near x 15000, y 5000). The artifact
therefore also carries `mainExtent`, excluding them, and the renderer frames
against the character's *allocated* nodes rather than either — the full extent is
mostly empty space and other classes' wheels.

### Class start nodes

`47175` Warrior · `50459` Ranger · `54447` Sorceress · `50986` Mercenary ·
`61525` Druid · `44683` Monk. Their `name` fields carry PoE1 legacy labels
(`MARAUDER`, `RANGER`, `WITCH`, …), so the display names above come from the
build script, not the data.

## Licensing

Passive tree data derives from Path of Exile 2, © Grinding Gear Games. It is
included here for interoperability in an unofficial fan tool. See the repository
`LICENSE`.
