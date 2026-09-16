# Simplify quiz and books screens

Removed the faculty quiz maximum-attempts input, student retry action and attempts-remaining/allowance messaging, the Explain what I missed remediation panel and its API invocation, and the Saved for local authoring summary from manage/books. Existing question feedback and local authoring storage remain. Existing database attempt policies and historical attempts are not rewritten by this UI cleanup.

Validation: TypeScript, lint (zero errors, seven existing warnings), web export and diff whitespace check. No new browser or native-device run for this UI removal. No migration is needed.
