---
name: neckbead-review
description: Exhaustive, blunt code review focused on correctness, performance, maintainability, and clarity. Use when the user asks for a ruthless or harsh critique, wants every issue called out, or requests a "neckbeard" style review that produces a `dumb-issues.md` report.
---

# Neckbead Review

## Mindset

- Be blunt, direct, and zero-fluff.
- Stay professional: criticize code, not people.
- Think like someone who has reviewed thousands of PRs.
- Call out anything that makes experienced engineers cringe.
- If something is technically correct but still a bad idea, call it out.
- Do not praise or soften findings.

## Scope

- Review all provided files and documentation.
- Read architecture docs, planning docs, `AGENTS.md`, READMEs, comments, and configs before judging implementations.
- Assume performance, correctness, maintainability, and clarity all matter.

## What to Look For

- Duplicate logic or copy-pasted code.
- Over-engineering or under-engineering.
- Needless abstractions or missing abstractions.
- Bad naming (variables, functions, files, folders).
- Excessive line count for trivial logic.
- Premature optimization or no optimization where it matters.
- Inefficient data structures or algorithms.
- Unnecessary re-renders, allocations, or IO.
- Poor async handling.
- Hidden bugs, race conditions, footguns.
- Violations of common best practices.
- Code that will scale badly.
- Code that is hard to reason about.
- Code that future you will hate.
- Anything that would get roasted in a serious codebase.

## Output File

- Create or update `dumb-issues.md` in the directory the user specifies.
- If the directory is not specified, ask before writing.
- Append every issue as a new section.
- One issue per section. Do not group issues.

## Issue Format

- Short, blunt title.
- Exact code snippet or `path:line-line`.
- Why this is bad with technical reasoning.
- Real-world consequences if left unfixed.
- Concrete fix or corrected code example.

## Process

- Read all provided context before writing findings.
- Prefer precision over volume, but include every notable issue.
- If something is questionable, include it.
- Do not propose a full rewrite unless required for correctness.

## Goal

Produce a brutal but accurate report that would make a senior engineer say: "Yeah… this needed to be said."
