# ADR-002: Form Architecture — Field.* + Superforms + Zod

**Status:** Accepted
**Date:** 2026-02-12

## Context

The project needed a consistent, reusable approach to building forms. Several options were evaluated:

1. **Formsnap** — wraps Superforms with its own `Form.Field`, `Form.Control`, `Form.Label` components. Adds boilerplate (`Form.Field > Form.Control > {#snippet children}`) and a second component namespace alongside shadcn-svelte's `Field.*`.
2. **Custom FormField wrapper** — a project-specific component that handles label, required indicator, error display, and description in one place. Flexible but requires maintenance.
3. **Schema-driven / autoform** — generate form UI from Zod schema. No mature Svelte package exists (autoform is React-only). The `form-builder` project is a code generator, not a runtime renderer.
4. **Field.* + Superforms directly** — use shadcn-svelte's `Field.*` components for UI structure and Superforms for state/validation, without Formsnap as an intermediary.

## Decision

Use **shadcn-svelte Field.* components + Superforms + Zod v4** directly, without Formsnap.

### Why Not Formsnap?

- Formsnap adds a second component namespace (`Form.*`) alongside the existing `Field.*` components from shadcn-svelte, creating confusion about which to use.
- Its `Form.Field > Form.Control > {#snippet children}` pattern adds nesting boilerplate to every field.
- Superforms alone provides everything needed: `$formData`, `$errors`, `enhance`, `submitting`, SPA mode.

### Why Not Autoform / Schema-Driven?

- No production-ready autoform package exists for Svelte 5 / SvelteKit.
- The form-builder project outputs clean scaffold code using `Field.*` — confirming that the scaffold pattern is the intended usage.

## Pattern

### Schema (`schema.ts`)

```typescript
import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required.').max(200),
  description: z.string().max(200).optional().default(''),
  dueDate: z.string().min(1, 'A deadline is required.')
});

export type ProjectSchema = typeof projectSchema;
```

### Form page

```svelte
<script lang="ts">
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
  import { mySchema } from './schema';

  const { form: formData, errors, enhance, submitting } = superForm(
    defaults(zod4(mySchema)),          // zod4 (server adapter) for defaults
    {
      validators: zod4Client(mySchema), // zod4Client for client-side validation
      SPA: true,
      onUpdate: async ({ form }) => {
        if (!form.valid) return;
        // call Convex mutation, then navigate
      }
    }
  );
</script>

<form method="POST" use:enhance>
  <Field.Group>
    <Field.Field>
      <Field.Label for="name" required>Name</Field.Label>
      <Input id="name" name="name" bind:value={$formData.name} />
      {#if $errors.name}<Field.Error>{$errors.name}</Field.Error>{/if}
    </Field.Field>

    <Field.Field>
      <Field.Label for="optional-field">Optional field</Field.Label>
      <Input id="optional-field" name="optional-field" bind:value={$formData.optionalField} />
      <Field.Description>Helper text goes here.</Field.Description>
    </Field.Field>
  </Field.Group>
</form>
```

## Key Details

- **`defaults()` requires the server adapter** (`zod4`), not `zod4Client`. Using the client adapter causes a type error.
- **`validators` uses the client adapter** (`zod4Client`) for browser-side validation.
- **`SPA: true`** is required because the backend is Convex (not SvelteKit form actions).
- **`Field.Label` has a `required` prop** that renders a red asterisk (`<span class="text-destructive">*</span>`). This was added to the shadcn-svelte component in `field-label.svelte`.
- **No extra classes needed** on labels, descriptions, or errors — the `Field.*` components handle all styling.

## Component Hierarchy

```
Field.Group        — groups multiple fields, provides consistent spacing
  Field.Field      — wraps a single field (label + input + error + description)
    Field.Label    — styled label with optional `required` asterisk
    <Input />      — any shadcn-svelte input component
    Field.Error    — red error text, only renders when content provided
    Field.Description — muted helper text
```

## Reference Implementation

`src/routes/(app)/[clubId]/projects/new/+page.svelte` — the project creation form.

## Consequences

- **Positive:** Clean scaffold pattern — no extra abstraction layers.
- **Positive:** Consistent with shadcn-svelte's component system.
- **Positive:** Superforms handles all validation, submission state, and error management.
- **Positive:** Easy to copy the pattern for new forms.
- **Negative:** Each form requires the scaffold boilerplate (label, input, error per field), but this is explicit and readable.
