# OpenCode Skills Setup for OR3 Chat

## Current Skills Location

Skills are now properly located at:
```
.opencode/skills/
└── ruthless-code-review/
    └── SKILL.md
```

## To Use the Skill

After creating the skill, you need to **restart OpenCode** for it to be discovered.

Once restarted, invoke it with:
```
skills_ruthless_code_review
```

## Skill Naming Convention

- **Directory**: `lowercase-with-hyphens`
- **Frontmatter name**: Must match directory exactly
- **Tool name**: Auto-generated with underscores (`skills_ruthless_code_review`)

## Where Skills Can Live (Priority Order)

1. **Project-local** (highest priority): `.opencode/skills/<name>/SKILL.md`
2. **Global user**: `~/.opencode/skills/<name>/SKILL.md`
3. **XDG config**: `~/.config/opencode/skills/<name>/SKILL.md`

Claude Code compatibility:
- `.claude/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`

## SKILL.md Frontmatter Format

```yaml
---
name: skill-name                    # Required: lowercase alphanumeric with hyphens
description: At least 20 chars...   # Required: min 20 characters
license: MIT                        # Optional
allowed-tools:                      # Optional: restrict which tools the skill can use
  - read
  - write
  - bash
metadata:                           # Optional: key-value pairs
  version: "1.0"
  author: "Team"
---
```

## Supporting Files

Skills can include supporting files in subdirectories:
```
.opencode/skills/my-skill/
├── SKILL.md
├── scripts/
│   └── validate.sh
├── references/
│   └── checklist.md
└── assets/
    └── diagram.png
```

Reference them in SKILL.md like:
```markdown
See `references/checklist.md` for details.
```

## Other Skills in This Project

The following skills exist in `.agent/skills/` but need to be moved to `.opencode/skills/` to work:

- `doc-maker`
- `or3-cloud`
- `plugin-development`
- `hooks-system`
- `ui-theme`

To migrate them:
```bash
# Example: migrate or3-cloud skill
mkdir -p .opencode/skills/or3-cloud
cp .agent/skills/or3-cloud/SKILL.md .opencode/skills/or3-cloud/
```

Then restart OpenCode.

## Best Practices (from Claude Code)

1. **Keep skills focused** - One clear responsibility per skill
2. **Use frontmatter properly** - Name must match directory
3. **Provide concrete examples** - Code snippets, file paths
4. **Include checklists** - Step-by-step instructions
5. **Reference supporting files** - For complex workflows
6. **Version your skills** - Use metadata.version
7. **Test skills** - Verify they work after creation

## Troubleshooting

**Skill not appearing?**
- Check directory name matches frontmatter name exactly
- Verify description is at least 20 characters
- Ensure file is named `SKILL.md` (case sensitive)
- Restart OpenCode after creating/modifying skills

**Skill invoked but not working?**
- Check `allowed-tools` includes necessary tools
- Verify file paths in skill content are correct
- Look for YAML frontmatter syntax errors

## Resources

- [OpenCode Skills Docs](https://opencode.ai/docs/skills)
- [Agent Skills Spec](https://github.com/anthropics/agent-skills)
- [Claude Code Skills](https://docs.claude.com/docs/claude-code/skills)
