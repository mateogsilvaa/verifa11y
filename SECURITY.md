# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue. Use GitHub's private reporting:
[Report a vulnerability](https://github.com/mateogsilvaa/verifa11y/security/advisories/new).

Include the version, the command or tool call you used, and the smallest HTML file that shows the problem. You will get
a first reply within a week. Fixes for confirmed issues ship in a patch release, and the advisory credits you unless you
prefer otherwise.

## Supported versions

Only the latest release gets fixes.

| Version | Supported |
|---|---|
| 0.4.x | Yes |
| Older | No |

## What counts

These are the issues this project treats as security problems, in order of how much they matter:

1. **The verifier accepts a patch it should reject.** The whole project rests on "verified" meaning something. A patch
   that hides, deletes or silences a violation and still comes out `verified` is a vulnerability, and so is a way to make
   the verifier report a result it did not compute.
2. **A file or network boundary is crossed.**
   - The MCP server reads or writes outside `--root`, follows a symlink out of it, or writes outside its per-run
     output directory.
   - The audited page escapes its sandbox: scripts run in file mode, or a request leaves for an origin that is not
     allowed in site mode.
3. **Untrusted input runs code.** A crafted HTML file, patch JSON, finding or report makes verifa11y execute a command
   or load code it was not told to.

These are not vulnerabilities:

- `--generator-cmd` and `VERIFA11Y_GENERATOR_CMD` run the command you give them. That is the feature. Only configure
  commands you trust, and remember they receive the page source.
- A wrong or poor patch from a model or agent that the verifier correctly marks as rejected or suspicious.
- Findings that need a person to judge. verifa11y says so in every result.

For running verifa11y on pages you do not trust, use the container described in [docs/sandbox.md](docs/sandbox.md).
