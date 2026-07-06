<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:skill-scoping-rules -->
# Skill Loading and Scoping Rule

To conserve context tokens, the agent must NOT load the details of any skills (i.e., do not read/view the detailed `SKILL.md` instruction files) at the beginning of the conversation. 

Instead, the agent must:
1. Define the project scope or ask the user for the scope of the current task.
2. Present a filtered list of potentially relevant available skills based on that scope.
3. Wait for the user to confirm which skills to load/read details for before proceeding to read their specific files.
<!-- END:skill-scoping-rules -->
