# claude.ai artifacts: what the page cannot tell you

The Artifact tool's own contract covers the content security policy, theming, fonts and size limits; follow it. This file adds what you only learn when a reader opens the page.

- **One page.** Links to other files do not open for the reader, even when those files were published alongside the page and appear in its file listing. Put everything in the page. To show several full pages (a comparison of versions, for example), embed each one and load it into an in-page `<iframe srcdoc>` when the reader clicks a button.
- **Summarise, don't inline.** Every byte of the page costs output tokens. Draw diagrams as SVG or HTML/CSS, not raster images, and embed aggregates, not raw datasets. This also keeps out data the source project may keep private: check for a publication policy before embedding per-item results.
- **Feedback paths.** Readers in the organisation can comment on a shared artifact, and Claude can read and answer those comments, which gives revisions a natural loop. For choices a reader makes on the page (ranking options, flagging unclear claims), a "Copy as prompt" button brings the result back into the session.
- **Beyond a static page.** File downloads, live data through connectors and shared state are runtime capabilities. Load the `artifact-capabilities` skill before relying on any of them.
- **Updates.** Republishing to the same URL makes a new version, and readers with the page open see it in place.
