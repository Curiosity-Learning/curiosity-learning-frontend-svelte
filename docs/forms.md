# Form Feedback Model

Forms use the same feedback placement across auth, onboarding, and app flows.

- Field-level validation belongs inline on the field with `FieldError` through the shared app form wrappers. Use this for required values, format rules, availability checks, password mismatch, and terms/checkbox requirements tied to one input area.
- Form-level errors belong in an inline `Alert` near the submit action or relevant step. Use this for auth failures, failed mutations/actions, blocked account states, and multi-field submission errors.
- Toasts/snackbars are reserved for background side effects, success confirmations, and non-blocking status that does not require the user to edit the current form.
- Availability checks should be debounced, cancel stale responses, and block submission while checking or when unavailable. Server mutations still enforce the same rule.
- Shared wrappers in `src/lib/components/app/form` should be preferred before using raw `Field` primitives, unless the screen needs a custom composed control.
