# @poe2/mcp

MCP server exposing the Path of Exile 2 build analyser over stdio.

Every tool is a thin adapter over `@poe2/core`. The server contains no analysis
logic of its own — it and the web app return the same numbers because they read
the same module, not because two implementations are kept in step.

See [TOOLS.md](./TOOLS.md) for the tool reference. **That file is generated from
the registry** (`npm run tools -w @poe2/mcp`). V1 shipped four different tool
counts across its README, architecture doc, changelog and a docstring; the only
reliable fix is to not write the list by hand.

## Setup

```bash
npm install
npm run build -w @poe2/mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

- macOS `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "poe2": {
      "command": "node",
      "args": ["/absolute/path/to/POE2-MCP-V2/apps/mcp/dist/index.js"]
    }
  }
}
```

Use an absolute path, and restart Claude Desktop afterwards. Verify with
`poe2_health_check`, which reports the tool count, whether the passive tree data
loaded, and — with `checkNetwork: true` — whether poe.ninja is reachable.

## Typical session

```
poe2_load_character  url: https://poe.ninja/poe2/profile/Demonad112-2589/runesofaldur/character/Athrynas
poe2_get_recommendations
poe2_find_stat_sources  stat: armour
poe2_find_path_to_node  nodeId: 12345
```

`poe2_load_character` sets the active character; every other tool reads it. The
payload is ~400 KB and the fetch involves an SSE version hop, so it is loaded
once rather than per call. Tools called before it fail with a message naming the
tool to call, rather than returning empty results.

It also accepts a raw payload via `json`, which needs no network at all.

## Design notes

**No CORS proxy here.** The server talks to poe.ninja directly, which the
browser cannot do — poe.ninja sends no `Access-Control-Allow-Origin` header and
rejects preflight. That is why `services/ninja-proxy` exists for the web app and
is irrelevant to this server.

**stdout is the protocol channel.** Nothing may write to it except MCP messages;
a stray `console.log` corrupts the stream. Diagnostics go to stderr, and
`scripts/verify-mcp.mjs` fails the build if anything non-JSON appears on stdout.

**Errors are returned, not thrown.** A tool that fails returns `isError` with a
readable message, so the model can correct itself rather than seeing an opaque
protocol failure. Messages name the fix: an unknown stat lists the available
stats, an unknown skill lists the character's skills.

**Every tool is read-only.** Nothing here mutates a character, a file or a
remote resource.

## What the tools will not tell you

- **Support gem legality beyond category conflicts.** The game's stated rule —
  no two supports of the same category in one skill — is checked, along with
  supports whose tags share nothing with the skill. Nothing else is claimed,
  because nothing else is derivable: the extracted gem databases carry no usable
  constraints, and inventing rules is exactly the failure this project avoids.
- **Ladder comparison.** Cut deliberately. poe.ninja's builds API ignores
  per-skill sort keys and filter parameters, and reports DPS only as a lossy
  display string.
- **What-if simulation.** The Path of Building bridge is not built yet.
  `poe2_import_pob` reads a build's own computed stats, which is a second
  opinion, not a simulation.

## Verifying

```bash
node scripts/verify-mcp.mjs
```

Spawns the real binary, completes the initialize handshake, lists tools, and
calls a representative set against the committed character — asserting the
values that come back are the real ones (lowest max hit 3,808 chaos; Ice Shot
109,859; armour 207 from Golem Tether; 3 allocation groups; a duplicate support
category correctly rejected). Runs in CI.
