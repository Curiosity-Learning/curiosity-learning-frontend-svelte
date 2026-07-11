import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearClubSwitchTargetIfPathChanged,
	consumeClubSwitchTarget,
	markClubSwitchTarget,
	shouldPreferFallbackAfterClubSwitch
} from './back';

// Covers the post club-switch back-button guard: after switching clubs, the very next
// in-app back action should prefer the current club's home over history.back() (which
// could otherwise surface a page belonging to the club the user just left). See
// app-shell.svelte's handleBack and club-switcher.svelte's switchClub for the consumers.
describe('club switch back marker', () => {
	beforeEach(() => {
		// Reset any marker left over from a previous test (module-level state).
		clearClubSwitchTargetIfPathChanged('__test-reset__');
	});

	it('is inert until a switch marks a target', () => {
		expect(shouldPreferFallbackAfterClubSwitch('/club/B/sessions')).toBe(false);
	});

	it('prefers fallback only while still on the marked path', () => {
		markClubSwitchTarget('/club/B/sessions');
		expect(shouldPreferFallbackAfterClubSwitch('/club/B/sessions')).toBe(true);
		expect(shouldPreferFallbackAfterClubSwitch('/club/B')).toBe(false);
	});

	it('is consumed after first use, so a second back press falls through to normal behavior', () => {
		markClubSwitchTarget('/club/B/sessions');
		consumeClubSwitchTarget();
		expect(shouldPreferFallbackAfterClubSwitch('/club/B/sessions')).toBe(false);
	});

	it('expires the moment the user navigates away from the marked path first', () => {
		markClubSwitchTarget('/club/B/sessions');
		clearClubSwitchTargetIfPathChanged('/club/B/projects');
		expect(shouldPreferFallbackAfterClubSwitch('/club/B/sessions')).toBe(false);
	});

	it('does not clear when the current path still matches the marked target', () => {
		markClubSwitchTarget('/club/B/sessions');
		clearClubSwitchTargetIfPathChanged('/club/B/sessions');
		expect(shouldPreferFallbackAfterClubSwitch('/club/B/sessions')).toBe(true);
	});
});
