import { describe, expect, it } from 'vitest';
import { isUrl, linkifySegments } from './linkify';

describe('isUrl', () => {
	it('recognizes a plain http(s) URL', () => {
		expect(isUrl('https://example.com/meet/abc')).toBe(true);
		expect(isUrl('http://example.com')).toBe(true);
	});

	it('rejects a plain address', () => {
		expect(isUrl('123 Main St, Springfield')).toBe(false);
	});

	it('rejects mixed text with a URL inside', () => {
		expect(isUrl('Join here: https://example.com')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isUrl('')).toBe(false);
		expect(isUrl('   ')).toBe(false);
	});

	it('trims surrounding whitespace before checking', () => {
		expect(isUrl('  https://example.com  ')).toBe(true);
	});
});

describe('linkifySegments', () => {
	it('returns a single text segment when there is no URL', () => {
		expect(linkifySegments('123 Main St')).toEqual([{ type: 'text', value: '123 Main St' }]);
	});

	it('returns a single url segment for a bare URL', () => {
		expect(linkifySegments('https://example.com/meet')).toEqual([
			{ type: 'url', value: 'https://example.com/meet' }
		]);
	});

	it('splits text surrounding a URL', () => {
		expect(linkifySegments('Join here: https://example.com/meet for the session')).toEqual([
			{ type: 'text', value: 'Join here: ' },
			{ type: 'url', value: 'https://example.com/meet' },
			{ type: 'text', value: ' for the session' }
		]);
	});

	it('trims trailing sentence punctuation from a detected URL', () => {
		expect(linkifySegments('See https://example.com/meet.')).toEqual([
			{ type: 'text', value: 'See ' },
			{ type: 'url', value: 'https://example.com/meet' },
			{ type: 'text', value: '.' }
		]);
	});

	it('handles multiple URLs', () => {
		const result = linkifySegments('https://a.com and https://b.com');
		expect(result).toEqual([
			{ type: 'url', value: 'https://a.com' },
			{ type: 'text', value: ' and ' },
			{ type: 'url', value: 'https://b.com' }
		]);
	});

	it('returns empty array for empty input', () => {
		expect(linkifySegments('')).toEqual([]);
	});
});
