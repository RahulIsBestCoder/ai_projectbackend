/** Lightweight typo correction and domain aliases for chat retrieval queries. */
export class ChatRagQueryExpander {
  private readonly aliases: Record<string, string[]> = {
    multilingual: ['i18n', 'internationalization', 'internationalisation', 'localization',
      'localisation', 'locale', 'translation', 'language'],
  };

  private readonly spellings: Record<string, string> = {
    multilangual: 'multilingual',
    multilanguage: 'multilingual',
    internationalisation: 'multilingual',
    localization: 'multilingual',
    localisation: 'multilingual',
    intiated: 'initiated',
  };

  private readonly stopWords = new Set(
    'the a an is are was were how what where when why can could would should please tell show explain about this that these those project does do for and with from have has its'.split(' ')
  );

  public expand(question: string): string[] {
    const tokens = question.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
    const expanded: string[] = [];
    const add = (term: string) => {
      const normalized = term.replace(/-/g, '').trim();
      if (normalized && !this.stopWords.has(normalized) && !expanded.includes(normalized)) expanded.push(normalized);
    };

    for (const token of tokens) {
      const compact = token.replace(/-/g, '');
      const canonical = this.spellings[compact] || this.closestCanonical(compact) || compact;
      add(canonical);
      for (const alias of this.aliases[canonical] || []) add(alias);
      if (canonical !== compact) add(compact);
    }
    return expanded.slice(0, 14);
  }

  private closestCanonical(token: string): string | null {
    if (token.length < 6) return null;
    for (const canonical of Object.keys(this.aliases)) {
      if (Math.abs(canonical.length - token.length) <= 2 && this.distance(token, canonical) <= 2) return canonical;
    }
    return null;
  }

  private distance(left: string, right: string): number {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= right.length; j++) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[right.length];
  }
}
