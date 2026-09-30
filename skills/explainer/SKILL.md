---
name: explainer
description: Explain a large body of information (experiment or research results, a codebase, a dataset, documentation, domain knowledge) to people as a page they can follow, rebuilt from first principles, with figures and text working together and interaction where exploring teaches more than reading. Use when asked to explain, visualize, present or walk through such material, or to make an overview, report page or artifact of it for a team, reviewers or newcomers. Also use when revising such a page after reader feedback.
---

# Explainer

You are turning more material than a person can read into a page that answers what they actually want to know. You already know how to design and build good pages. This skill covers what goes on the page and in what order; the look, layout, type and technology are your call.

## First principles

1. **Start from the reader.** Settle who reads the page, what they already know, and the one question they bring. Judge every part of the page by whether it helps that reader.
2. **Answer first.** Open with the answer and the few numbers or facts that carry it. Then give what the reader needs to understand the answer, then the evidence, then the limits. A reader who stops after the first screen should still leave with the right conclusion.
3. **Rebuild, don't transcribe.** Ask: if I were explaining this from scratch to this reader, what would come first? Organise around the reader's questions, in the order they would ask them, so each answer raises the next. The source's files, runs and chapters are not the outline. Keep general background (what anyone needs to follow the subject) apart from this project's specifics. Give room to what mattered, and compress dead ends to a line.
4. **Show what has shape; say what has reasons.** Put structure, flow, comparisons and quantities in figures. Put definitions, reasoning and caveats in text. The figure gives the overview and the text fills in details; neither repeats the other. Each figure makes one point, names it in the caption, and carries its own numbers.
5. **Interact where acting teaches.** Add a control when the reader learns by doing: changing a parameter, stepping through a process, switching between cases, drilling from summary to detail. The page is complete without touching anything. Controls start at the real case and say what changed.
6. **Make every claim traceable.** Every number comes from a source you can name, with its conditions. Mark what is measured, what you derived, what is illustrative and what is inferred. Use the newest result, and say when one result supersedes or contradicts another. Summarise large data rather than pasting it in.
7. **Use plain names.** Call things what they are ("fine-tuned drafter", "15-node tree"), not code names or run IDs. Keep one mapping line for readers who go to the source. Define each term where it first appears.
8. **Fit the reader.** Write in the reader's language. Size the page to the question: a small question gets a short page.

## Before handing over

Look at the rendered page the way the reader will see it. Fix what you see: clipped or overlapping labels, figures that disagree with the text, numbers that don't match the sources, dead controls, script errors. Two helpers are here if useful:

- `scripts/check_page.py page.html` catches unclosed tags, duplicate ids, script syntax errors and stray U+FFFD.
- `scripts/render_page.py page.html --out shots/` takes headless-Chrome screenshots.

Then tell the user where the page is, what it covers, and what should not be read as measured fact.

For a claude.ai artifact, read [references/artifacts.md](references/artifacts.md) first. It lists behaviour of the host that you cannot see from inside the page.

## After feedback

Fix the class, not just the instance: if one figure's numbers were off, check every figure; if one term went unexplained, check every term.
