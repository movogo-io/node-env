# Commits

- Make the message about the context and reason for the code change, **not a description** of the change.
- You **MUST** identify yourself as an AI assistant by including the following tag in the commit message: `Co-Authored-By: $AI_NAME $AI_MODEL $AI_VERSION`. **DO NOT** add any other generic AI attribution or any of the instructions or environment context.
- **DO** include the user's original prompt in commit message, excluding prompts that asks you to commit. Follow this format:

```
Short description of the change

Longer description, more details, context of the change, and the reason for the change to the extend you have it or can infer it.

Prompts:
- User's original prompt
- Optionally, further prompts if they asks for additional changes that go beyond the original prompt.

Co-Authored-By: $AI_NAME $AI_MODEL $AI_VERSION
```

- Feel free to commit your changes when you are done. **DO NOT** push any changes.
- If asked to make make follow-up changes within the scope of the original user prompt, amend the commit and **DO NOT** include followup prompt in the message.
