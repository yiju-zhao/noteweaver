# Third-party notices

Noteweaver bundles [yaml](https://github.com/eemeli/yaml), licensed under ISC:

```text
Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

The generic research workflow retains its upstream MIT attribution in `skills/noteweaver-research/LICENSE` (adapted from NousResearch/Hermes skill methods).

## Bundled skills

| Skill | Source | License / attribution |
| --- | --- | --- |
| noteweaver-arxiv | NousResearch/hermes-agent e408d363393ccb72267e67bcccf4f8954b438cd9 | MIT; skills/noteweaver-arxiv/LICENSE |
| agent-browser | vercel-labs/agent-browser wrapper d01253d9db28d75080e36da3c1c31ef89454731e; CLI 0.38.1 | Apache-2.0; skills/agent-browser/LICENSE |
| obsidian-bases | kepano/obsidian-skills 3ccff5338ea700537839b21900aa5358a0402c98 | MIT; skills/obsidian-bases/LICENSE |
| archify | tt-a1i/archify v2.16.0 | MIT; skills/archify/LICENSE; runtime archive SHA-256 pinned in scripts/package_runtime.mjs |
| explainer | yiju-zhao/agent-skills 2a02e94 | Written by the Noteweaver owner; covered by this repository's MIT license; skills/explainer/UPSTREAM.md |

Runtime dependencies keep their own notices. No browser profile, authentication state or knowledge-bank content is bundled.
