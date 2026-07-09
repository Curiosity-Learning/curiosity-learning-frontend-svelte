import { describe, expect, it } from 'vitest';
import { buildClubSwitchPath } from './club-switch-path';

describe('buildClubSwitchPath', () => {
	it('preserves the dashboard root', () => {
		expect(buildClubSwitchPath('/club/A', 'A', 'B')).toBe('/club/B');
	});

	it('preserves a simple sub-view', () => {
		expect(buildClubSwitchPath('/club/A/sessions', 'A', 'B')).toBe('/club/B/sessions');
	});

	it('preserves a nested sub-view', () => {
		expect(buildClubSwitchPath('/club/A/projects/current', 'A', 'B')).toBe(
			'/club/B/projects/current'
		);
	});

	it('preserves a deeply nested settings view', () => {
		expect(buildClubSwitchPath('/club/A/settings', 'A', 'B')).toBe('/club/B/settings');
	});

	it('falls back to the dashboard root for entity-specific drill-downs', () => {
		expect(buildClubSwitchPath('/club/A/sessions/some-session-id', 'A', 'B')).toBe('/club/B');
		expect(buildClubSwitchPath('/club/A/projects/current/some-project', 'A', 'B')).toBe(
			'/club/B'
		);
	});

	it('falls back to the dashboard root for an unrelated path', () => {
		expect(buildClubSwitchPath('/feed/my-clubs', 'A', 'B')).toBe('/club/B');
	});

	it('falls back to the dashboard root for a different club id in the path', () => {
		expect(buildClubSwitchPath('/club/C/sessions', 'A', 'B')).toBe('/club/B');
	});

	it('does not falsely match a club id that is a prefix of another', () => {
		expect(buildClubSwitchPath('/club/AA/sessions', 'A', 'B')).toBe('/club/B');
	});
});
