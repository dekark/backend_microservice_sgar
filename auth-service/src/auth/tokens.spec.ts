import { createRefreshToken, parseRefreshToken, sameHash } from './tokens';

describe('refresh secrets', () => {
  it('generates independent secrets with reproducible hashes', () => {
    const token = createRefreshToken();
    expect(parseRefreshToken(token.value)).toEqual({
      id: token.id,
      hash: token.hash,
    });
    expect(createRefreshToken().value).not.toBe(token.value);
    expect(token.hash).not.toContain(token.value);
    expect(sameHash(token.hash, token.hash)).toBe(true);
    expect(sameHash(token.hash, createRefreshToken().hash)).toBe(false);
    expect(sameHash('', token.hash)).toBe(false);
  });
  it.each([
    '',
    'a.b',
    '11111111-1111-4111-8111-111111111111.short',
    '11111111-1111-4111-8111-111111111111.' + '!'.repeat(43),
  ])('rejects malformed secret %s', (value) => {
    expect(() => parseRefreshToken(value)).toThrow();
  });
});
